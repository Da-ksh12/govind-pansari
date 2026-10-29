// The Supabase Auth "Send SMS" hook end to end, with the provider, limiter and log faked.
// Requests are signed here with an independent implementation of Standard Webhooks
// (node:crypto), and the real verifier was also cross-checked against the official
// standardwebhooks library.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { handleSendSmsHook } from '../../supabase/functions/_shared/smsHook.ts';

const KEY_B64 = randomBytes(32).toString('base64');
const SECRET = `v1,whsec_${KEY_B64}`;
const OTP = '482913';
const NOW = Math.floor(Date.now() / 1000);

const sign = (id, ts, body, keyB64 = KEY_B64) => 'v1,' + createHmac('sha256', Buffer.from(keyB64, 'base64')).update(`${id}.${ts}.${body}`).digest('base64');

function hookRequest(payload, { ts = NOW, id = 'msg_1', keyB64 = KEY_B64, method = 'POST', signature } = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request('https://x.test/hook', {
    method,
    body: method === 'POST' ? body : undefined,
    headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': signature ?? sign(id, ts, body, keyB64) },
  });
}

const payload = (phone = '919000000301', otp = OTP) => ({ user: { id: 'u1', phone }, sms: { otp } });
const DLT = { SEND_SMS_HOOK_SECRETS: SECRET, FAST2SMS_API_KEY: 'prov-key', FAST2SMS_ROUTE: 'dlt', FAST2SMS_SENDER_ID: 'GOVPAN', FAST2SMS_TEMPLATE_ID: '178401' };

function harness({ env = DLT, provider, allow = () => true, limiterThrows = false, logThrows = false } = {}) {
  const calls = { fetch: [], tokens: [], logs: [] };
  const deps = {
    getEnv: (n) => env[n],
    fetchFn: async (url, init) => {
      calls.fetch.push({ url, init });
      if (provider) return provider(url, init);
      return Response.json({ return: true, request_id: 'req-123', message: ['Message sent successfully'] });
    },
    takeToken: async (key, capacity, refill) => {
      calls.tokens.push({ key, capacity, refill });
      if (limiterThrows) throw new Error('db down');
      return allow(key);
    },
    writeLog: async (entry) => {
      if (logThrows) throw new Error('log down');
      calls.logs.push(entry);
    },
    newId: () => '5b0d5d2c-3d8a-4f5e-9b8e-0c3a2f6a1d11',
    nowSeconds: NOW,
  };
  return { calls, run: (req) => handleSendSmsHook(req, deps) };
}

/** Collects everything written to the console while `fn` runs. */
async function withConsole(fn) {
  const lines = [];
  const originals = { error: console.error, warn: console.warn, log: console.log };
  for (const k of Object.keys(originals)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    Object.assign(console, originals);
  }
}

test('a correctly signed request delivers the code through Fast2SMS and answers 200 {}', async () => {
  const h = harness();
  const res = await h.run(hookRequest(payload()));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {});
  assert.equal(h.calls.fetch.length, 1);
  const url = new URL(h.calls.fetch[0].url);
  assert.equal(url.searchParams.get('numbers'), '9000000301');
  assert.equal(url.searchParams.get('variables_values'), OTP);
  assert.equal(url.searchParams.get('message'), '178401');
  assert.equal(h.calls.fetch[0].init.headers.Authorization, 'prov-key');
});

test('provider ACCEPTANCE is logged as "accepted", never as "delivered"', async () => {
  const h = harness();
  await h.run(hookRequest(payload()));
  assert.equal(h.calls.logs.length, 1);
  assert.equal(h.calls.logs[0].status, 'accepted');
  assert.equal(h.calls.logs[0].request_id, 'req-123');
  assert.equal(h.calls.logs[0].phone_masked, '+91XXXXXX0301');
  // the correlation id the delivery report will echo back
  assert.equal(new URL(h.calls.fetch[0].url).searchParams.get('udf1'), h.calls.logs[0].id);
});

test('the code and the full number never appear in logs, console output or responses', async () => {
  const h = harness({ provider: () => Response.json({ return: false, status_code: 416, message: ['no balance'] }) });
  const { result, lines } = await withConsole(() => h.run(hookRequest(payload())));
  const everything = JSON.stringify([h.calls.logs, lines, await result.text()]);
  assert.doesNotMatch(everything, new RegExp(OTP));
  assert.doesNotMatch(everything, /9000000301|919000000301/);
});

