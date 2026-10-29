// Fast2SMS request building and response/receipt handling, kept free of any
// runtime-specific API so it can be unit-tested (tests/unit/fast2sms.test.mjs).
//
// Source of truth: Fast2SMS developer documentation (docs.fast2sms.com):
//   * Endpoint ........ GET https://www.fast2sms.com/dev/bulkV2
//   * Authentication .. HTTP header `Authorization: <API key>` (no "Bearer")
//   * route=dlt ....... sender_id (DLT header), message (the DLT *template id*,
//                       not text), variables_values ("|"-separated {#var#}
//                       values), numbers, optional udf1..udf3 (echoed back in
//                       delivery webhooks)
//   * route=otp ....... variables_values (numeric OTP only), numbers; Fast2SMS
//                       supplies the message; the account must have completed
//                       KYC and a minimum ₹100 recharge
//   * Success ......... {"return": true, "request_id": "...", "message": [...]}
//   * Errors .......... {"return": false, "status_code": <code>, "message": ...};
//                       codes from the "Error Code List" page, mapped below
//   * Delivery reports  asynchronous: a webhook configured in the Fast2SMS
//                       dashboard (payload fields request_id, status,
//                       status_description, failure_reason, udf1..3, ...) or a
//                       poll of the delivery-report API for the last 7 days.
// Accepted by the API is NOT the same as delivered to the handset: delivery is
// only known from the delivery report (see parseDeliveryReport).

export const FAST2SMS_URL = 'https://www.fast2sms.com/dev/bulkV2';

export type Fast2SmsRoute = 'dlt' | 'otp';

export interface Fast2SmsConfig {
  apiKey: string;
  route: Fast2SmsRoute;
  /** route=dlt: the DLT-approved sender id (header). */
  senderId?: string;
  /** route=dlt: the template id shown in Fast2SMS' DLT Manager. */
  templateId?: string;
  /** route=dlt: "|"-separated values for the template's {#var#} slots; `{otp}` is replaced by the code. Defaults to "{otp}". */
  variables?: string;
}

export type ConfigResult = { ok: true; config: Fast2SmsConfig } | { ok: false; problems: string[] };

/** Reads and validates the provider configuration from environment variables (names only in messages, never values). */
export function readFast2SmsConfig(get: (name: string) => string | undefined): ConfigResult {
  const problems: string[] = [];
  const apiKey = get('FAST2SMS_API_KEY')?.trim();
  if (!apiKey) problems.push('FAST2SMS_API_KEY is not set');

  const route = get('FAST2SMS_ROUTE')?.trim().toLowerCase();
  if (route !== 'dlt' && route !== 'otp') problems.push('FAST2SMS_ROUTE must be "dlt" or "otp"');

  const senderId = get('FAST2SMS_SENDER_ID')?.trim();
  const templateId = get('FAST2SMS_TEMPLATE_ID')?.trim();
  const variables = get('FAST2SMS_TEMPLATE_VARIABLES')?.trim() || '{otp}';
  if (route === 'dlt') {
    if (!senderId || !/^[A-Za-z0-9]{3,6}$/.test(senderId)) problems.push('FAST2SMS_SENDER_ID must be the 3-6 character DLT sender id');
    if (!templateId || !/^[A-Za-z0-9_-]{1,40}$/.test(templateId)) problems.push('FAST2SMS_TEMPLATE_ID must be the template id from the Fast2SMS DLT Manager');
    if (!variables.includes('{otp}')) problems.push('FAST2SMS_TEMPLATE_VARIABLES must contain {otp}');
  }

  if (problems.length > 0 || !apiKey) return { ok: false, problems };
  return { ok: true, config: { apiKey, route: route as Fast2SmsRoute, senderId, templateId, variables } };
}

export interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
}

/** Builds the GET request that delivers `otp` to the 10-digit Indian `mobile`. `correlationId` is echoed back by delivery webhooks (dlt route). */
export function buildSendRequest(config: Fast2SmsConfig, mobile: string, otp: string, correlationId?: string): BuiltRequest {
  if (!/^[6-9]\d{9}$/.test(mobile)) throw new Error('mobile must be a 10-digit Indian mobile number');
  if (!/^\d{4,10}$/.test(otp)) throw new Error('otp must be 4-10 digits');

  const params = new URLSearchParams();
  if (config.route === 'dlt') {
    params.set('route', 'dlt');
    params.set('sender_id', config.senderId ?? '');
    params.set('message', config.templateId ?? '');
    params.set('variables_values', (config.variables ?? '{otp}').split('{otp}').join(otp));
    params.set('numbers', mobile);
    if (correlationId) params.set('udf1', correlationId);
  } else {
    // The OTP route accepts a numeric value only (provider error 997 otherwise).
    params.set('route', 'otp');
    params.set('variables_values', otp);
    params.set('numbers', mobile);
  }
  return { url: `${FAST2SMS_URL}?${params.toString()}`, headers: { Authorization: config.apiKey, Accept: 'application/json' } };
}

export type SendFailureKind =
  | 'invalid_number'
  | 'insufficient_balance'
  | 'auth'
  | 'account'
  | 'template'
  | 'route_config'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable'
  | 'rejected';

