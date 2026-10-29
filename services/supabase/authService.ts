import { supabase } from './client';
import { toE164 } from '../phone';
import { AuthFlowError, classifyAuthError } from '../authErrors';

// The classifier lives in ../authErrors (no React Native / client imports, so it is unit-tested);
// screens keep importing AuthFlowError from here.
export { AuthFlowError };
export type { AuthErrorCode } from '../authErrors';

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
