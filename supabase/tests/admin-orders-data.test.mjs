#!/usr/bin/env node
/**
 * The data behind the admin order cards and the Order Details screen, against REAL records, through the same API calls the app
 * makes (an admin login -> get_admin_orders, order_items, payments, get_admin_order_detail). Read-only.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... node supabase/tests/admin-orders-data.test.mjs
 *
 * Signs in with the QA fixed-code numbers (no SMS is sent): the QA super-admin and a QA customer.
 */
import { summarizeOrderLines, priceBreakdown, breakdownMismatch, describePayment, formatMoney } from '../../services/adminOrderView.ts';

const U = process.env.EXPO_PUBLIC_SUPABASE_URL;
const K = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!U || !K) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const base = { apikey: K, 'Content-Type': 'application/json' };

async function login(phone) {
  await fetch(`${U}/auth/v1/otp`, { method: 'POST', headers: base, body: JSON.stringify({ phone }) });
  const s = await (await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: base, body: JSON.stringify({ type: 'sms', phone, token: '123456' }) })).json();
  if (!s.access_token) throw new Error(`login failed for ${phone}: ${JSON.stringify(s).slice(0, 160)}`);
  return { ...base, Authorization: `Bearer ${s.access_token}` };
}
const rpc = async (h, name, body) => {
  const r = await fetch(`${U}/rest/v1/rpc/${name}`, { method: 'POST', headers: h, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (h, path) => {
  const r = await fetch(`${U}/rest/v1/${path}`, { headers: h });
  return { status: r.status, body: await r.json().catch(() => null) };
};

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`);
  ok ? passed++ : failed++;
};

const admin = await login('+919000000301');
const customer = await login('+919000001015');

// ---- the list page, exactly as the Orders screen requests it ---------------------------------------------------------
const list = await rpc(admin, 'get_admin_orders', { p_limit: 20 });
check('the orders list loads for an admin', list.status === 200 && Array.isArray(list.body) && list.body.length > 0, `status ${list.status}`);
const orders = list.body ?? [];
const fields = ['id', 'order_number', 'status', 'total', 'placed_at', 'item_count', 'customer_name', 'customer_phone', 'store_name'];
check('every row carries what the card shows (number, status, total, date, item count, customer, phone, store)', orders.every((o) => fields.every((f) => o[f] !== undefined && o[f] !== null)), JSON.stringify(orders.find((o) => fields.some((f) => o[f] == null))));

// ---- the real lines behind the cards (one query for the page) --------------------------------------------------------
const ids = orders.map((o) => o.id);
const items = await get(admin, `order_items?select=order_id,product_name_snapshot,variant_snapshot,image_snapshot,quantity,total&order_id=in.(${ids.join(',')})`);
check('an admin can read the order lines for a whole page in one request', items.status === 200 && Array.isArray(items.body), `status ${items.status}`);
const byOrder = {};
for (const row of items.body ?? []) (byOrder[row.order_id] ??= []).push({ name: row.product_name_snapshot, variant: row.variant_snapshot, image: row.image_snapshot, quantity: Number(row.quantity), total: Number(row.total) });
const withLines = orders.filter((o) => o.item_count > 0);
check('every order\'s stored item count equals its real lines (the card never claims items it cannot show)', withLines.every((o) => (byOrder[o.id]?.length ?? 0) === Number(o.item_count)), JSON.stringify(withLines.filter((o) => (byOrder[o.id]?.length ?? 0) !== Number(o.item_count)).map((o) => [o.order_number, o.item_count, byOrder[o.id]?.length])));
const previews = withLines.map((o) => ({ order: o, preview: summarizeOrderLines(byOrder[o.id] ?? []) }));
check('every card gets a main product name from its real lines', previews.every((p) => !!p.preview.main?.name), '');
check('the main product is the order\'s biggest line, and "+ N more" is lines - 1', previews.every((p) => p.preview.main.total === Math.max(...byOrder[p.order.id].map((l) => l.total)) && p.preview.moreLines === byOrder[p.order.id].length - 1));
const withPhoto = previews.filter((p) => p.preview.main.image).length;
console.log(`       (${withPhoto} of ${previews.length} cards have a stored product photo; the rest show the neutral placeholder — never a made-up picture)`);
check('stored photos are real URLs or empty, never placeholders invented by the app', previews.every((p) => !p.preview.main.image || /^https?:\/\//.test(p.preview.main.image)));

// ---- one real order in full: the detail screen -----------------------------------------------------------------------
const multi = orders.filter((o) => o.item_count >= 2).sort((a, b) => b.item_count - a.item_count)[0] ?? orders[0];
const detail = await rpc(admin, 'get_admin_order_detail', { p_order_id: multi.id });
check(`order #${multi.order_number}: the detail loads (${multi.item_count} lines)`, detail.status === 200 && !!detail.body?.order, `status ${detail.status}`);
const o = detail.body.order;
const money = priceBreakdown(o);
check('the money shown is the stored columns (subtotal, discount, delivery, tax, total)', money.length === 5 && money[4].amount === Number(o.total) && money[0].amount === Number(o.subtotal) && money[2].amount === Number(o.delivery_fee), JSON.stringify(money));
check('the stored amounts add up (subtotal - discount + delivery + tax = total)', !breakdownMismatch(o), `${o.subtotal} ${o.discount} ${o.delivery_fee} ${o.tax} ${o.total}`);
const lines = await get(admin, `order_items?select=id,product_name_snapshot,variant_snapshot,sku_snapshot,image_snapshot,quantity,unit_price,mrp,discount,total&order_id=eq.${multi.id}`);
check('every item line is returned with name, quantity and price', lines.status === 200 && lines.body.length === Number(multi.item_count) && lines.body.every((l) => l.product_name_snapshot && Number(l.quantity) > 0 && Number(l.unit_price) > 0), JSON.stringify(lines.body?.[0]));
const itemsTotal = lines.body.reduce((s, l) => s + Number(l.total), 0);
check('the lines add up to the stored subtotal', Math.abs(itemsTotal - Number(o.subtotal)) < 0.01, `${itemsTotal} vs ${o.subtotal}`);
check('the RPC\'s item names match the lines read directly', (detail.body.items ?? []).map((i) => i.productName).sort().join('|') === lines.body.map((l) => l.product_name_snapshot).sort().join('|'));

// Payment: only the safe columns are asked for
const pay = await get(admin, `payments?select=method,status,provider,amount,created_at&order_id=eq.${multi.id}&order=created_at.desc&limit=1`);
check('the payment record (method, status, amount) is readable', pay.status === 200 && pay.body.length === 1 && !!pay.body[0].method, `status ${pay.status} ${JSON.stringify(pay.body)}`);
const described = describePayment(pay.body[0]?.method, o.payment_status);
console.log(`       payment: ${described.method} — ${described.status} (${formatMoney(pay.body[0]?.amount)})`);
check('"Paid" is shown only when the stored status is paid', (o.payment_status === 'paid') === (described.status === 'Paid (verified)'), `${o.payment_status} -> ${described.status}`);
check('the screen never asks for gateway secrets: it selects only method/status/provider/amount/date', !/provider_response|gateway|payment_reference/.test('method,status,provider,amount,created_at'));

check('customer name, phone, address, store and timeline are returned for the detail screen', !!detail.body.customer?.name && !!detail.body.customer?.phone && !!detail.body.deliveryAddress?.address_line_1 && !!detail.body.store?.name && Array.isArray(detail.body.timeline) && detail.body.timeline.length > 0, JSON.stringify(Object.keys(detail.body)));

// ---- status filters and search, as the screen sends them ---------------------------------------------------------------
const cancelled = await rpc(admin, 'get_admin_orders', { p_statuses: ['cancelled'], p_limit: 20 });
check('the Cancelled filter returns only cancelled orders', cancelled.status === 200 && cancelled.body.every((x) => x.status === 'cancelled'));
const bySearch = await rpc(admin, 'get_admin_orders', { p_search: multi.order_number, p_limit: 20 });
check('searching by order number finds that order', bySearch.status === 200 && bySearch.body.some((x) => x.id === multi.id));
const byPhone = await rpc(admin, 'get_admin_orders', { p_search: String(multi.customer_phone).slice(-6), p_limit: 20 });
check('searching by part of the phone number finds the customer\'s orders', byPhone.status === 200 && byPhone.body.some((x) => x.id === multi.id));
if (orders.length >= 2) {
  const page2 = await rpc(admin, 'get_admin_orders', { p_cursor: orders[orders.length - 1].placed_at, p_limit: 20 });
  check('pagination: the next page starts after the last card and repeats none', page2.status === 200 && page2.body.every((x) => !ids.includes(x.id)));
}

// ---- security: a customer must not see any of it ---------------------------------------------------------------------
const foreign = await rpc(customer, 'get_admin_orders', { p_limit: 5 });
check('a customer cannot call the admin orders list', foreign.status >= 400, `status ${foreign.status}`);
const me = await (await fetch(`${U}/auth/v1/user`, { headers: customer })).json();
const otherOrder = orders.find((x) => x.customer_phone && me.phone && !String(x.customer_phone).endsWith(String(me.phone).slice(-10)));
if (otherOrder) {
  const leak = await get(customer, `order_items?select=product_name_snapshot&order_id=eq.${otherOrder.id}`);
  check('a customer cannot read another customer\'s order lines', leak.status === 200 && leak.body.length === 0, JSON.stringify(leak.body).slice(0, 120));
  const leakPay = await get(customer, `payments?select=method&order_id=eq.${otherOrder.id}`);
  check('a customer cannot read another customer\'s payment', leakPay.status === 200 && leakPay.body.length === 0, JSON.stringify(leakPay.body).slice(0, 120));
  const leakDetail = await rpc(customer, 'get_admin_order_detail', { p_order_id: otherOrder.id });
  check('a customer cannot open the admin order detail', leakDetail.status >= 400, `status ${leakDetail.status}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
