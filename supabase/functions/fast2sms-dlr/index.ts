// Fast2SMS delivery-report webhook -> sms_delivery_log.
//
// The send API only says the provider ACCEPTED a message. Whether it reached the
// handset arrives later, as a delivery report (Fast2SMS dashboard -> Webhooks ->
// Create webhook: service SMS, "Standard Webhook", method POST, content type
// JSON, destination = this function's URL with ?token=<FAST2SMS_DLR_TOKEN>).
// Fast2SMS documents no signature scheme for these calls, so authenticity rests
// on that unguessable token in the URL; the endpoint only ever updates the
// delivery status of rows in sms_delivery_log, it cannot trigger a send.
//
// Secrets: FAST2SMS_DLR_TOKEN (random string you generate). Deploy with
// --no-verify-jwt (Fast2SMS sends no Supabase JWT).
import { deliveryUpdateFor, parseDeliveryReport } from '../_shared/fast2sms.ts';
import { timingSafeEqual } from '../_shared/crypto.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DLR_TOKEN = Deno.env.get('FAST2SMS_DLR_TOKEN');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!DLR_TOKEN) {
    console.error('fast2sms-dlr: FAST2SMS_DLR_TOKEN is not set; refusing all requests');
    return json({ error: 'not configured' }, 500);
  }
  const provided = new URL(req.url).searchParams.get('token') ?? '';
  if (!timingSafeEqual(provided, DLR_TOKEN)) return json({ error: 'unauthorized' }, 401);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid body' }, 400);
  }

  const report = parseDeliveryReport(payload);
  const update = report ? deliveryUpdateFor(report, new Date().toISOString()) : null;
  // Answer 200 for reports we cannot use so the provider does not retry them forever.
  if (!report || !update) return json({ received: true, matched: 0 });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/sms_delivery_log?${update.query}`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(update.body),
  });
  if (!res.ok) {
    // A database failure: 5xx so the provider retries the delivery report.
    console.error('fast2sms-dlr: update failed with status', res.status);
    return json({ error: 'could not record the report' }, 500);
  }
  const rows = (await res.json()) as unknown[];
  return json({ received: true, matched: rows.length });
});
