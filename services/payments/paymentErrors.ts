/**
 * Turns whatever the payment gateway (or the network) hands back into a short,
 * safe message for the customer (QA TC-13). The gateway's own error payloads —
 * for example {"error":{"code":"BAD_REQUEST_ERROR","description":"undefined",
 * "source":"customer","step":"payment_authentication","reason":"payment_error"}} —
 * are diagnostics, not copy: they must never be shown, and their
 * "description" is often the literal string "undefined".
 *
 * This module is free of React Native so it can be unit-tested.
 */

export type PaymentFailureKind =
  | 'cancelled'
  | 'authentication'
  | 'declined'
  | 'network'
  | 'timeout'
  | 'verification'
  | 'unknown';

export interface PaymentFailure {
  kind: PaymentFailureKind;
  /** Safe to show to the customer. Never contains gateway codes, JSON or stack text. */
  message: string;
  /** False when the customer deliberately backed out — no error should be shown at all. */
  showError: boolean;
  /** Short, non-sensitive facts for logs (codes only — never card, UPI, name or phone data). */
  diagnostics: { code?: string; reason?: string; step?: string; source?: string };
}

const MESSAGES: Record<PaymentFailureKind, string> = {
  cancelled: 'Payment was cancelled. You can try again or choose another way to pay.',
  authentication: "We couldn't confirm your payment with your bank or UPI app. Please try again or choose another payment method.",
  declined: 'Your payment was declined. Please try another card or payment method.',
  network: "We couldn't reach the payment service. Please check your connection and try again.",
  timeout: 'The payment took too long to respond. Please try again.',
  verification: "We couldn't confirm your payment. If money was deducted it will be refunded automatically — please try again.",
  unknown: "We couldn't complete your payment. Please try again or choose another payment method.",
};

interface GatewayFields {
  code?: string;
  description?: string;
  reason?: string;
  step?: string;
  source?: string;
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') return undefined;
    return trimmed;
  }
  if (typeof value === 'number') return String(value);
  return undefined;
}

/** Reads code/description/reason/step/source from a gateway payload, however it is nested or encoded. */
export function extractGatewayFields(raw: unknown, depth = 0): GatewayFields {
  if (depth > 3 || raw === null || raw === undefined) return {};

  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return extractGatewayFields(JSON.parse(text), depth + 1);
      } catch {
        // Not JSON — fall through and treat the whole string as the description.
      }
    }
    return { description: asText(text) };
  }

  if (raw instanceof Error) {
    return { ...extractGatewayFields(raw.message, depth + 1), description: asText(raw.message) };
  }

  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (obj.error && typeof obj.error === 'object') {
      const inner = extractGatewayFields(obj.error, depth + 1);
      return { ...inner, description: inner.description ?? asText(obj.description) };
    }
    return {
      code: asText(obj.code),
      description: asText(obj.description) ?? asText(obj.message),
      reason: asText(obj.reason),
      step: asText(obj.step),
      source: asText(obj.source),
    };
  }
  return {};
}

const NETWORK_PATTERN = /network|failed to fetch|fetch failed|offline|connection|econn|enotfound|\bdns\b|unreachable|could(n't| not) (reach|load)/i;
const TIMEOUT_PATTERN = /time(d)?[ -]?out|etimedout|took too long/i;
const CANCEL_PATTERN = /cancel|dismiss|closed by user|user (closed|aborted)|back button/i;
const DECLINE_PATTERN = /declin|insufficient|do not honou?r|card (is )?(blocked|expired)|limit exceeded|payment_failed|payment_declined|bank/i;
const AUTH_PATTERN = /authenticat|\botp\b|3-?d ?secure|\bpin\b|verification failed/i;
const INCOMPLETE_PATTERN = /incomplete|signature|did not match|could(n't| not) be (verified|confirmed)|verify/i;

export function classifyPaymentFailure(raw: unknown): PaymentFailure {
  const fields = extractGatewayFields(raw);
  const diagnostics = { code: fields.code, reason: fields.reason, step: fields.step, source: fields.source };
  const haystack = [fields.code, fields.description, fields.reason, fields.step].filter(Boolean).join(' ');

  const done = (kind: PaymentFailureKind): PaymentFailure => ({
    kind,
    message: MESSAGES[kind],
    showError: kind !== 'cancelled',
    diagnostics,
  });

  if (CANCEL_PATTERN.test(haystack)) return done('cancelled');
  if (TIMEOUT_PATTERN.test(haystack)) return done('timeout');
  if (NETWORK_PATTERN.test(haystack)) return done('network');
  // The gateway's authentication step failing (the customer did not complete
  // the bank / UPI approval) is by far the most common "BAD_REQUEST_ERROR".
  if (fields.step === 'payment_authentication' || fields.reason === 'authentication_failed' || AUTH_PATTERN.test(haystack)) {
    return done('authentication');
  }
  if (DECLINE_PATTERN.test(haystack) || fields.reason === 'payment_failed' || fields.reason === 'payment_declined') return done('declined');
  if (INCOMPLETE_PATTERN.test(haystack)) return done('verification');
  return done('unknown');
}

/** The message for a server-side verification refusal (signature mismatch, order mismatch, already-paid). */
export function verificationFailureMessage(): string {
  return MESSAGES.verification;
}
