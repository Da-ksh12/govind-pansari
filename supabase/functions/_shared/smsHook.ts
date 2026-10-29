// The Supabase Auth "Send SMS" hook, written against injected dependencies so
// the whole decision flow can be unit-tested without Deno, a database or the
// real Fast2SMS (tests/unit/sms-hook.test.mjs). supabase/functions/send-sms-hook
// wires the real implementations.
//
// Responsibilities split — deliberately:
//   * Supabase Auth owns the OTP: it generates the code (cryptographically
//     random), enforces expiry, the resend cooldown and the per-IP / per-hour
//     send limits, stores it, and is the ONLY thing that verifies it
//     (auth.verifyOtp). This hook never sees or accepts a client's guess.
//   * This hook only DELIVERS the code Auth gives it, and adds what Auth does
//     not have: a per-phone and a global send budget (SMS-pumping defence), the
//     India-only check, provider error handling and an audit trail.
//
// Never logged or stored anywhere: the OTP and the full phone number.
import { verifyStandardWebhook } from './standardWebhooks.ts';
import { maskIndianMobile, normalizeIndianMobile } from './phone.ts';
import {
  buildSendRequest,
  classifySendResponse,
  describeFailureForClient,
  readFast2SmsConfig,
  type SendFailureKind,
} from './fast2sms.ts';

export interface SmsLogEntry {
  id: string;
  route: string | null;
  phone_masked: string;
  status: 'accepted' | 'failed' | 'rejected';
  request_id: string | null;
  failure_code: string | null;
  failure_detail: string | null;
}

export interface SmsHookDeps {
  getEnv(name: string): string | undefined;
  fetchFn(url: string, init: RequestInit): Promise<Response>;
  /** Token-bucket limiter backed by the database. Throws when the limiter itself is unavailable. */
  takeToken(key: string, capacity: number, refillPerSecond: number): Promise<boolean>;
  writeLog(entry: SmsLogEntry): Promise<void>;
  newId(): string;
  nowSeconds?: number;
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const failure = (httpCode: number, message: string) => json({ error: { http_code: httpCode, message } }, httpCode);

function intFromEnv(deps: SmsHookDeps, name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(deps.getEnv(name) ?? '', 10);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

interface HookPayload {
  user?: { phone?: unknown };
  sms?: { otp?: unknown };
}

export async function handleSendSmsHook(req: Request, deps: SmsHookDeps): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const secret = deps.getEnv('SEND_SMS_HOOK_SECRETS');
  if (!secret) {
    // A missing secret must stop everything, never fall back to "accept anything".
    console.error(JSON.stringify({ evt: 'sms_hook', problem: 'SEND_SMS_HOOK_SECRETS is not set' }));
    return failure(500, "We couldn't send the code right now. Please try again shortly.");
  }

  const rawBody = await req.text();
  const authentic = await verifyStandardWebhook({ secret, rawBody, headers: req.headers, nowSeconds: deps.nowSeconds });
  if (!authentic) {
    console.warn(JSON.stringify({ evt: 'sms_hook', problem: 'rejected a request with an invalid signature' }));
    return failure(401, 'unauthorized');
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody) as HookPayload;
  } catch {
    return failure(400, 'invalid request');
  }
  const otp = payload.sms?.otp;
  if (typeof otp !== 'string' || !/^\d{4,10}$/.test(otp)) return failure(400, 'invalid request');

  const mobile = normalizeIndianMobile(payload.user?.phone);
  const id = deps.newId();
  const log = async (entry: Omit<SmsLogEntry, 'id' | 'phone_masked'>, masked: string) => {
    try {
      await deps.writeLog({ id, phone_masked: masked, ...entry });
    } catch {
      // Logging must never decide whether the user gets their code.
    }
  };

  if (!mobile) {
    await log({ route: null, status: 'rejected', request_id: null, failure_code: 'not_indian_mobile', failure_detail: null }, '+XXXXXXXXXXXX');
    const out = describeFailureForClient('invalid_number');
    return failure(out.httpCode, out.message);
  }
  const masked = maskIndianMobile(mobile);

