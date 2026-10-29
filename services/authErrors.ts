/**
 * Turns whatever Supabase Auth (or the SMS hook behind it) returns into a short,
 * safe message for the person signing in. Kept free of React Native / the
 * Supabase client so it can be unit-tested (tests/unit/auth-errors.test.mjs).
 *
 * Server text is never shown as-is for server-side failures: a failed text
 * message can carry provider detail (which gateway, balance, templates) that is
 * for operators, not customers — and the same messages must not reveal whether
 * a phone number already has an account.
 */
export type AuthErrorCode = 'INVALID_PHONE' | 'INVALID_OTP' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'UNKNOWN';

export class AuthFlowError extends Error {
  readonly code: AuthErrorCode;
  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthFlowError';
    this.code = code;
  }
}

const GENERIC = 'Something went wrong. Please try again.';
const SEND_FAILED = "We couldn't send the code right now. Please try again in a few minutes.";
const RATE_LIMITED = 'Too many attempts. Please wait a few minutes before trying again.';
const BAD_CODE = 'That code is incorrect or has expired.';

/** Server message text that is plainly a client-input problem and short enough to show. */
function showableMessage(err: { status?: number; message?: string }): string {
  const message = err.message?.trim();
  if (!message || message.length > 140) return GENERIC;
  if (typeof err.status !== 'number' || err.status >= 500) return GENERIC;
  if (/https?:|fast2sms|twilio|provider|hook|sms/i.test(message)) return GENERIC;
  return message;
}

export function classifyAuthError(error: unknown): AuthFlowError {
  const err = error as { code?: string; status?: number; message?: string; name?: string } | null;
  if (!err) return new AuthFlowError('UNKNOWN', GENERIC);

  switch (err.code) {
    case 'otp_expired':
    case 'invalid_credentials':
      return new AuthFlowError('INVALID_OTP', BAD_CODE);
    case 'over_sms_send_rate_limit':
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return new AuthFlowError('RATE_LIMITED', RATE_LIMITED);
    // The code could not be handed to the SMS provider (hook failure, provider
    // error, timeout, no provider configured): a delivery problem, never the
    // customer's fault and never worth showing provider detail for.
    case 'sms_send_failed':
    case 'phone_provider_disabled':
    case 'unexpected_failure':
    case 'hook_failed':
    case 'hook_timeout':
    case 'hook_timeout_after_retry':
      return new AuthFlowError('UNKNOWN', SEND_FAILED);
    case 'validation_failed':
      return new AuthFlowError('INVALID_PHONE', "That doesn't look like a valid mobile number.");
    default:
      if (err.status === 403) return new AuthFlowError('INVALID_OTP', BAD_CODE);
      if (err.status === 429) return new AuthFlowError('RATE_LIMITED', RATE_LIMITED);
      // A true fetch-level failure (offline, DNS, connection refused) —
      // checked after real API errors so a clear code is never downgraded to this.
      if (err.name === 'AuthRetryableFetchError' || err.message?.toLowerCase().includes('network')) {
        return new AuthFlowError('NETWORK_ERROR', "Couldn't reach the server. Check your connection and try again.");
      }
      return new AuthFlowError('UNKNOWN', showableMessage(err));
  }
}
