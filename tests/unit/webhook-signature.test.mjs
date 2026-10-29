// Standard Webhooks verification (Supabase Auth hook signatures).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { parseHookSecret, verifyStandardWebhook } from '../../supabase/functions/_shared/standardWebhooks.ts';

const KEY = randomBytes(32);
const SECRET = `v1,whsec_${KEY.toString('base64')}`;
const BODY = '{"user":{"phone":"919000000301"},"sms":{"otp":"123456"}}';
const NOW = 1_800_000_000;
const sig = (id, ts, body, key = KEY) => 'v1,' + createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
const headers = (h) => ({ get: (name) => h[name.toLowerCase()] ?? null });
const good = () => headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(NOW), 'webhook-signature': sig('msg_1', NOW, BODY) });
const verify = (over = {}) => verifyStandardWebhook({ secret: SECRET, rawBody: BODY, headers: good(), nowSeconds: NOW, ...over });

test('a valid signature verifies', async () => {
  assert.equal(await verify(), true);
});

test('the secret may be given with or without its prefixes', async () => {
  for (const s of [SECRET, `whsec_${KEY.toString('base64')}`, KEY.toString('base64')]) assert.equal(await verify({ secret: s }), true, s.slice(0, 12));
  assert.deepEqual([...parseHookSecret(SECRET)], [...KEY]);
});

test('a tampered body, id or timestamp does not verify', async () => {
  assert.equal(await verify({ rawBody: BODY.replace('123456', '654321') }), false);
  assert.equal(await verify({ headers: headers({ 'webhook-id': 'msg_2', 'webhook-timestamp': String(NOW), 'webhook-signature': sig('msg_1', NOW, BODY) }) }), false);
  assert.equal(await verify({ headers: headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(NOW + 1), 'webhook-signature': sig('msg_1', NOW, BODY) }) }), false);
});

test('a different secret does not verify', async () => {
  assert.equal(await verify({ secret: `v1,whsec_${randomBytes(32).toString('base64')}` }), false);
});

test('replay protection: timestamps outside the tolerance are refused, in both directions', async () => {
  const at = (ts) => headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(ts), 'webhook-signature': sig('msg_1', ts, BODY) });
  assert.equal(await verify({ headers: at(NOW - 299) }), true);
  assert.equal(await verify({ headers: at(NOW - 301) }), false);
  assert.equal(await verify({ headers: at(NOW + 301) }), false);
  assert.equal(await verify({ headers: at(NOW - 301), toleranceSeconds: 600 }), true);
});

test('missing or malformed headers are refused', async () => {
  const base = { 'webhook-id': 'msg_1', 'webhook-timestamp': String(NOW), 'webhook-signature': sig('msg_1', NOW, BODY) };
  for (const drop of Object.keys(base)) {
    const copy = { ...base };
    delete copy[drop];
    assert.equal(await verify({ headers: headers(copy) }), false, drop);
  }
  assert.equal(await verify({ headers: headers({ ...base, 'webhook-timestamp': 'yesterday' }) }), false);
  assert.equal(await verify({ headers: headers({ ...base, 'webhook-timestamp': `${NOW}.5` }) }), false);
  assert.equal(await verify({ headers: headers({ ...base, 'webhook-signature': 'garbage' }) }), false);
  assert.equal(await verify({ headers: headers({ ...base, 'webhook-signature': base['webhook-signature'].slice(3) }) }), false, 'no v1, prefix');
  assert.equal(await verify({ headers: headers({ ...base, 'webhook-signature': 'v2,' + base['webhook-signature'].slice(3) }) }), false);
});

test('several signatures in one header: any matching one is enough', async () => {
  const h = headers({ 'webhook-id': 'msg_1', 'webhook-timestamp': String(NOW), 'webhook-signature': `v1,AAAAAAAA ${sig('msg_1', NOW, BODY)}` });
  assert.equal(await verify({ headers: h }), true);
});

test('rotation: several secrets separated by | — any matching one verifies; a malformed one is skipped', async () => {
  const other = `v1,whsec_${randomBytes(32).toString('base64')}`;
  assert.equal(await verify({ secret: `${other}|${SECRET}` }), true);
  assert.equal(await verify({ secret: `${SECRET}|${other}` }), true);
  assert.equal(await verify({ secret: `!!!not-base64!!!|${SECRET}` }), true);
  assert.equal(await verify({ secret: other }), false);
  assert.equal(await verify({ secret: '' }), false);
});