test('bad or missing signatures are refused before anything else happens', async () => {
  const h = harness();
  for (const req of [
    hookRequest(payload(), { keyB64: randomBytes(32).toString('base64') }),
    hookRequest(payload(), { signature: 'v1,AAAA' }),
    hookRequest(payload(), { ts: NOW - 3600 }),
    hookRequest(payload(), { ts: NOW + 3600 }),
    new Request('https://x.test/hook', { method: 'POST', body: JSON.stringify(payload()) }),
  ]) {
    const { result } = await withConsole(() => h.run(req));
    assert.equal(result.status, 401);
  }
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.tokens.length, 0);
});

test('a body altered after signing is refused', async () => {
  const h = harness();
  const signed = JSON.stringify(payload());
  const req = new Request('https://x.test/hook', {
    method: 'POST',
    body: signed.replace('919000000301', '919999999999'),
    headers: { 'webhook-id': 'msg_1', 'webhook-timestamp': String(NOW), 'webhook-signature': sign('msg_1', NOW, signed) },
  });
  const { result } = await withConsole(() => h.run(req));
  assert.equal(result.status, 401);
  assert.equal(h.calls.fetch.length, 0);
});

test('a hook secret rotation: either configured secret is accepted', async () => {
  const oldKey = randomBytes(32).toString('base64');
  const h = harness({ env: { ...DLT, SEND_SMS_HOOK_SECRETS: `v1,whsec_${oldKey}|${SECRET}` } });
  assert.equal((await h.run(hookRequest(payload()))).status, 200);
});

test('without a hook secret configured everything is refused (never "accept anything")', async () => {
  const h = harness({ env: { ...DLT, SEND_SMS_HOOK_SECRETS: undefined } });
  const { result } = await withConsole(() => h.run(hookRequest(payload())));
  assert.equal(result.status, 500);
  assert.equal(h.calls.fetch.length, 0);
});

test('only POST is served', async () => {
  const h = harness();
  assert.equal((await h.run(hookRequest(payload(), { method: 'GET' }))).status, 405);
});

test('malformed payloads are refused', async () => {
  const h = harness();
  for (const bad of ['not json', payload('919000000301', 'abcdef'), payload('919000000301', ''), { user: { phone: '919000000301' } }, { sms: { otp: OTP } }]) {
    const res = await h.run(hookRequest(bad));
    assert.ok([400].includes(res.status), JSON.stringify(bad));
  }
  assert.equal(h.calls.fetch.length, 0);
});

test('only Indian mobile numbers are texted; the refusal is logged and nothing is sent', async () => {
  const h = harness();
  for (const phone of ['14155550123', '+14155550123', '12345', '']) {
    const res = await h.run(hookRequest(payload(phone)));
    assert.equal(res.status, 400, phone);
  }
  assert.equal(h.calls.fetch.length, 0);
  assert.ok(h.calls.logs.every((l) => l.status === 'rejected' && l.failure_code === 'not_indian_mobile'));
});

test('Supabase hands the number over in different shapes; all reach the provider normalised', async () => {
  for (const phone of ['919000000301', '+919000000301', '9000000301']) {
    const h = harness();
    assert.equal((await h.run(hookRequest(payload(phone)))).status, 200, phone);
    assert.equal(new URL(h.calls.fetch[0].url).searchParams.get('numbers'), '9000000301');
  }
});

test('an unconfigured provider fails closed with a generic message and no call', async () => {
  const h = harness({ env: { SEND_SMS_HOOK_SECRETS: SECRET } });
  const { result } = await withConsole(() => h.run(hookRequest(payload())));
  assert.equal(result.status, 503);
  const body = await result.json();
  assert.doesNotMatch(body.error.message, /fast2sms|key|route|template/i);
  assert.equal(h.calls.fetch.length, 0);
  assert.equal(h.calls.logs[0].failure_code, 'not_configured');
});

