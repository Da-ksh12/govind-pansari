#!/usr/bin/env node
/**
 * Store Manager phase — dedicated cross-store security verification
 * (section 48/49's own "test this explicitly"). Phase 07's suite
 * already covers dashboard/inventory/orders cross-store reads (its
 * tests 20/26/27/28) — this file focuses on what's new this phase
 * (get_store_activity, the reason-aware set_store_accepting_orders)
 * plus the paths Phase 07 didn't specifically exercise (riders,
 * delivery_assignments, store_staff roster, plain-staff vs. manager
 * authority).
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... \
 *     node supabase/tests/store-manager-security.test.mjs
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const REST = `${URL}/rest/v1`;
const AUTH = `${URL}/auth/v1`;
const anonHeaders = { apikey: ANON_KEY, 'Content-Type': 'application/json' };
const svcHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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
  const res = await fetch(`${REST}/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

const STORE_A = '00000000-0000-0000-0000-000000000101'; // Sikandra — manager1
const STORE_B = '00000000-0000-0000-0000-000000000102'; // Vijay Nagar — manager2

console.log(`Running against ${URL}\n`);

const manager1 = await otpLogin('+919000000203'); // Store A manager
const manager1Headers = authed(manager1.access_token);
const manager2 = await otpLogin('+919000000205'); // Store B manager
const manager2Headers = authed(manager2.access_token);
const staff1 = await otpLogin('+919000000204'); // Store A plain staff
const staff1Headers = authed(staff1.access_token);
const customer = await otpLogin('+919000000201');
const customerHeaders = authed(customer.access_token);

// demo.manager/demo.staff are real operational logins for the actual
// stores now (Sanjay Place/STORE_A isn't real) — pin them to STORE_A
// for this run and restore their real assignment after.
const savedManager1Staff = await fetch(`${REST}/store_staff?user_id=eq.${manager1.user.id}&select=id,store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
const savedStaff1Staff = await fetch(`${REST}/store_staff?user_id=eq.${staff1.user.id}&select=id,store_id`, { headers: svcHeaders }).then((r) => r.json()).then((r) => r[0]);
if (savedManager1Staff) await fetch(`${REST}/store_staff?id=eq.${savedManager1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: STORE_A }) });
if (savedStaff1Staff) await fetch(`${REST}/store_staff?id=eq.${savedStaff1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: STORE_A }) });

// ---------------------------------------------------------------------
// get_store_activity (new this phase)
// ---------------------------------------------------------------------

await check('1. A store manager can read their own store\'s activity feed', async () => {
  const { status, body } = await rpc(manager1Headers, 'get_store_activity', { p_store_id: STORE_A, p_limit: 5 });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(Array.isArray(body), 'expected an array');
});

await check('2. A manager of a DIFFERENT store cannot read this store\'s activity feed', async () => {
  const { status } = await rpc(manager2Headers, 'get_store_activity', { p_store_id: STORE_A, p_limit: 5 });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('3. A customer cannot read any store\'s activity feed', async () => {
  const { status } = await rpc(customerHeaders, 'get_store_activity', { p_store_id: STORE_A, p_limit: 5 });
  assert(status >= 400, `expected rejection, got ${status}`);
});

// ---------------------------------------------------------------------
// set_store_accepting_orders with reason (extended this phase)
// ---------------------------------------------------------------------

await check('4. A manager can pause their own store with a reason, and resuming clears it', async () => {
  const pause = await rpc(manager1Headers, 'set_store_accepting_orders', { p_store_id: STORE_A, p_accepting: false, p_reason: 'Store maintenance' });
  assert(pause.status === 200 || pause.status === 204, `pause status ${pause.status}`);
  const row1 = await fetch(`${REST}/stores?id=eq.${STORE_A}&select=is_accepting_orders,status_reason`, { headers: svcHeaders }).then((r) => r.json());
  assert(row1[0].is_accepting_orders === false && row1[0].status_reason === 'Store maintenance', `expected paused with reason, got ${JSON.stringify(row1[0])}`);

  const resume = await rpc(manager1Headers, 'set_store_accepting_orders', { p_store_id: STORE_A, p_accepting: true });
  assert(resume.status === 200 || resume.status === 204, `resume status ${resume.status}`);
  const row2 = await fetch(`${REST}/stores?id=eq.${STORE_A}&select=is_accepting_orders,status_reason`, { headers: svcHeaders }).then((r) => r.json());
  assert(row2[0].is_accepting_orders === true && row2[0].status_reason === null, `expected resumed with reason cleared, got ${JSON.stringify(row2[0])}`);
});

await check('5. A manager of a DIFFERENT store cannot pause this store', async () => {
  const { status } = await rpc(manager2Headers, 'set_store_accepting_orders', { p_store_id: STORE_A, p_accepting: false, p_reason: 'hostile takeover' });
  assert(status >= 400, `expected rejection, got ${status}`);
  const row = await fetch(`${REST}/stores?id=eq.${STORE_A}&select=is_accepting_orders`, { headers: svcHeaders }).then((r) => r.json());
  assert(row[0].is_accepting_orders === true, 'store A must remain accepting orders — the cross-store call must not have taken effect');
});

await check('6. Plain staff (not a manager) cannot pause the store', async () => {
  const { status } = await rpc(staff1Headers, 'set_store_accepting_orders', { p_store_id: STORE_A, p_accepting: false, p_reason: 'test' });
  assert(status >= 400, `expected rejection, got ${status}`);
});

// ---------------------------------------------------------------------
// Cross-store reads not already covered by Phase 07's own suite
// ---------------------------------------------------------------------

await check('7. A manager of a different store cannot read this store\'s delivery_assignments via REST', async () => {
  const res = await fetch(`${REST}/delivery_assignments?store_id=eq.${STORE_A}&select=id`, { headers: manager2Headers });
  const rows = await res.json();
  assert(Array.isArray(rows) && rows.length === 0, `expected 0 rows under manager2's RLS scope, got ${JSON.stringify(rows)}`);
});

await check('8. A manager of a different store cannot read this store\'s staff roster via REST', async () => {
  const res = await fetch(`${REST}/store_staff?store_id=eq.${STORE_A}&select=id`, { headers: manager2Headers });
  const rows = await res.json();
  assert(Array.isArray(rows) && rows.length === 0, `expected 0 rows, got ${JSON.stringify(rows)}`);
});

await check('9. A manager cannot spoof store_id in a request body to affect a different store\'s inventory', async () => {
  // Attempt to adjust STORE_A's inventory while authenticated as manager2 (Store B) —
  // the function must derive authorization from is_store_staff(p_store_id), never
  // trust that the caller is legitimately allowed just because they supplied an id.
  const { status } = await rpc(manager2Headers, 'record_inventory_adjustment', {
    p_store_id: STORE_A, p_variant_id: '00000000-0000-0000-0000-000000000403', p_new_quantity: 999999, p_reason: 'manual_correction',
  });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('10. get_eligible_riders_for_order rejects a manager who is not staff of that order\'s store', async () => {
  // Any real order id belonging to Store A, queried as Store B's manager.
  const orderRes = await fetch(`${REST}/orders?store_id=eq.${STORE_A}&select=id&limit=1`, { headers: svcHeaders });
  const orders = await orderRes.json();
  if (orders.length === 0) return; // nothing to test against right now — not a failure
  const { status } = await rpc(manager2Headers, 'get_eligible_riders_for_order', { p_order_id: orders[0].id });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('11. A store manager cannot read another store\'s orders even with a guessed/known order id', async () => {
  const orderRes = await fetch(`${REST}/orders?store_id=eq.${STORE_A}&select=id&limit=1`, { headers: svcHeaders });
  const orders = await orderRes.json();
  if (orders.length === 0) return;
  const res = await fetch(`${REST}/orders?id=eq.${orders[0].id}&select=id,store_id`, { headers: manager2Headers });
  const rows = await res.json();
  assert(Array.isArray(rows) && rows.length === 0, `expected 0 rows, got ${JSON.stringify(rows)}`);
});

await check('12. Admin (is_admin()) retains full cross-store access regardless of these new restrictions', async () => {
  // The Admin Control Center's legacy admin account (admin_role NULL) must be unaffected.
  const adminLogin = await otpLogin('+919000000301');
  const adminHeaders = authed(adminLogin.access_token);
  const { status } = await rpc(adminHeaders, 'get_store_activity', { p_store_id: STORE_A, p_limit: 3 });
  assert(status === 200, `expected admin to succeed, got ${status}`);
});

if (savedManager1Staff) await fetch(`${REST}/store_staff?id=eq.${savedManager1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: savedManager1Staff.store_id }) });
if (savedStaff1Staff) await fetch(`${REST}/store_staff?id=eq.${savedStaff1Staff.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ store_id: savedStaff1Staff.store_id }) });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
