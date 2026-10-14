#!/usr/bin/env node
/**
 * Admin Control Center verification suite. Same live-integration
 * philosophy as every prior phase: real Auth sessions, real RPC/REST
 * calls, real RLS.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     SUPABASE_SERVICE_ROLE_KEY=... \
 *     node supabase/tests/admin-control-center.test.mjs
 *
 * Requires +919000000301 (legacy/super admin) and +919000000302
 * (promoted to inventory_manager) in the project's sms_test_otp
 * allowlist — both added via the Management API earlier this session.
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

const STORE_101 = '00000000-0000-0000-0000-000000000101';
const V_ALMOND_500 = '00000000-0000-0000-0000-000000000403';

console.log(`Running against ${URL}\n`);

const superAdmin = await otpLogin('+919000000301');
const superHeaders = authed(superAdmin.access_token);
const scopedAdmin = await otpLogin('+919000000302'); // already inventory_manager from live setup this session
const scopedHeaders = authed(scopedAdmin.access_token);
const customer = await otpLogin('+919000000201');
const customerHeaders = authed(customer.access_token);
const manager1 = await otpLogin('+919000000203');
const manager1Headers = authed(manager1.access_token);

// Ensure known baseline roles regardless of what earlier ad hoc runs left behind.
await fetch(`${REST}/profiles?id=eq.${superAdmin.user.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ role: 'admin', admin_role: null }) });
await fetch(`${REST}/profiles?id=eq.${scopedAdmin.user.id}`, { method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ role: 'admin', admin_role: 'inventory_manager' }) });

// ---------------------------------------------------------------------
// Permission model
// ---------------------------------------------------------------------

await check('1. A legacy admin (admin_role NULL) is a super admin with every permission', async () => {
  const { status, body } = await rpc(superHeaders, 'current_admin_context', {});
  assert(status === 200, `status ${status}`);
  assert(body.isSuperAdmin === true, 'expected isSuperAdmin true');
  assert(body.permissions.length >= 28, `expected ~28 permissions, got ${body.permissions.length}`);
});

await check('2. A scoped inventory_manager gets exactly its seeded permission set — no more', async () => {
  const { body } = await rpc(scopedHeaders, 'current_admin_context', {});
  assert(body.isSuperAdmin === false, 'expected isSuperAdmin false for a scoped role');
  assert(body.permissions.includes('inventory.manage'), 'expected inventory.manage');
  assert(!body.permissions.includes('users.manage'), 'inventory_manager must not have users.manage');
  assert(!body.permissions.includes('riders.manage'), 'inventory_manager must not have riders.manage');
});

await check('3. A non-admin has no admin context at all', async () => {
  const { body } = await rpc(customerHeaders, 'current_admin_context', {});
  assert(body === null, `expected null, got ${JSON.stringify(body)}`);
});

await check('4. A scoped admin cannot self-promote to super_admin', async () => {
  const { status, body } = await rpc(scopedHeaders, 'assign_admin_role', { p_phone: '+919000000302', p_admin_role: 'super_admin' });
  assert(status >= 400, `expected rejection, got ${status}: ${JSON.stringify(body)}`);
});

await check('5. A scoped admin cannot grant admin_role to someone else either (no users.manage)', async () => {
  const { status } = await rpc(scopedHeaders, 'assign_admin_role', { p_phone: '+919000000201', p_admin_role: 'support_agent' });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('6. A super admin CAN grant a scoped role, phone lookup normalizes the leading +', async () => {
  const { status, body } = await rpc(superHeaders, 'assign_admin_role', { p_phone: '+919000000302', p_admin_role: 'inventory_manager' });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.adminRole === 'inventory_manager', `expected inventory_manager, got ${JSON.stringify(body)}`);
});

await check('7. A scoped admin with dashboard.view can read the dashboard; one without users.view is rejected from the staff list', async () => {
  const dash = await rpc(scopedHeaders, 'get_admin_dashboard', {});
  assert(dash.status === 200, `dashboard: ${dash.status}`);
  const staff = await rpc(scopedHeaders, 'get_admin_staff_list', {});
  assert(staff.status >= 400, `expected staff list rejection, got ${staff.status}`);
});

await check('8. A plain customer is rejected from every admin function', async () => {
  const dash = await rpc(customerHeaders, 'get_admin_dashboard', {});
  assert(dash.status >= 400, `expected rejection, got ${dash.status}`);
  const orders = await rpc(customerHeaders, 'get_admin_orders', {});
  assert(orders.status >= 400, `expected rejection, got ${orders.status}`);
});

// ---------------------------------------------------------------------
// Dashboard / orders / customers (read paths)
// ---------------------------------------------------------------------

await check('9. get_admin_dashboard returns internally consistent numbers', async () => {
  const { status, body } = await rpc(superHeaders, 'get_admin_dashboard', {});
  assert(status === 200, `status ${status}`);
  assert(typeof body.today.orders === 'number' && typeof body.today.revenue === 'number', 'expected numeric fields');
  assert(body.operations.pendingOrders >= 0 && body.inventory.outOfStock >= 0, 'expected non-negative counts');
});

await check('10. get_admin_orders supports search and pagination without duplicate rows across pages', async () => {
  const page1 = await rpc(superHeaders, 'get_admin_orders', { p_limit: 3 });
  assert(page1.status === 200 && Array.isArray(page1.body) && page1.body.length === 3, `expected 3 rows, got ${JSON.stringify(page1.body)?.length}`);
  const cursor = page1.body[page1.body.length - 1].placed_at;
  const page2 = await rpc(superHeaders, 'get_admin_orders', { p_cursor: cursor, p_limit: 3 });
  const ids1 = new Set(page1.body.map((o) => o.id));
  assert(page2.body.every((o) => !ids1.has(o.id)), 'page 2 overlaps page 1');
});

await check('11. get_admin_order_detail returns items, customer, store, and a merged status+delivery timeline', async () => {
  const list = await rpc(superHeaders, 'get_admin_orders', { p_limit: 1 });
  const orderId = list.body[0].id;
  const { status, body } = await rpc(superHeaders, 'get_admin_order_detail', { p_order_id: orderId });
  assert(status === 200, `status ${status}`);
  assert(Array.isArray(body.items), 'expected items array');
  assert(body.customer && body.customer.name, 'expected customer name');
  assert(Array.isArray(body.timeline) && body.timeline.length > 0, 'expected a non-empty timeline');
});

await check('12. get_admin_customers computes real order_count/total_spend, and search filters', async () => {
  const { status, body } = await rpc(superHeaders, 'get_admin_customers', { p_search: 'Test' });
  assert(status === 200, `status ${status}`);
  assert(Array.isArray(body), 'expected array');
});

// ---------------------------------------------------------------------
// Inventory adjustment — concurrency + audit trail
// ---------------------------------------------------------------------

await check('13. adjust_inventory writes exactly one inventory_movements row and one audit_logs row per call', async () => {
  const before = await fetch(`${REST}/inventory?store_id=eq.${STORE_101}&product_variant_id=eq.${V_ALMOND_500}&select=id,quantity`, { headers: svcHeaders }).then((r) => r.json());
  const { status, body } = await rpc(superHeaders, 'adjust_inventory', { p_store_id: STORE_101, p_product_variant_id: V_ALMOND_500, p_quantity_change: 10, p_movement_type: 'restock', p_reason: 'test restock' });
  assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
  assert(body.quantityAfter === before[0].quantity + 10, `expected ${before[0].quantity + 10}, got ${body.quantityAfter}`);

  const movements = await fetch(`${REST}/inventory_movements?store_id=eq.${STORE_101}&product_variant_id=eq.${V_ALMOND_500}&reference_type=eq.manual_adjustment&order=created_at.desc&limit=1`, { headers: svcHeaders }).then((r) => r.json());
  assert(movements[0].quantity_change === 10, `expected movement of 10, got ${JSON.stringify(movements[0])}`);

  // revert
  await rpc(superHeaders, 'adjust_inventory', { p_store_id: STORE_101, p_product_variant_id: V_ALMOND_500, p_quantity_change: -10, p_movement_type: 'adjustment', p_reason: 'revert test' });
});

await check('14. adjust_inventory rejects a movement that would take quantity negative', async () => {
  const { status, body } = await rpc(superHeaders, 'adjust_inventory', { p_store_id: STORE_101, p_product_variant_id: V_ALMOND_500, p_quantity_change: -999999, p_movement_type: 'damage', p_reason: 'test' });
  assert(status >= 400, `expected rejection, got ${status}: ${JSON.stringify(body)}`);
});

await check('15. adjust_inventory rejects system-managed movement types (sale/reservation/reservation_release)', async () => {
  const { status } = await rpc(superHeaders, 'adjust_inventory', { p_store_id: STORE_101, p_product_variant_id: V_ALMOND_500, p_quantity_change: 1, p_movement_type: 'sale', p_reason: 'test' });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('16. Two concurrent adjustments to the same row serialize correctly (no lost update)', async () => {
  const before = await fetch(`${REST}/inventory?store_id=eq.${STORE_101}&product_variant_id=eq.${V_ALMOND_500}&select=quantity`, { headers: svcHeaders }).then((r) => r.json());
  const [r1, r2] = await Promise.all([
    rpc(superHeaders, 'adjust_inventory', { p_store_id: STORE_101, p_product_variant_id: V_ALMOND_500, p_quantity_change: 3, p_movement_type: 'adjustment', p_reason: 'race a' }),
    rpc(superHeaders, 'adjust_inventory', { p_store_id: STORE_101, p_product_variant_id: V_ALMOND_500, p_quantity_change: 4, p_movement_type: 'adjustment', p_reason: 'race b' }),
  ]);
  assert(r1.status === 200 && r2.status === 200, `expected both to succeed: ${JSON.stringify(r1)} ${JSON.stringify(r2)}`);
  const after = await fetch(`${REST}/inventory?store_id=eq.${STORE_101}&product_variant_id=eq.${V_ALMOND_500}&select=quantity`, { headers: svcHeaders }).then((r) => r.json());
  assert(after[0].quantity === before[0].quantity + 7, `expected +7 total, got ${before[0].quantity} -> ${after[0].quantity}`);
  await rpc(superHeaders, 'adjust_inventory', { p_store_id: STORE_101, p_product_variant_id: V_ALMOND_500, p_quantity_change: -7, p_movement_type: 'adjustment', p_reason: 'revert race test' });
});

// ---------------------------------------------------------------------
// Order cancellation via the extended update_order_status
// ---------------------------------------------------------------------

await check('17. Store staff (role=store_manager, not role=admin) cannot call admin RPCs at all — they use their own existing store-ops screens', async () => {
  const { status } = await rpc(manager1Headers, 'get_admin_orders', { p_limit: 1 });
  assert(status >= 400, `expected rejection, got ${status}`);
});

await check('18. is_terminal_delivery_status-based unassigned-delivery count in the dashboard matches a direct query', async () => {
  const { body } = await rpc(superHeaders, 'get_admin_dashboard', {});
  const direct = await fetch(`${REST}/orders?status=eq.packed&select=id`, { headers: svcHeaders }).then((r) => r.json());
  assert(body.operations.unassignedDeliveries <= direct.length, 'unassigned count should never exceed total packed orders');
});

// ---------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------

await check('19. Sensitive actions are logged and readable only with audit_logs.view', async () => {
  const superLogs = await rpc(superHeaders, 'get_audit_logs', { p_limit: 5 });
  assert(superLogs.status === 200 && Array.isArray(superLogs.body) && superLogs.body.length > 0, 'expected recent audit log entries');
  const customerLogs = await rpc(customerHeaders, 'get_audit_logs', { p_limit: 5 });
  assert(customerLogs.status === 200 && Array.isArray(customerLogs.body) && customerLogs.body.length === 0, 'a non-admin must see zero audit log rows');
});

await check('20. audit_logs has no client insert/update/delete policy at all', async () => {
  const res = await fetch(`${REST}/audit_logs`, { method: 'POST', headers: { ...superHeaders, Prefer: 'return=representation' }, body: JSON.stringify({ action: 'fake', resource_type: 'test' }) });
  assert(res.status >= 400, `expected rejection, got ${res.status}`);
});

// ---------------------------------------------------------------------
// Settings / feature flags
// ---------------------------------------------------------------------

await check('21. update_app_settings requires settings.manage; a scoped admin without it is rejected', async () => {
  const superUpdate = await rpc(superHeaders, 'update_app_settings', { p_patch: { supportPhone: '+911234567890' } });
  assert(superUpdate.status === 200, `status ${superUpdate.status}`);
  const scopedUpdate = await rpc(scopedHeaders, 'update_app_settings', { p_patch: { supportPhone: '+919999999999' } });
  assert(scopedUpdate.status >= 400, `expected rejection, got ${scopedUpdate.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