test('provider failures: logged precisely, shown to the customer generically', async () => {
  const cases = [
    [() => Response.json({ return: false, status_code: 416, message: ['You do not have sufficient wallet balance'] }, { status: 400 }), 503, 'insufficient_balance:416'],
    [() => Response.json({ return: false, status_code: 411, message: ['Invalid Numbers'] }, { status: 400 }), 400, 'invalid_number:411'],
    [() => Response.json({ return: false, status_code: 995, message: ['Spamming detected'] }, { status: 400 }), 429, 'rate_limited:995'],
    [() => Response.json({ return: false, status_code: 412, message: ['Invalid Authentication'] }, { status: 401 }), 503, 'auth'],
    [() => new Response('<html>bad gateway</html>', { status: 502 }), 503, 'unavailable'],
    [() => new Response('ok but not json', { status: 200 }), 503, 'rejected'],
  ];
  for (const [provider, httpStatus, failureCode] of cases) {
    const h = harness({ provider });
    const { result } = await withConsole(() => h.run(hookRequest(payload())));
    assert.equal(result.status, httpStatus, failureCode);
    const body = await result.json();
    assert.equal(body.error.http_code, httpStatus);
    assert.doesNotMatch(body.error.message, /balance|wallet|authentication|key/i, 'no operational detail for the customer');
    assert.equal(h.calls.logs[0].status, 'failed');
    assert.ok(h.calls.logs[0].failure_code.startsWith(failureCode.split(':')[0]), failureCode);
  }
});

test('a provider that does not answer in time is cut off (inside Supabase\'s 5 second hook budget)', async () => {
  const h = harness({
    env: { ...DLT, FAST2SMS_TIMEOUT_MS: '500' },
    provider: (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }),
  });
  const started = Date.now();
  const { result } = await withConsole(() => h.run(hookRequest(payload())));
  assert.equal(result.status, 503);
  assert.ok(Date.now() - started < 3000);
  assert.equal(h.calls.logs[0].failure_code, 'timeout');
});

test('a network failure is reported as unavailable without leaking the request URL (which holds the code)', async () => {
  const h = harness({ provider: () => Promise.reject(new TypeError(`fetch failed: https://www.fast2sms.com/dev/bulkV2?variables_values=${OTP}`)) });
  const { result, lines } = await withConsole(() => h.run(hookRequest(payload())));
  assert.equal(result.status, 503);
  assert.doesNotMatch(JSON.stringify([h.calls.logs, lines]), new RegExp(OTP));
  assert.equal(h.calls.logs[0].failure_code, 'unavailable');
});

test('send budgets: per number first, then global; both exhausted states answer 429 and send nothing', async () => {
  const phoneBlocked = harness({ allow: (key) => !key.startsWith('sms:phone:') });
  const globalBlocked = harness({ allow: (key) => key !== 'sms:global' });
  for (const h of [phoneBlocked, globalBlocked]) {
    const res = await h.run(hookRequest(payload()));
    assert.equal(res.status, 429);
    assert.equal(h.calls.fetch.length, 0);
    assert.equal(h.calls.logs[0].status, 'rejected');
  }
  assert.equal(phoneBlocked.calls.logs[0].failure_code, 'phone_budget');
  assert.equal(globalBlocked.calls.logs[0].failure_code, 'global_budget');
});

test('budgets are keyed on the normalised number, so format tricks cannot dodge them', async () => {
  const h = harness();
  await h.run(hookRequest(payload('+919000000301')));
  assert.equal(h.calls.tokens[0].key, 'sms:phone:9000000301');
  assert.equal(h.calls.tokens[1].key, 'sms:global');
  assert.equal(h.calls.tokens[0].capacity, 5);
  assert.equal(h.calls.tokens[1].capacity, 200);
});

test('if the limiter itself is down, nothing is sent (fail closed, no SMS-pumping window)', async () => {
  const h = harness({ limiterThrows: true });
  const { result } = await withConsole(() => h.run(hookRequest(payload())));
  assert.equal(result.status, 503);
  assert.equal(h.calls.fetch.length, 0);
});

test('a logging failure never stops the user getting their code', async () => {
  const h = harness({ logThrows: true });
  assert.equal((await h.run(hookRequest(payload()))).status, 200);
});

test('budget settings can be tuned, but out-of-range values fall back to the safe defaults', async () => {
  const tuned = harness({ env: { ...DLT, SMS_PHONE_BURST: '3', SMS_GLOBAL_PER_HOUR: '50' } });
  await tuned.run(hookRequest(payload()));
  assert.equal(tuned.calls.tokens[0].capacity, 3);
  assert.equal(tuned.calls.tokens[1].capacity, 50);
  const silly = harness({ env: { ...DLT, SMS_PHONE_BURST: '99999', SMS_GLOBAL_PER_HOUR: 'many' } });
  await silly.run(hookRequest(payload()));
  assert.equal(silly.calls.tokens[0].capacity, 5);
  assert.equal(silly.calls.tokens[1].capacity, 200);
});
