#!/usr/bin/env node
/**
 * Admin dashboard consistency suite (QA report TC-05/06/07/08/09/10/11/14/15/16).
 * READ-ONLY: signs in as the QA super admin and compares what the dashboard
 * says with what the lists behind it hold. It writes nothing, so it is safe
 * to run against live data — but it needs migrations 20260827000002-09
 * applied, and fails (by design) against a database that predates them.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     node supabase/tests/admin-dashboard-consistency.test.mjs
 *
 * Requires +919000000301 in the project's sms_test_otp allowlist (same as
 * admin-control-center.test.mjs). Numbers are compared to each other, never
 * to hard-coded values, so the suite keeps working as live data changes.
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
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
    console.log(`FAIL  ${name}\n      ${e.message}`);
    failed++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function assertEqual(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

async function otpLogin(phone) {
  await fetch(`${AUTH}/otp`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ phone }) });
  const res = await fetch(`${AUTH}/verify`, { method: 'POST', headers: anonHeaders, body: JSON.stringify({ type: 'sms', phone, token: '123456' }) });
  return res.json();
}
const session = await otpLogin('+919000000301');
if (!session.access_token) {
  console.error('QA admin login failed — is +919000000301 in the sms_test_otp allowlist?');
  process.exit(1);
}
const headers = { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };

async function rpc(name, body) {
  const res = await fetch(`${REST}/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${name} -> ${res.status} ${json?.code ?? ''} ${json?.message ?? ''}`.trim());
  return json;
}
async function get(path) {
  const res = await fetch(`${REST}/${path}`, { headers });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`GET ${path.split('?')[0]} -> ${res.status} ${json?.code ?? ''} ${json?.message ?? ''}`.trim());
  return json;
}

/** Every row of a get_admin_orders view/filter, following the cursor (the RPC caps a page at 50). */
async function allAdminOrders(args) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 200; page++) {
    const batch = await rpc('get_admin_orders', { p_limit: 50, p_cursor: cursor, ...args });
    rows.push(...batch);
    if (batch.length < 50) break;
    cursor = batch[batch.length - 1].placed_at;
  }
  return rows;
}

/** 00:00 Asia/Kolkata today, as an ISO string — the business-day boundary the SQL uses. */
function istDayStartIso() {
  const OFFSET_MS = 5.5 * 3600 * 1000;
  const istNow = new Date(Date.now() + OFFSET_MS);
  istNow.setUTCHours(0, 0, 0, 0);
  return new Date(istNow.getTime() - OFFSET_MS).toISOString();
}

const awaitsOnline = (o) => {
  if (o.payment_status === 'paid' || !o.payments?.length) return false;
  const latest = o.payments.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  return latest.method !== 'cod';
};

console.log(`Running against ${URL}\n`);

const dashboard = await rpc('get_admin_dashboard');
const ops = dashboard.operations;

await check('dashboard returns the consistent-definition fields (migration 104 applied)', () => {
  assert(typeof ops.activeOrders === 'number', 'operations.activeOrders missing');
  assert(ops.byStatus && typeof ops.byStatus === 'object', 'operations.byStatus missing');
  assert(typeof ops.stuckDeliveries === 'number', 'operations.stuckDeliveries missing');
  assert(typeof ops.awaitingPayment === 'number', 'operations.awaitingPayment missing');
});

await check('TC-15: the pipeline stages add up to Active Orders', () => {
  const total = Object.values(ops.byStatus).reduce((s, n) => s + Number(n), 0);
  assertEqual(total, ops.activeOrders, 'sum of operations.byStatus');
});

await check('TC-07: the Active Orders list holds exactly the orders the card counted', async () => {
  const rows = await allAdminOrders({ p_view: 'active' });
  assertEqual(rows.length, ops.activeOrders, 'rows in the active view');
});

await check('TC-16: each pipeline stage opens a list as long as the stage count', async () => {
  const stages = {
    placed: ['placed'],
    confirmed: ['confirmed'],
    preparing: ['preparing', 'picking', 'packing'],
    packed: ['packed'],
    rider_assigned: ['rider_assigned'],
    onway: ['out_for_delivery', 'approaching'],
  };
  for (const [name, statuses] of Object.entries(stages)) {
    const counted = statuses.reduce((s, st) => s + Number(ops.byStatus[st] ?? 0), 0);
    const rows = await allAdminOrders({ p_statuses: statuses });
    assertEqual(rows.length, counted, `stage "${name}"`);
  }
});