export type SendOutcome =
  | { accepted: true; requestId: string | null }
  | { accepted: false; kind: SendFailureKind; providerCode: number | null; detail: string };

function detailOf(body: unknown): string {
  const message = (body as { message?: unknown } | null)?.message;
  const text = Array.isArray(message) ? message.join('; ') : typeof message === 'string' ? message : '';
  return text.slice(0, 200);
}

function kindForProviderCode(code: number): SendFailureKind | null {
  switch (code) {
    case 405:
    case 411:
      return 'invalid_number';
    case 416:
      return 'insufficient_balance';
    case 409:
    case 412:
    case 413:
    case 414:
      return 'auth';
    case 415:
    case 996:
    case 999:
      return 'account';
    case 406:
    case 407:
    case 417:
    case 424:
    case 425:
    case 426:
    case 500:
      return 'template';
    case 401:
    case 402:
    case 403:
    case 404:
    case 408:
    case 410:
    case 990:
    case 997:
    case 998:
      return 'route_config';
    case 995:
      return 'rate_limited';
    default:
      return null;
  }
}

/** Interprets the provider's HTTP status + JSON body. `body` is null when the response was not JSON. */
export function classifySendResponse(httpStatus: number, body: unknown): SendOutcome {
  const parsed = body as { return?: unknown; request_id?: unknown; status_code?: unknown } | null;

  if (httpStatus === 200 && parsed?.return === true) {
    return { accepted: true, requestId: typeof parsed.request_id === 'string' ? parsed.request_id : null };
  }

  const detail = detailOf(body);
  const providerCode = typeof parsed?.status_code === 'number' ? parsed.status_code : null;
  const fail = (kind: SendFailureKind): SendOutcome => ({ accepted: false, kind, providerCode, detail });

  // The transport-level status wins for authentication and availability problems.
  if (httpStatus === 401 || httpStatus === 403) return fail('auth');
  if (httpStatus === 429) return fail('rate_limited');
  if (httpStatus >= 500) return fail('unavailable');

  if (providerCode !== null) {
    const byCode = kindForProviderCode(providerCode);
    if (byCode) return fail(byCode);
  }
  // Fall back to the wording when no (known) code was given.
  if (/balance/i.test(detail)) return fail('insufficient_balance');
  if (/invalid.*(number|mobile)/i.test(detail)) return fail('invalid_number');
  if (/authori[sz]ation|authentication/i.test(detail)) return fail('auth');
  return fail('rejected');
}

/** What the end user may be told for a failure. Operational detail (balance, keys, templates) is never exposed. */
export function describeFailureForClient(kind: SendFailureKind): { httpCode: number; message: string } {
  switch (kind) {
    case 'invalid_number':
      return { httpCode: 400, message: "We can't send a text message to that number." };
    case 'rate_limited':
      return { httpCode: 429, message: 'Too many codes requested. Please wait a few minutes and try again.' };
    default:
      return { httpCode: 503, message: "We couldn't send the code right now. Please try again shortly." };
  }
}

export type DeliveryStatus = 'delivered' | 'undelivered' | 'other';

export interface DeliveryReport {
  requestId: string | null;
  correlationId: string | null;
  status: DeliveryStatus;
  /** The provider's own status word, truncated. */
  providerStatus: string;
  reason: string | null;
}

/** Normalises a Fast2SMS delivery webhook ("Standard" payload). Returns null when it carries nothing usable. */
export function parseDeliveryReport(payload: unknown): DeliveryReport | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

  const requestId = text(p.request_id);
  const correlationId = text(p.udf1);
  const providerStatus = (text(p.status) ?? '').toLowerCase();
  if (!requestId && !correlationId) return null;
  if (!providerStatus) return null;

  let status: DeliveryStatus = 'other';
  if (providerStatus === 'delivered') status = 'delivered';
  else if (['failed', 'undelivered', 'rejected', 'expired', 'blocked'].includes(providerStatus)) status = 'undelivered';

  return {
    requestId,
    correlationId,
    status,
    providerStatus: providerStatus.slice(0, 40),
    reason: text(p.failure_reason) ?? text(p.status_description),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DeliveryUpdate {
  /** PostgREST filter for sms_delivery_log. */
  query: string;
  body: Record<string, unknown>;
}

/**
 * The update a delivery report should cause. A late "failed" never overwrites a row already
 * marked delivered (reports can arrive out of order or twice); a "delivered" always wins.
 * Returns null when the report cannot be matched to a row.
 */
export function deliveryUpdateFor(report: DeliveryReport, nowIso: string): DeliveryUpdate | null {
  let query: string;
  if (report.requestId) query = `request_id=eq.${encodeURIComponent(report.requestId)}`;
  else if (report.correlationId && UUID_RE.test(report.correlationId)) query = `id=eq.${report.correlationId}`;
  else return null;

  const body: Record<string, unknown> = {
    dlr_status: report.providerStatus,
    dlr_reason: report.reason ? report.reason.slice(0, 200) : null,
    updated_at: nowIso,
  };
  if (report.status === 'delivered') {
    body.status = 'delivered';
    body.delivered_at = nowIso;
  } else if (report.status === 'undelivered') {
    body.status = 'undelivered';
    query += '&status=neq.delivered';
  }
  return { query, body };
}
