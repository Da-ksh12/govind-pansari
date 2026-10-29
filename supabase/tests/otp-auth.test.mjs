#!/usr/bin/env node
/**
 * Live OTP sign-in checks against Supabase Auth, using the QA fixed-code numbers (which never reach the
 * SMS hook, so no SMS is sent and no provider balance is used).
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *   [SUPABASE_ACCESS_TOKEN=...]  node supabase/tests/otp-auth.test.mjs
 *
 * Proves: wrong code rejected, right code signs in and yields exactly one profile, signing in again reuses
 * the same user (no duplicate account), the resend cooldown is enforced, and (with an access token) the
 * production Auth settings are what the documentation says. What can NOT be proven here, because the QA
 * numbers bypass the provider: that a real SMS arrives — see docs/production-sms-and-payments.md §7.
 */
const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const mgmtToken = process.env.SUPABASE_ACCESS_TOKEN;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL  ${name}\n      ${e.message}`);
    failed++;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const base = { apikey: ANON, 'Content-Type': 'application/json' };
const requestCode = async (phone) => {
  const res = await fetch(`${URL_}/auth/v1/otp`, { method: 'POST', headers: base, body: JSON.stringify({ phone }) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const verify = async (phone, token) => {
  const res = await fetch(`${URL_}/auth/v1/verify`, { method: 'POST', headers: base, body: JSON.stringify({ type: 'sms', phone, token }) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const profilesFor = async (accessToken, userId) => {
  const res = await fetch(`${URL_}/rest/v1/profiles?id=eq.${userId}&select=id,phone`, { headers: { apikey: ANON, Authorization: `Bearer ${accessToken}` } });
  return res.json();
};

const PHONE = '+919000001020'; // a QA customer number
let first;

await check('a wrong code is rejected and creates no session', async () => {
  await requestCode(PHONE);
  const res = await verify(PHONE, '000000');
  assert(res.status >= 400 && res.status < 500, `status ${res.status}`);
  assert(!res.body?.access_token, 'a session was issued for a wrong code');
  assert(['otp_expired', 'invalid_credentials'].includes(res.body?.error_code ?? res.body?.code), JSON.stringify(res.body));
});

await check('the right code signs the user in; there is exactly one profile for them', async () => {
  first = await verify(PHONE, '123456');
  assert(first.status === 200 && first.body.access_token, `status ${first.status}: ${JSON.stringify(first.body).slice(0, 200)}`);
  assert(first.body.user.phone_confirmed_at, 'phone is not marked confirmed');
  const rows = await profilesFor(first.body.access_token, first.body.user.id);
  assert(rows.length === 1 && rows[0].phone === first.body.user.phone, JSON.stringify(rows));
});

await check('signing in again reuses the same account (no duplicate user or profile)', async () => {
  await requestCode(PHONE);
  const again = await verify(PHONE, '123456');
  assert(again.status === 200 && again.body.user.id === first.body.user.id, 'a different user id came back');
  const rows = await profilesFor(again.body.access_token, again.body.user.id);
  assert(rows.length === 1, `profiles: ${rows.length}`);
});

await check('malformed or non-Indian numbers are refused (nothing is sent, no code is issued)', async () => {
  // Auth validates the format itself (4xx); a well-formed but non-Indian-mobile number reaches the SMS hook,
  // which refuses it, and Auth reports any hook refusal as a 500. Either way: an error, never a success.
  for (const phone of ['+91123', 'not-a-number', '', '+14155550123']) {
    const res = await requestCode(phone);
    assert(res.status >= 400, `${JSON.stringify(phone)} -> ${res.status}`);
    assert(!res.body?.message_id, `${JSON.stringify(phone)} was accepted`);
  }
});

await check('requesting codes in rapid succession is rate limited (resend cooldown)', async () => {
  const phone = '+919000001019';
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await requestCode(phone)).status);
  assert(statuses.includes(429), `no request was limited: ${statuses.join(',')}`);
});

if (mgmtToken) {
  const ref = new URL(URL_).hostname.split('.')[0];
  const config = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, { headers: { Authorization: `Bearer ${mgmtToken}` } })).json();

  await check('production Auth settings: hook on, code valid 1-10 minutes, >= 60 s between codes', () => {
    assert(config.hook_send_sms_enabled === true, 'the Send SMS hook is not enabled');
    assert(String(config.hook_send_sms_uri).endsWith('/functions/v1/send-sms-hook'), `hook uri ${config.hook_send_sms_uri}`);
    assert(config.sms_otp_exp >= 60 && config.sms_otp_exp <= 600, `sms_otp_exp ${config.sms_otp_exp}`);
    assert(config.sms_max_frequency >= 60, `sms_max_frequency ${config.sms_max_frequency}`);
    assert(config.sms_otp_length >= 6, `sms_otp_length ${config.sms_otp_length}`);
  });

  await check('production Auth settings: send and verify attempts are rate limited per IP', () => {
    assert(config.rate_limit_otp <= 60 && config.rate_limit_verify <= 60, `${config.rate_limit_otp}/${config.rate_limit_verify}`);
    assert(config.rate_limit_sms_sent <= 1000, `rate_limit_sms_sent ${config.rate_limit_sms_sent}`);
  });

  // The QA numbers are needed by the QA suites, so this gate is opt-in: run with GO_LIVE=1 before launch.
  const fixedCode = String(config.sms_test_otp ?? '').split(',').filter(Boolean).length;
  if (process.env.GO_LIVE === '1') {
    await check('GO-LIVE: no fixed-code QA numbers remain (see docs §8)', () => {
      assert(fixedCode === 0, `${fixedCode} fixed-code numbers can still sign in with a known code`);
    });
  } else if (fixedCode > 0) {
    console.log(`  !!  WARNING: ${fixedCode} fixed-code QA numbers can still sign in with a known code (fine for QA; remove before launch, then run with GO_LIVE=1)`);
  }
} else {
  console.log('  --  (Auth-settings checks skipped: set SUPABASE_ACCESS_TOKEN to run them)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