await check('TC-11: Needs Rider list matches the Assign Rider count and only holds packed orders', async () => {
  const rows = await allAdminOrders({ p_view: 'needs_rider' });
  assertEqual(rows.length, ops.unassignedDeliveries, 'rows in the needs_rider view');
  assert(rows.every((r) => r.status === 'packed'), 'a non-packed order is in the needs-rider list');
  assert(rows.every((r) => r.active_delivery_id === null), 'an order with a live delivery is in the needs-rider list');
});

await check('Delivery issues list matches the stuck-deliveries count', async () => {
  const rows = await allAdminOrders({ p_view: 'stuck_delivery' });
  assertEqual(rows.length, ops.stuckDeliveries, 'rows in the stuck_delivery view');
});

await check('an unknown orders view is rejected by the database, not silently ignored', async () => {
  let message = null;
  try {
    await rpc('get_admin_orders', { p_view: 'nonsense' });
  } catch (e) {
    message = e.message;
  }
  assert(message !== null, 'get_admin_orders accepted an unknown view');
  // A missing function (migration not applied) is also an error, so insist on the function's own message.
  assert(/unknown orders view/i.test(message), `rejected for the wrong reason: ${message}`);
});

await check('TC-05/14: today revenue = booked sales since 00:00 IST (non-cancelled, not awaiting online payment)', async () => {
  const since = istDayStartIso();
  const orders = await get(`orders?select=id,total,status,payment_status,placed_at,payments(method,created_at)&placed_at=gte.${encodeURIComponent(since)}&limit=1000`);
  const expected = orders
    .filter((o) => o.status !== 'cancelled' && !awaitsOnline(o))
    .reduce((s, o) => s + Math.round(Number(o.total) * 100), 0);
  assertEqual(Math.round(Number(dashboard.today.revenue) * 100), expected, 'today.revenue in paise');
});

await check('TC-14: per-store revenue adds up to the dashboard revenue (same day boundary, same definition)', async () => {
  const stores = await rpc('get_admin_store_performance');
  assert(stores.length > 0, 'no stores returned');
  assert(stores.every((st) => st.today_revenue !== undefined), 'store rows have no today_revenue field');
  const sum = stores.reduce((s, st) => s + Math.round(Number(st.today_revenue) * 100), 0);
  assertEqual(sum, Math.round(Number(dashboard.today.revenue) * 100), 'sum of store revenue in paise');
});

await check('TC-14: the store manager dashboard agrees with the admin dashboard (migration 109)', async () => {
  const stores = await get('stores?select=id&is_active=eq.true');
  let sum = 0;
  for (const s of stores) {
    const d = await rpc('get_store_dashboard', { p_store_id: s.id });
    sum += Math.round(Number(d.todayRevenue) * 100);
  }
  assertEqual(sum, Math.round(Number(dashboard.today.revenue) * 100), 'sum of store-dashboard revenue in paise');
});

await check('TC-06: the analytics page (what the Revenue card opens) shows the same figure as the card for today', async () => {
  const analytics = await rpc('get_admin_analytics', { p_days: 1 });
  assert(analytics.totals && analytics.totals.revenue !== undefined, 'analytics response has no totals.revenue');
  assertEqual(Math.round(Number(analytics.totals.revenue) * 100), Math.round(Number(dashboard.today.revenue) * 100), 'analytics revenue in paise');
});

await check('TC-10: the deliveries query (named customer relationship) succeeds', async () => {
  const select =
    'id,status,assigned_at,order_id,orders(order_number,total,order_items(image_snapshot),profiles!orders_user_id_fkey(full_name)),riders(id,vehicle_type,profiles(full_name,avatar_url)),stores(name)';
  const rows = await get(`delivery_assignments?select=${encodeURIComponent(select)}&order=assigned_at.desc&limit=60`);
  assert(Array.isArray(rows), 'no rows array');
});

await check('TC-10 (regression guard): the ambiguous embed really is rejected, so the named one is needed', async () => {
  const res = await fetch(`${REST}/delivery_assignments?select=${encodeURIComponent('id,orders(order_number,profiles(full_name))')}&limit=1`, { headers });
  const json = await res.json().catch(() => null);
  assert(res.status === 300 || json?.code === 'PGRST201', `expected PGRST201 for the ambiguous embed, got ${res.status}`);
});

await check('TC-08/09: low-stock and out-of-stock counts are unchanged in meaning', async () => {
  const inv = await get('inventory?select=quantity,reserved_quantity,reorder_level,is_available&limit=5000');
  const available = (i) => i.quantity - i.reserved_quantity;
  const low = inv.filter((i) => i.is_available && available(i) > 0 && available(i) <= i.reorder_level).length;
  const out = inv.filter((i) => available(i) <= 0).length;
  assertEqual(dashboard.inventory.lowStock, low, 'inventory.lowStock');
  assertEqual(dashboard.inventory.outOfStock, out, 'inventory.outOfStock');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