  const configResult = readFast2SmsConfig(deps.getEnv);
  if (!configResult.ok) {
    console.error(JSON.stringify({ evt: 'sms_hook', problem: 'provider not configured', details: configResult.problems }));
    await log({ route: null, status: 'failed', request_id: null, failure_code: 'not_configured', failure_detail: configResult.problems.join('; ').slice(0, 200) }, masked);
    const out = describeFailureForClient('rejected');
    return failure(out.httpCode, out.message);
  }
  const config = configResult.config;

  // Budgets: a few codes per number in a burst, then a slow trickle; and a global
  // hourly ceiling so a pumping attack cannot drain the SMS wallet.
  const phoneBurst = intFromEnv(deps, 'SMS_PHONE_BURST', 5, 1, 50);
  const phoneRefillSeconds = intFromEnv(deps, 'SMS_PHONE_REFILL_SECONDS', 600, 10, 86400);
  const globalPerHour = intFromEnv(deps, 'SMS_GLOBAL_PER_HOUR', 200, 10, 100000);
  try {
    const phoneOk = await deps.takeToken(`sms:phone:${mobile}`, phoneBurst, 1 / phoneRefillSeconds);
    const globalOk = phoneOk && (await deps.takeToken('sms:global', globalPerHour, globalPerHour / 3600));
    if (!phoneOk || !globalOk) {
      await log({ route: config.route, status: 'rejected', request_id: null, failure_code: phoneOk ? 'global_budget' : 'phone_budget', failure_detail: null }, masked);
      const out = describeFailureForClient('rate_limited');
      return failure(out.httpCode, out.message);
    }
  } catch {
    // Cannot tell whether this number/overall budget is exhausted: do not send.
    console.error(JSON.stringify({ evt: 'sms_hook', problem: 'rate limiter unavailable' }));
    await log({ route: config.route, status: 'failed', request_id: null, failure_code: 'limiter_unavailable', failure_detail: null }, masked);
    const out = describeFailureForClient('unavailable');
    return failure(out.httpCode, out.message);
  }

  // Supabase gives hooks about 5 seconds; stay inside that so Auth never reports
  // a failure for a message we did in fact send.
  const timeoutMs = intFromEnv(deps, 'FAST2SMS_TIMEOUT_MS', 4000, 500, 10000);
  const request = buildSendRequest(config, mobile, otp, id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let kind: SendFailureKind | null = null;
  let requestId: string | null = null;
  let providerCode: number | null = null;
  let detail = '';
  try {
    const res = await deps.fetchFn(request.url, { method: 'GET', headers: request.headers, signal: controller.signal });
    let body: unknown = null;
    try {
      body = JSON.parse(await res.text());
    } catch {
      body = null;
    }
    const outcome = classifySendResponse(res.status, body);
    if (outcome.accepted) requestId = outcome.requestId;
    else ({ kind, providerCode, detail } = outcome);
  } catch (e) {
    // Only the error's name is logged: its message can contain the request URL, which holds the code.
    kind = (e as { name?: string } | null)?.name === 'AbortError' ? 'timeout' : 'unavailable';
    detail = (e as { name?: string } | null)?.name ?? 'error';
  } finally {
    clearTimeout(timer);
  }

  if (kind) {
    console.error(JSON.stringify({ evt: 'sms_send_failed', kind, providerCode, route: config.route, phone: masked }));
    await log({ route: config.route, status: 'failed', request_id: null, failure_code: providerCode !== null ? `${kind}:${providerCode}` : kind, failure_detail: detail.slice(0, 200) || null }, masked);
    const out = describeFailureForClient(kind);
    return failure(out.httpCode, out.message);
  }

  // The provider ACCEPTED the message. Whether it reached the handset is only
  // known later, from the delivery report (functions/fast2sms-dlr).
  await log({ route: config.route, status: 'accepted', request_id: requestId, failure_code: null, failure_detail: null }, masked);
  return json({}, 200);
}
