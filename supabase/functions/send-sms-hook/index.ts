// Supabase Auth "Send SMS" hook -> Fast2SMS.
//
// Supabase Auth generates, stores, expires and verifies the OTP; when it needs
// a code delivered it POSTs {user, sms:{otp}} here, signed with the hook secret
// (Standard Webhooks). All logic lives in ../_shared/smsHook.ts; this file only
// supplies the real dependencies.
//
// Secrets (set with `supabase secrets set`, never in code or the app):
//   SEND_SMS_HOOK_SECRETS   the secret Supabase signs hook calls with
//   FAST2SMS_API_KEY        Fast2SMS "Dev API" authorization key
//   FAST2SMS_ROUTE          "dlt" (production, branded) or "otp"
//   FAST2SMS_SENDER_ID, FAST2SMS_TEMPLATE_ID, FAST2SMS_TEMPLATE_VARIABLES   (route=dlt)
// Optional tuning: SMS_PHONE_BURST, SMS_PHONE_REFILL_SECONDS, SMS_GLOBAL_PER_HOUR, FAST2SMS_TIMEOUT_MS.
// See docs/production-sms-and-payments.md. Deploy with --no-verify-jwt: Auth signs
// the call with the hook secret, it does not send a Supabase JWT.
import { handleSendSmsHook } from '../_shared/smsHook.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const restHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };

Deno.serve((req) =>
  handleSendSmsHook(req, {
    getEnv: (name) => Deno.env.get(name),
    fetchFn: (url, init) => fetch(url, init),
    takeToken: async (key, capacity, refillPerSecond) => {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/take_rate_limit_token`, {
        method: 'POST',
        headers: restHeaders,
        body: JSON.stringify({ p_key: key, p_capacity: capacity, p_refill_per_sec: refillPerSecond }),
      });
      if (!res.ok) throw new Error(`limiter status ${res.status}`);
      return (await res.json()) === true;
    },
    writeLog: async (entry) => {
      await fetch(`${SUPABASE_URL}/rest/v1/sms_delivery_log`, { method: 'POST', headers: restHeaders, body: JSON.stringify(entry) });
    },
    newId: () => crypto.randomUUID(),
  }),
);
