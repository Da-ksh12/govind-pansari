#!/usr/bin/env node
/**
 * Wires Supabase Auth's "Send SMS" hook to the send-sms-hook Edge Function and sets
 * production-sensible OTP limits. Uses the Supabase Management API; secrets are
 * generated here and sent straight to Supabase — they are never printed or written
 * to disk.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/scripts/configure-auth-sms.mjs status
 *   SUPABASE_ACCESS_TOKEN=... node supabase/scripts/configure-auth-sms.mjs enable [--force] [--rotate-secret]
 *   SUPABASE_ACCESS_TOKEN=... node supabase/scripts/configure-auth-sms.mjs disable
 *
 * `enable` refuses to run until the FAST2SMS_API_KEY secret exists (otherwise every
 * real sign-in would fail at the hook); --force overrides that for testing.
 *
 * What `enable` changes in Auth:
 *   hook_send_sms_enabled   true, pointing at /functions/v1/send-sms-hook
 *   sms_otp_exp             300  (seconds a code stays valid; was 60 — too short for real SMS delivery)
 *   sms_max_frequency       60   (seconds between codes for one number; was 5)
 *   rate_limit_sms_sent     200  (codes per hour, project-wide; was 30)
 *   rate_limit_otp / _verify 30  (per IP per 5 minutes; unchanged, shown for the record)
 * `disable` only turns the hook off (the limits stay).
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN (Supabase dashboard -> Account -> Access Tokens).');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const ref = process.env.SUPABASE_PROJECT_REF ?? readFileSync(resolve(here, '../.temp/project-ref'), 'utf8').trim();
const [command = 'status', ...flags] = process.argv.slice(2);
const api = `https://api.supabase.com/v1/projects/${ref}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const res = await fetch(`${api}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

const secretNames = async () => new Set((await call('GET', '/secrets')).map((s) => s.name));

async function status() {
  const auth = await call('GET', '/config/auth');
  const names = await secretNames();
  const testNumbers = String(auth.sms_test_otp ?? '').split(',').filter(Boolean).length;
  console.log('Auth');
  console.log('  phone sign-in enabled ...... ', auth.external_phone_enabled);
  console.log('  send-SMS hook enabled ...... ', auth.hook_send_sms_enabled, auth.hook_send_sms_uri ?? '');
  console.log('  built-in provider .......... ', auth.sms_provider, '(unused while the hook is enabled)');
  console.log('  OTP validity (seconds) ..... ', auth.sms_otp_exp);
  console.log('  seconds between codes ...... ', auth.sms_max_frequency);
  console.log('  codes per hour (project) ... ', auth.rate_limit_sms_sent);
  console.log('  per-IP sends / verifies .... ', auth.rate_limit_otp, '/', auth.rate_limit_verify, 'per 5 min');
  console.log(`  fixed-code QA numbers ...... ${testNumbers}${testNumbers ? '   <-- REMOVE BEFORE GO-LIVE (anyone knowing the code can sign in as these accounts)' : ''}`);
  console.log('Edge-function secrets present (names only)');
  for (const name of ['SEND_SMS_HOOK_SECRETS', 'FAST2SMS_API_KEY', 'FAST2SMS_ROUTE', 'FAST2SMS_SENDER_ID', 'FAST2SMS_TEMPLATE_ID', 'FAST2SMS_DLR_TOKEN', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) {
    console.log(`  ${names.has(name) ? 'set    ' : 'MISSING'}  ${name}`);
  }
}

async function enable() {
  const names = await secretNames();
  if (!names.has('FAST2SMS_API_KEY') && !flags.includes('--force')) {
    console.error('FAST2SMS_API_KEY is not set as a function secret yet, so real sign-ins would fail at the hook.');
    console.error('Set it first (see docs/production-sms-and-payments.md), or re-run with --force to enable anyway.');
    process.exit(1);
  }

  if (!names.has('SEND_SMS_HOOK_SECRETS') || flags.includes('--rotate-secret')) {
    // Standard Webhooks secret as Supabase expects it: "v1,whsec_<base64>".
    const secret = `v1,whsec_${randomBytes(32).toString('base64')}`;
    await call('POST', '/secrets', [{ name: 'SEND_SMS_HOOK_SECRETS', value: secret }]);
    await call('PATCH', '/config/auth', { hook_send_sms_secrets: secret });
    console.log('Generated a new hook secret and stored it in both places (not shown).');
  }

  await call('PATCH', '/config/auth', {
    external_phone_enabled: true,
    hook_send_sms_enabled: true,
    hook_send_sms_uri: `https://${ref}.supabase.co/functions/v1/send-sms-hook`,
    sms_otp_length: 6,
    sms_otp_exp: 300,
    sms_max_frequency: 60,
    rate_limit_sms_sent: 200,
  });
  console.log('Send-SMS hook enabled; OTP limits updated.\n');
  await status();
}

async function disable() {
  await call('PATCH', '/config/auth', { hook_send_sms_enabled: false });
  console.log('Send-SMS hook disabled.\n');
  await status();
}

const commands = { status, enable, disable };
if (!commands[command]) {
  console.error(`Unknown command "${command}". Use status | enable | disable.`);
  process.exit(1);
}
try {
  await commands[command]();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
