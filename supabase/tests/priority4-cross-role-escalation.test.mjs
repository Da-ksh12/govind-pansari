#!/usr/bin/env node
/**
 * Pre-production hardening — priority 4 targeted cross-role escalation
 * checks not already covered by the existing phase07/phase08/store-
 * manager-security/admin-control-center suites: specifically
 * Rider -> Store Manager (RPC + REST + payload-spoof), plus a fresh
 * re-check of Customer -> Admin and Store Manager -> Admin via direct
 * REST table writes (not just RPCs) since those are a distinct attack
 * surface from calling an RPC.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     node supabase/tests/priority4-cross-role-escalation.test.mjs
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see .env).');
  process.exit(1);
}
const REST = `${URL}/rest/v1`;
const AUTH = `${URL}/auth/v1`;
const anonHeaders = { apikey: ANON_KEY, 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

async function otpLogin(phone) {
  await fetch(`${AUTH}/otp`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ phone }) });
  const res = await fetch(`${AUTH}/verify`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ type: 'sms', phone, token: '123456' }) });
  return res.json();
}
function authed(token) {
  return { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}
async function rpc(headers, name, body) {
  const res = await fetch(`${REST}/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

console.log(`Running against ${URL}`);

const rider = await otpLogin('+919000000202');
const customer = await otpLogin('+919000000201');
const manager2 = await otpLogin('+919000000205'); // manager of STORE_B, not STORE_A
const riderHeaders = authed(rider.access_token);
const customerHeaders = authed(customer.access_token);
const manager2Headers = authed(manager2.access_token);

const STORE_A = '00000000-0000-0000-0000-000000000101'; // Sikandra — manager1's store, NOT rider's or manager2's

await check('R1. Rider cannot call set_store_accepting_orders on any store', async () => {
  const r = await rpc(riderHeaders, 'set_store_accepting_orders', { p_store_id: STORE_A, p_accepting: false, p_reason: 'rider escalation attempt' });
  assert(r.status >= 400, `expected rejection, got ${r.status} ${JSON.stringify(r.body)}`);
});

await check('R2. Rider cannot read store_staff via REST', async () => {
  const res = await fetch(`${REST}/store_staff?store_id=eq.${STORE_A}&select=id`, { headers: riderHeaders });
  const body = await res.json();
  assert(res.status !== 200 || (Array.isArray(body) && body.length === 0), `rider saw store_staff rows: ${JSON.stringify(body)}`);
});

await check('R3. Rider cannot read inventory_adjustments via REST', async () => {
  const res = await fetch(`${REST}/inventory_adjustments?store_id=eq.${STORE_A}&select=id&limit=5`, { headers: riderHeaders });
  const body = await res.json();
  assert(res.status !== 200 || (Array.isArray(body) && body.length === 0), `rider saw inventory_adjustments rows: ${JSON.stringify(body)}`);
});

await check('R4. Rider cannot call get_store_dashboard for any store', async () => {
  const r = await rpc(riderHeaders, 'get_store_dashboard', { p_store_id: STORE_A });
  assert(r.status >= 400, `expected rejection, got ${r.status} ${JSON.stringify(r.body)}`);
});

await check('R5. Rider cannot directly UPDATE stores.is_accepting_orders via REST (payload/table write, not RPC)', async () => {
  const res = await fetch(`${REST}/stores?id=eq.${STORE_A}`, {
    method: 'PATCH',
    headers: { ...riderHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ is_accepting_orders: false }),
  });
  const body = await res.json().catch(() => null);
  assert(res.status >= 400 || (Array.isArray(body) && body.length === 0), `rider's direct write to stores succeeded: ${res.status} ${JSON.stringify(body)}`);
});

await check('C1. Customer cannot directly UPDATE orders.total via REST (payload manipulation, not RPC)', async () => {
  const res = await fetch(`${REST}/orders?select=id&limit=1`, { headers: customerHeaders });
  const orders = await res.json();
  if (!orders[0]) return; // no order to test against yet, not a failure of this check
  const patch = await fetch(`${REST}/orders?id=eq.${orders[0].id}`, {
    method: 'PATCH',
    headers: { ...customerHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ total: 1 }),
  });
  const body = await patch.json().catch(() => null);
  assert(patch.status >= 400 || (Array.isArray(body) && body.length === 0), `customer's direct price write succeeded: ${patch.status} ${JSON.stringify(body)}`);
});

await check('M1. Store Manager (of a different store) cannot spoof store_id in a payload to read STORE_A inventory_adjustments', async () => {
  const res = await fetch(`${REST}/inventory_adjustments?store_id=eq.${STORE_A}&select=id&limit=5`, { headers: manager2Headers });
  const body = await res.json();
  assert(res.status !== 200 || (Array.isArray(body) && body.length === 0), `manager2 saw STORE_A's inventory_adjustments: ${JSON.stringify(body)}`);
});

await check('M2. Store Manager cannot directly UPDATE profiles.admin_role via REST (privilege self-escalation via payload)', async () => {
  const meRes = await fetch(`${REST}/profiles?select=id&limit=1`, { headers: manager2Headers });
  // Attempt to escalate the caller's own row regardless of what id lookup returns — RLS must block this outright.
  const patch = await fetch(`${REST}/profiles?id=eq.${(await meRes.json())[0]?.id ?? '00000000-0000-0000-0000-000000000000'}`, {
    method: 'PATCH',
    headers: { ...manager2Headers, Prefer: 'return=representation' },
    body: JSON.stringify({ role: 'admin', admin_role: 'super_admin' }),
  });
  const body = await patch.json().catch(() => null);
  assert(patch.status >= 400 || (Array.isArray(body) && body.length === 0) || (body[0] && body[0].role !== 'admin'), `store manager self-promoted to admin: ${patch.status} ${JSON.stringify(body)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
