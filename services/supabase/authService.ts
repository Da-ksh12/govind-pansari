import { supabase } from './client';
import { toE164 } from '../phone';

export type AuthErrorCode = 'INVALID_PHONE' | 'INVALID_OTP' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'UNKNOWN';

export class AuthFlowError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthFlowError';
    this.code = code;
  }
}

function classifyAuthError(error: unknown): AuthFlowError {
  const err = error as { code?: string; status?: number; message?: string; name?: string } | null;
  if (!err) return new AuthFlowError('UNKNOWN', 'Something went wrong. Please try again.');

  switch (err.code) {
    case 'otp_expired':
    case 'invalid_credentials':
      return new AuthFlowError('INVALID_OTP', 'That code is incorrect or has expired.');
    case 'over_sms_send_rate_limit':
    case 'over_request_rate_limit':
      return new AuthFlowError('RATE_LIMITED', 'Too many attempts. Please wait a moment before trying again.');
    case 'sms_send_failed':
    case 'phone_provider_disabled':
      return new AuthFlowError('UNKNOWN', "We couldn't send a code to that number right now.");
    // GoTrue returns this when no SMS provider is configured on the
    // project at all (confirmed live: "Unable to get SMS provider") —
    // a project-config problem, not the user's connection. Checked
    // before the network fallback below since supabase-js surfaces
    // this as a plain AuthApiError with a real code, not a fetch
    // failure, whenever the response actually reaches the client
    // (i.e. not masked by a browser CORS failure on web).
    case 'unexpected_failure':
      return new AuthFlowError('UNKNOWN', "SMS sign-in isn't set up for this app yet. Please contact support.");
    case 'validation_failed':
      return new AuthFlowError('INVALID_PHONE', "That doesn't look like a valid mobile number.");
    default:
      if (err.status === 403) return new AuthFlowError('INVALID_OTP', 'That code is incorrect or has expired.');
      if (err.status === 429) return new AuthFlowError('RATE_LIMITED', 'Too many attempts. Please wait a moment before trying again.');
      // A true fetch-level failure (offline, DNS, connection refused) —
      // checked last since a real API error with a clear code/message
      // should never be downgraded to this generic fallback.
      if (err.name === 'AuthRetryableFetchError' || err.message?.toLowerCase().includes('network')) {
        return new AuthFlowError('NETWORK_ERROR', "Couldn't reach the server. Check your connection and try again.");
      }
      return new AuthFlowError('UNKNOWN', err.message ?? 'Something went wrong. Please try again.');
  }
}

export const authService = {
  /** Sends (or resends) an OTP via Supabase's phone provider — never a custom/manual OTP. */
  async requestOtp(phone: string): Promise<void> {
    const { error } = await supabase.auth.signInWithOtp({ phone: toE164(phone) });
    if (error) throw classifyAuthError(error);
  },

  /** Verifies the OTP Supabase itself issued — this call is what actually creates the session. */
  async verifyOtp(phone: string, token: string) {
    const { data, error } = await supabase.auth.verifyOtp({ phone: toE164(phone), token, type: 'sms' });
    if (error) throw classifyAuthError(error);
    return data.session;
  },

  /**
   * Email OTP (added alongside phone+OTP, not replacing it) — same
   * 6-digit-code UX as phone, reusing app/otp.tsx, since email auth
   * doesn't require the SMS/DLT provider setup phone auth does.
   * shouldCreateUser: true means this also covers first-time signup —
   * handle_new_auth_user() already creates a customer profile for any
   * new auth.users row regardless of which identity created it.
   */
  async requestEmailOtp(email: string): Promise<void> {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw classifyAuthError(error);
  },

  async verifyEmailOtp(email: string, token: string) {
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) throw classifyAuthError(error);
    return data.session;
  },

  /**
   * Invited store managers/riders (email-invite feature) sign in with
   * email+password — a deliberately separate credential from customer
   * phone+OTP, chosen when this was scoped, not a general auth method
   * for customers.
   */
  async signInWithEmailPassword(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw classifyAuthError(error);
    return data.session;
  },

  /**
   * Sets the password for the session established by clicking an
   * invite email link (see app/staff-invite-accept.tsx) — the one-time
   * step that turns "invited" into "can log in with email+password".
   */
  async setPassword(password: string): Promise<void> {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw classifyAuthError(error);
  },

  /**
   * Establishes a session from the URL an invite/magic-link email
   * redirected to — supabase/client.ts deliberately sets
   * detectSessionInUrl: false, so this is the one explicit place that
   * parses it. Web only: there's no browser URL to read on native, and
   * without additional native deep-link (associated domains) setup an
   * emailed link opens in the system browser anyway, not the app.
   */
  async setSessionFromInviteUrl(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(hash);
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (!access_token || !refresh_token) return false;
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw classifyAuthError(error);
    // Clear the token out of the visible URL now that it's consumed.
    window.history.replaceState(null, '', window.location.pathname);
    return true;
  },

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  },

  async getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  /** Supabase session state is the source of truth — the app reacts to these events rather than trusting a local flag. */
  onAuthStateChange(callback: Parameters<typeof supabase.auth.onAuthStateChange>[0]) {
    return supabase.auth.onAuthStateChange(callback);
  },
};
