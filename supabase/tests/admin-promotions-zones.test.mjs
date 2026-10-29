#!/usr/bin/env node
/**
 * Migration 20260829000004 (banners, offers and delivery zones managed by admins) against the live database. The migration text runs FIRST in the
 * same transaction and everything is rolled back at the end, so this proves it before it is applied and re-proves it after. Needs 20260829000003
 * (the two permission values) to be applied already — an enum value cannot be used in the transaction that adds it.
 *
 *   SUPABASE_ACCESS_TOKEN=<personal access token> node supabase/tests/admin-promotions-zones.test.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Set SUPABASE_ACCESS_TOKEN (needed to run SQL through the Management API).');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const ref = process.env.SUPABASE_PROJECT_REF ?? readFileSync(resolve(here, '../.temp/project-ref'), 'utf8').trim();
const MIGRATION = readFileSync(resolve(here, '../migrations/20260829000004_admin_promotions_and_zones.sql'), 'utf8');

const actAs = (uid) => `perform set_config('request.jwt.claims', json_build_object('sub', ${uid}, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', (${uid})::text, true);
  execute 'set local role authenticated';`;
const owner = `execute 'reset role';`;
const attempt = (key, stmt) => `begin ${stmt}; r := r || jsonb_build_object('${key}', 'ALLOWED'); exception when others then r := r || jsonb_build_object('${key}', left(sqlerrm, 160)); end;`;
const asAdmin = (role) => `${owner} update profiles set admin_role = ${role === null ? 'null' : `'${role}'`} where id = v_adm; ${actAs('v_adm')}`;
const IMG = 'https://images.example.com/x.jpg';
const banner = (args) => `admin_save_banner(${args})`;

const PROBE = `
do $probe$
declare
  r jsonb := '{}'::jsonb;
  v_adm uuid; v_cust uuid; v_cat uuid; v_prod uuid; v_store uuid; v_lat double precision; v_lng double precision;
  v_b uuid; v_b2 uuid; v_o uuid; v_zone uuid; v_list jsonb; n int; v_pricing jsonb; v_before jsonb;
begin
  select id into v_adm from profiles where role = 'admin' and admin_role is not null order by created_at limit 1;
  select id into v_cust from profiles where role = 'customer' and is_active order by created_at limit 1;
  select id into v_cat from categories order by is_active desc, created_at limit 1;   -- any category: whether it is switched on does not matter here
  select id into v_prod from products order by is_active desc, created_at limit 1;
  select s.id, s.latitude, s.longitude, sz.delivery_zone_id into v_store, v_lat, v_lng, v_zone from stores s join store_delivery_zones sz on sz.store_id = s.id where s.is_active order by s.code limit 1;
  if v_adm is null or v_cust is null or v_cat is null or v_prod is null or v_zone is null then
    raise exception 'PROBE_SETUP_MISSING adm=% cust=% cat=% prod=% zone=%', v_adm, v_cust, v_cat, v_prod, v_zone;
  end if;

  -- 1. who may use them
  ${asAdmin(null)} ${attempt('owner_get', `perform admin_get_promotions()`)} ${attempt('owner_zones', `perform admin_get_zones()`)}
  ${asAdmin('admin')} ${attempt('admin_get', `perform admin_get_promotions()`)} ${attempt('admin_zones', `perform admin_get_zones()`)}
  ${asAdmin('operations_manager')} ${attempt('ops_get', `perform admin_get_promotions()`)} ${attempt('ops_zones', `perform admin_get_zones()`)}
  ${attempt('ops_save', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'none', null, null, now(), null, 0, true`)}`)}
  ${attempt('ops_zone_update', `perform admin_update_zone(v_zone, p_delivery_fee => 10)`)}
  ${actAs('v_cust')} ${attempt('customer_get', `perform admin_get_promotions()`)} ${attempt('customer_zone_update', `perform admin_update_zone(v_zone, p_delivery_fee => 10)`)}
  ${owner}
  -- the permission is real and grantable: give support_agent promotions.manage and they can read, but still not change zones
  insert into role_permissions (admin_role, permission) values ('support_agent', 'promotions.manage');
  ${asAdmin('support_agent')} ${attempt('granted_get', `perform admin_get_promotions()`)} ${attempt('granted_zone', `perform admin_update_zone(v_zone, p_delivery_fee => 10)`)}
  ${owner}

  -- 2. banners: create, validate, read back, customers see only what is live
  ${asAdmin('admin')}
  v_b := ${banner(`null, '  Diwali Sale  ', 'Up to 20% off', 'FESTIVE', '${IMG}', 'Shop now', 'light', 'category', v_cat, null, now() - interval '1 hour', null, 5, true`)};
  v_b2 := ${banner(`null, 'Scheduled for next week', null, null, '${IMG}', null, 'dark', 'url', null, '/build-your-box', now() + interval '7 days', now() + interval '14 days', 6, true`)};
  ${owner}
  r := r || jsonb_build_object('banner_row', (select jsonb_build_object('title', title, 'theme', theme, 'cta', cta_label, 'type', target_type::text, 'target_ok', target_id = v_cat, 'sort', sort_order, 'active', is_active) from banners where id = v_b),
    'banner2_url', (select target_url from banners where id = v_b2), 'banner2_cta_default', (select cta_label from banners where id = v_b2));
  ${actAs('v_cust')}
  select count(*) into n from banners where id in (v_b, v_b2); r := r || jsonb_build_object('customer_sees_banners_before_filter', n);
  ${owner}
  ${asAdmin('admin')}
  ${attempt('b_title_blank', `perform ${banner(`null, '   ', null, null, '${IMG}', null, 'dark', 'none', null, null, now(), null, 0, true`)}`)}
  ${attempt('b_title_long', `perform ${banner(`null, repeat('x', 81), null, null, '${IMG}', null, 'dark', 'none', null, null, now(), null, 0, true`)}`)}
  ${attempt('b_image_http', `perform ${banner(`null, 'T', null, null, 'http://insecure.example.com/x.jpg', null, 'dark', 'none', null, null, now(), null, 0, true`)}`)}
  ${attempt('b_image_blank', `perform ${banner(`null, 'T', null, null, '', null, 'dark', 'none', null, null, now(), null, 0, true`)}`)}
  ${attempt('b_theme', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'neon', 'none', null, null, now(), null, 0, true`)}`)}
  ${attempt('b_category_missing', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'category', gen_random_uuid(), null, now(), null, 0, true`)}`)}
  ${attempt('b_category_null', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'category', null, null, now(), null, 0, true`)}`)}
  ${attempt('b_product_missing', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'product', gen_random_uuid(), null, now(), null, 0, true`)}`)}
  ${attempt('b_url_external', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'url', null, 'https://evil.example.com', now(), null, 0, true`)}`)}
  ${attempt('b_url_protocol_relative', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'url', null, '//evil.example.com', now(), null, 0, true`)}`)}
  ${attempt('b_url_none', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'url', null, null, now(), null, 0, true`)}`)}
  ${attempt('b_url_dots', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'url', null, '/category/../../x', now(), null, 0, true`)}`)}
  ${attempt('b_url_dot_first', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'url', null, '/./x', now(), null, 0, true`)}`)}
  ${attempt('b_url_space', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'url', null, '/a b', now(), null, 0, true`)}`)}
  ${attempt('b_url_ok_nested', `perform ${banner(`null, 'T2', null, null, '${IMG}', null, 'dark', 'url', null, '/category/dry-fruits?sort=price', now(), null, 0, true`)}`)}
  ${attempt('b_url_ok_root', `perform ${banner(`null, 'T3', null, null, '${IMG}', null, 'dark', 'url', null, '/', now(), null, 0, true`)}`)}
  ${attempt('b_end_before_start', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'none', null, null, now(), now() - interval '1 day', 0, true`)}`)}
  ${attempt('b_sort', `perform ${banner(`null, 'T', null, null, '${IMG}', null, 'dark', 'none', null, null, now(), null, 5000, true`)}`)}
  ${attempt('b_update_missing', `perform ${banner(`gen_random_uuid(), 'T', null, null, '${IMG}', null, 'dark', 'none', null, null, now(), null, 0, true`)}`)}
  ${owner}
  select count(*) into n from banners where title = 'T'; r := r || jsonb_build_object('banners_leaked_by_bad_input', n);

  -- 3. edit, hide, show, read, delete
  ${asAdmin('admin')}
  perform ${banner(`v_b, 'Diwali Sale 2', 'New text', 'FESTIVE', '${IMG}', 'Shop now', 'light', 'product', v_prod, null, now() - interval '1 hour', now() + interval '30 days', 5, true`)};
  v_list := admin_get_promotions();
  r := r || jsonb_build_object('read_banner', (select x from jsonb_array_elements(v_list->'banners') x where x->>'id' = v_b::text),
    'read_includes_scheduled', exists (select 1 from jsonb_array_elements(v_list->'banners') x where x->>'id' = v_b2::text));
  perform admin_set_promotion_active('banner', v_b, false);
  ${owner}
  ${actAs('v_cust')}
  select count(*) into n from banners where id = v_b; r := r || jsonb_build_object('customer_sees_hidden_banner', n);
  ${owner}
  ${asAdmin('admin')}
  perform admin_set_promotion_active('banner', v_b, true);
  ${owner}
  ${actAs('v_cust')}
  select count(*) into n from banners where id = v_b and is_active and start_at <= now() and (end_at is null or end_at >= now()); r := r || jsonb_build_object('customer_sees_live_banner', n);
  select count(*) into n from banners where id = v_b2 and is_active and start_at <= now() and (end_at is null or end_at >= now()); r := r || jsonb_build_object('customer_sees_scheduled_banner_as_live', n);
  ${owner}
  ${asAdmin('admin')}
  ${attempt('kind_unknown', `perform admin_set_promotion_active('coupon', v_b, true)`)}
  ${attempt('active_missing', `perform admin_set_promotion_active('banner', gen_random_uuid(), true)`)}
  perform admin_delete_promotion('banner', v_b2);
  ${attempt('delete_twice', `perform admin_delete_promotion('banner', v_b2)`)}
  ${owner}
  r := r || jsonb_build_object('deleted', not exists (select 1 from banners where id = v_b2),
    'audit_actions', (select jsonb_agg(distinct action) from audit_logs where action in ('banner_created', 'banner_updated', 'banner_shown', 'banner_hidden', 'banner_deleted') and created_at > now() - interval '1 minute'));

  -- 4. offers
  ${asAdmin('admin')}
  v_o := admin_save_offer(null, 'Free delivery weekend', 'Above Rs 499', '${IMG}', 'Order', 'free_delivery', 'none', null, now(), null, 3, true);
  ${attempt('o_category', `perform admin_save_offer(null, 'T', null, '${IMG}', null, 'sale', 'none', null, now(), null, 0, true)`)}
  ${attempt('o_category_null', `perform admin_save_offer(null, 'T', null, '${IMG}', null, null, 'none', null, now(), null, 0, true)`)}
  ${attempt('o_image', `perform admin_save_offer(null, 'T', null, 'ftp://x', null, 'combo', 'none', null, now(), null, 0, true)`)}
  ${attempt('o_target_missing', `perform admin_save_offer(null, 'T', null, '${IMG}', null, 'combo', 'product', null, now(), null, 0, true)`)}
  ${attempt('o_dates', `perform admin_save_offer(null, 'T', null, '${IMG}', null, 'combo', 'none', null, now(), now(), 0, true)`)}
  perform admin_save_offer(v_o, 'Free delivery weekend', 'Above Rs 599', '${IMG}', 'Order', 'free_delivery', 'category', v_cat, now(), now() + interval '2 days', 3, false);
  ${owner}
  r := r || jsonb_build_object('offer_row', (select jsonb_build_object('subtitle', subtitle, 'type', target_type::text, 'active', is_active, 'has_end', end_at is not null) from offers where id = v_o), 'offers_leaked', (select count(*) from offers where title = 'T'));

  -- 5. zones: edit what customers pay, and prove checkout pricing follows
  select get_delivery_pricing(v_lat, v_lng) into v_before;
  ${asAdmin('admin')}
  perform admin_update_zone(v_zone, p_delivery_fee => 35, p_minimum_order_value => 250, p_free_delivery_threshold => 600, p_estimated_minutes => 40);
  ${owner}
  v_pricing := get_delivery_pricing(v_lat, v_lng);
  r := r || jsonb_build_object('pricing_before', v_before, 'pricing_after', v_pricing);
  ${asAdmin('admin')}
  perform admin_update_zone(v_zone, p_no_free_delivery => true);
  ${owner}
  r := r || jsonb_build_object('free_removed', (select free_delivery_threshold is null from delivery_zones where id = v_zone), 'pricing_no_free', get_delivery_pricing(v_lat, v_lng)->'freeDeliveryThreshold');
  ${asAdmin('admin')}
  ${attempt('z_fee_negative', `perform admin_update_zone(v_zone, p_delivery_fee => -1)`)}
  ${attempt('z_fee_huge', `perform admin_update_zone(v_zone, p_delivery_fee => 501)`)}
  ${attempt('z_min_huge', `perform admin_update_zone(v_zone, p_minimum_order_value => 5001)`)}
  ${attempt('z_eta_low', `perform admin_update_zone(v_zone, p_estimated_minutes => 1)`)}
  ${attempt('z_eta_high', `perform admin_update_zone(v_zone, p_estimated_minutes => 500)`)}
  ${attempt('z_name_short', `perform admin_update_zone(v_zone, p_name => 'x')`)}
  ${attempt('z_free_below_min', `perform admin_update_zone(v_zone, p_free_delivery_threshold => 100)`)}
  ${attempt('z_min_above_free', `perform admin_update_zone(v_zone, p_free_delivery_threshold => 400, p_minimum_order_value => 450)`)}
  ${attempt('z_both_free_args', `perform admin_update_zone(v_zone, p_free_delivery_threshold => 700, p_no_free_delivery => true)`)}
  ${attempt('z_missing', `perform admin_update_zone(gen_random_uuid(), p_delivery_fee => 10)`)}
  ${attempt('z_free_equal_min_ok', `perform admin_update_zone(v_zone, p_free_delivery_threshold => 250)`)}
  ${attempt('z_zero_fee_ok', `perform admin_update_zone(v_zone, p_delivery_fee => 0)`)}
  ${owner}
  r := r || jsonb_build_object('zone_now', (select jsonb_build_object('fee', delivery_fee, 'min', minimum_order_value, 'free', free_delivery_threshold, 'eta', estimated_delivery_minutes) from delivery_zones where id = v_zone),
    'zone_audits', (select count(*) from audit_logs where action = 'delivery_zone_updated' and created_at > now() - interval '1 minute'));
  select count(*) into n from audit_logs where action = 'delivery_zone_updated' and created_at > now() - interval '1 minute';
  ${asAdmin('admin')}
  perform admin_update_zone(v_zone, p_delivery_fee => 0, p_minimum_order_value => 250, p_estimated_minutes => 40);
  ${owner}
  r := r || jsonb_build_object('noop_zone_audit_rows', (select count(*) from audit_logs where action = 'delivery_zone_updated' and created_at > now() - interval '1 minute') - n);
  -- a switched-off zone stops serving its area
  ${asAdmin('admin')}
  perform admin_update_zone(v_zone, p_is_active => false);
  ${owner}
  r := r || jsonb_build_object('zone_off_pricing', get_delivery_pricing(v_lat, v_lng));

  raise exception 'PROBE_RESULT %', r::text;
end
$probe$;`;

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`);
  ok ? passed++ : failed++;
};

const probe = await sql(`${MIGRATION}\n${PROBE}`);
const message = String(probe.body?.message ?? '');
const match = message.match(/PROBE_RESULT (\{.*\})/s);
if (!match) {
  console.error('The probe did not report a result:', message.slice(0, 1500));
  process.exit(1);
}
const r = JSON.parse(match[1]);
if (process.env.SHOW_PROBE) console.log('probe result:', JSON.stringify(r, null, 1), '\n');

const refused = (v) => /not authorized/i.test(v ?? '');
check('the super admin and the admin role can open both lists', [r.owner_get, r.owner_zones, r.admin_get, r.admin_zones].every((v) => v === 'ALLOWED'), JSON.stringify([r.owner_get, r.owner_zones, r.admin_get, r.admin_zones]));
check('an operations manager and a customer are refused everything', [r.ops_get, r.ops_zones, r.ops_save, r.ops_zone_update, r.customer_get, r.customer_zone_update].every(refused), JSON.stringify([r.ops_get, r.ops_zones, r.ops_save, r.ops_zone_update, r.customer_get, r.customer_zone_update]));
check('the new permission is real and grantable: promotions.manage lets a role in — to banners, not to zones', r.granted_get === 'ALLOWED' && refused(r.granted_zone), `${r.granted_get} | ${r.granted_zone}`);

check('a banner is stored trimmed, with its theme, category target and order number', r.banner_row?.title === 'Diwali Sale' && r.banner_row?.theme === 'light' && r.banner_row?.type === 'category' && r.banner_row?.target_ok === true && r.banner_row?.sort === 5 && r.banner_row?.active === true, JSON.stringify(r.banner_row));
check('an in-app link is kept, and an empty button text becomes "Shop now"', r.banner2_url === '/build-your-box' && r.banner2_cta_default === 'Shop now', `${r.banner2_url}/${r.banner2_cta_default}`);
check('bad titles, pictures, themes and sort numbers are refused with a readable reason',
  /title must be 1 to 80/.test(r.b_title_blank) && /title must be 1 to 80/.test(r.b_title_long) && /picture/.test(r.b_image_http) && /picture/.test(r.b_image_blank) && /theme/.test(r.b_theme) && /order number/.test(r.b_sort),
  JSON.stringify([r.b_title_blank, r.b_title_long, r.b_image_http, r.b_image_blank, r.b_theme, r.b_sort]));
check('a target that does not exist, or is missing, is refused', /choose the category/.test(r.b_category_missing) && /choose the category/.test(r.b_category_null) && /choose the product/.test(r.b_product_missing), JSON.stringify([r.b_category_missing, r.b_category_null, r.b_product_missing]));
check('a link must be a page inside the app: web addresses, "//host", "..", "/./" and spaces are refused',
  [r.b_url_external, r.b_url_protocol_relative, r.b_url_none, r.b_url_dots, r.b_url_dot_first, r.b_url_space].every((v) => /inside the app/.test(v)),
  JSON.stringify([r.b_url_external, r.b_url_protocol_relative, r.b_url_none, r.b_url_dots, r.b_url_dot_first, r.b_url_space]));
check('…while real in-app links, with a query or just "/", are accepted', r.b_url_ok_nested === 'ALLOWED' && r.b_url_ok_root === 'ALLOWED', `${r.b_url_ok_nested} | ${r.b_url_ok_root}`);
check('an end before the start is refused', /end must be after the start/.test(r.b_end_before_start), r.b_end_before_start);
check('editing a banner that does not exist is refused', /banner not found/.test(r.b_update_missing), r.b_update_missing);
check('refused banners left nothing behind', Number(r.banners_leaked_by_bad_input) === 0, String(r.banners_leaked_by_bad_input));

check('editing a banner changes its target to a product and gives it an end date; the admin list shows the target\'s name',
  r.read_banner?.title === 'Diwali Sale 2' && r.read_banner?.targetType === 'product' && !!r.read_banner?.targetName && r.read_banner?.endAt != null, JSON.stringify(r.read_banner));
check('the admin list includes a banner that is scheduled for later', r.read_includes_scheduled === true);
check('a hidden banner is invisible to customers, a shown one is visible, and a banner scheduled for next week is not live yet', Number(r.customer_sees_hidden_banner) === 0 && Number(r.customer_sees_live_banner) === 1 && Number(r.customer_sees_scheduled_banner_as_live) === 0, JSON.stringify([r.customer_sees_hidden_banner, r.customer_sees_live_banner, r.customer_sees_scheduled_banner_as_live]));
check('an unknown kind and a missing item are refused; delete works once, not twice', /unknown kind/.test(r.kind_unknown) && /not found/.test(r.active_missing) && r.deleted === true && /not found/.test(r.delete_twice), JSON.stringify([r.kind_unknown, r.active_missing, r.deleted, r.delete_twice]));
check('every change is in the audit log', ['banner_created', 'banner_updated', 'banner_shown', 'banner_hidden', 'banner_deleted'].every((a) => (r.audit_actions ?? []).includes(a)), JSON.stringify(r.audit_actions));

check('an offer is saved, and refused for an unknown kind, a missing picture, a missing target or dates in the wrong order',
  /kind of offer/.test(r.o_category) && /kind of offer/.test(r.o_category_null) && /picture/.test(r.o_image) && /choose the product/.test(r.o_target_missing) && /end must be after/.test(r.o_dates), JSON.stringify([r.o_category, r.o_category_null, r.o_image, r.o_target_missing, r.o_dates]));
check('editing an offer: new text, a category target, an end date, hidden', r.offer_row?.subtitle === 'Above Rs 599' && r.offer_row?.type === 'category' && r.offer_row?.active === false && r.offer_row?.has_end === true && Number(r.offers_leaked) === 0, JSON.stringify(r.offer_row));

check('a zone edit changes what checkout pricing reports (fee, minimum, free-delivery level, minutes)',
  r.pricing_after?.deliveryFee === 35 && r.pricing_after?.minimumOrderValue === 250 && r.pricing_after?.freeDeliveryThreshold === 600 && r.pricing_after?.estimatedMinutes === 40 && r.pricing_before?.deliveryFee !== 35,
  JSON.stringify({ before: r.pricing_before, after: r.pricing_after }));
check('"no free delivery" removes the free-delivery level', r.free_removed === true && r.pricing_no_free === null, `${r.free_removed}/${r.pricing_no_free}`);
check('impossible fees, minimums and times are refused', /between 0 and 500/.test(r.z_fee_negative) && /between 0 and 500/.test(r.z_fee_huge) && /between 0 and 5000/.test(r.z_min_huge) && /between 5 and 240/.test(r.z_eta_low) && /between 5 and 240/.test(r.z_eta_high) && /name must be/.test(r.z_name_short), JSON.stringify([r.z_fee_negative, r.z_fee_huge, r.z_min_huge, r.z_eta_low, r.z_eta_high, r.z_name_short]));
check('free delivery below the minimum order is refused (it could never apply) — from either side', /at or above the minimum/.test(r.z_free_below_min) && /at or above the minimum/.test(r.z_min_above_free), `${r.z_free_below_min} | ${r.z_min_above_free}`);
check('"no free delivery" together with an amount is refused; a missing zone is refused', /either/.test(r.z_both_free_args) && /zone not found/.test(r.z_missing), `${r.z_both_free_args} | ${r.z_missing}`);
check('free delivery exactly at the minimum, and a ₹0 delivery fee, are allowed', r.z_free_equal_min_ok === 'ALLOWED' && r.z_zero_fee_ok === 'ALLOWED', `${r.z_free_equal_min_ok} | ${r.z_zero_fee_ok}`);
check('the zone ended up with the last valid values', r.zone_now?.fee === 0 && r.zone_now?.min === 250 && r.zone_now?.free === 250 && r.zone_now?.eta === 40, JSON.stringify(r.zone_now));
check('saving the same values again writes no audit entry', Number(r.noop_zone_audit_rows) === 0, String(r.noop_zone_audit_rows));
check('a switched-off zone no longer serves its area', JSON.stringify(r.zone_off_pricing) === '{}', JSON.stringify(r.zone_off_pricing));

const left = (await sql(`select (select count(*) from banners where title in ('Diwali Sale', 'Diwali Sale 2', 'Scheduled for next week')) + (select count(*) from offers where title = 'Free delivery weekend') as n`)).body?.[0]?.n;
check('the probe rolled back and left nothing behind', Number(left) === 0, `left=${left}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
