// Banners, offers and delivery pricing in the admin panel, and the cart showing what checkout charges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dateInputAfterDays, describeWindow, formatDateInput, formatDateLabel, parseDateInput } from '../../services/dateInput.ts';
import { OFFER_CATEGORIES, isInAppLink, validateBannerForm, validateOfferForm } from '../../services/promotionEdit.ts';
import { validateZoneForm } from '../../services/zoneEdit.ts';
import { FALLBACK_PRICING, parseDeliveryPricing, quoteDelivery } from '../../services/deliveryPricing.ts';
import { describeAdminWriteError } from '../../services/adminErrors.ts';

const file = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const source = (p) => readFileSync(file(p), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// ---- dates -----------------------------------------------------------------------------------------------------------------

test('a typed date is read as India time: a start is midnight IST, an end is the last second of that day', () => {
  assert.equal(parseDateInput('25-12-2026', 'start'), '2026-12-24T18:30:00.000Z');
  assert.equal(parseDateInput('25-12-2026', 'end'), '2026-12-25T18:29:59.000Z');
});

test('the usual ways of writing a date are understood', () => {
  const want = '2026-12-24T18:30:00.000Z';
  for (const text of ['25-12-2026', '25/12/2026', '25.12.2026', '2026-12-25', ' 25-12-2026 ']) assert.equal(parseDateInput(text, 'start'), want, text);
  assert.equal(parseDateInput('5-1-2027', 'start'), '2027-01-04T18:30:00.000Z', 'no leading zeros needed');
  assert.equal(parseDateInput('29-02-2028', 'start')?.slice(0, 10), '2028-02-28', '29 Feb in a leap year (IST midnight is the evening before in UTC)');
});

test('things that are not a real calendar date are refused', () => {
  for (const text of ['', 'abc', '31-02-2026', '29-02-2025', '32-01-2026', '00-01-2026', '25-13-2026', '25-00-2026', '25-12-26', '25 12 2026', '1999-12-31', '2101-01-01', '25-12-', '12-2026', '25--12-2026']) {
    assert.equal(parseDateInput(text, 'start'), null, `"${text}"`);
  }
});

test('a date shown back to the admin is the date they typed, whatever time zone the phone is in', () => {
  assert.equal(formatDateInput('2026-12-24T18:30:00.000Z'), '25-12-2026');
  assert.equal(formatDateInput('2026-12-25T18:29:59.000Z'), '25-12-2026');
  assert.equal(formatDateInput('2026-12-25T18:30:00.000Z'), '26-12-2026', 'the next IST day begins at 18:30 UTC');
  assert.equal(formatDateInput(null), '');
  assert.equal(formatDateInput('not a date'), '');
  for (const text of ['01-01-2027', '31-12-2026', '28-02-2026']) assert.equal(formatDateInput(parseDateInput(text, 'start')), text);
  assert.equal(formatDateLabel('2026-11-04T18:30:00.000Z'), '5 Nov 2026');
});

test('"+30 days" lands on the right India date', () => {
  assert.equal(dateInputAfterDays(Date.parse('2026-10-29T08:00:00Z'), 30), '28-11-2026');
  assert.equal(dateInputAfterDays(Date.parse('2026-10-29T08:00:00Z'), 7), '05-11-2026');
  assert.equal(dateInputAfterDays(Date.parse('2026-12-31T20:00:00Z'), 1), '02-01-2027', '20:00 UTC on the 31st is already 1 Jan in India');
});

test('a banner is described as hidden, scheduled, live or ended', () => {
  const now = Date.parse('2026-11-10T06:00:00Z');
  assert.deepEqual(describeWindow('2026-10-01T00:00:00Z', null, false, now), { state: 'hidden', label: 'Hidden' });
  assert.deepEqual(describeWindow('2026-12-01T00:00:00Z', null, true, now), { state: 'scheduled', label: 'Starts 1 Dec 2026' });
  assert.deepEqual(describeWindow('2026-10-01T00:00:00Z', null, true, now), { state: 'live', label: 'Live' });
  assert.deepEqual(describeWindow('2026-10-01T00:00:00Z', '2026-11-30T18:29:59Z', true, now), { state: 'live', label: 'Live · ends 30 Nov 2026' });
  assert.deepEqual(describeWindow('2026-10-01T00:00:00Z', '2026-11-05T18:29:59Z', true, now), { state: 'ended', label: 'Ended 5 Nov 2026' });
  assert.equal(describeWindow(null, null, true, now).state, 'live', 'no dates at all: live');
  assert.equal(describeWindow('2026-11-10T06:00:00Z', null, true, now).state, 'live', 'starting exactly now: live');
});

// ---- banners and offers ---------------------------------------------------------------------------------------------------

const IMG = 'https://images.example.com/a.jpg';
const bannerForm = (over = {}) => ({ title: 'Diwali Sale', subtitle: '', eyebrow: '', imageUrl: IMG, ctaLabel: '', theme: 'dark', targetType: 'none', targetId: null, targetUrl: '', startDate: '', endDate: '', sortOrder: '', isActive: true, ...over });
const offerForm = (over = {}) => ({ title: 'Free delivery', subtitle: '', imageUrl: IMG, ctaLabel: '', category: 'free_delivery', targetType: 'none', targetId: null, startDate: '', endDate: '', sortOrder: '', isActive: true, ...over });

test('in-app links: a real path is accepted; web addresses, "//host", "..", "/./" and spaces are not (the same rule as the database)', () => {
  for (const ok of ['/', '/build-your-box', '/category/dry-fruits', '/category/dry-fruits?sort=price', '/product/almonds-250g']) assert.equal(isInAppLink(ok), true, ok);
  for (const bad of ['', 'category/x', 'https://x.com', 'http://x.com', '//evil.example.com', '/./x', '/.hidden', '/category/../x', '/a b', '/x\\y', `/${'a'.repeat(200)}`]) assert.equal(isInAppLink(bad), false, bad);
});

test('a plain banner is valid; empty optional fields become null and the button text is left to the server\'s default', () => {
  const { errors, value } = validateBannerForm(bannerForm());
  assert.deepEqual(errors, {});
  assert.deepEqual(value, { title: 'Diwali Sale', subtitle: null, imageUrl: IMG, ctaLabel: null, startAt: null, endAt: null, sortOrder: 0, targetType: 'none', targetId: null, isActive: true, eyebrow: null, theme: 'dark', targetUrl: null });
});

test('banner fields are checked the way the server checks them', () => {
  const { errors } = validateBannerForm(bannerForm({ title: '  ', subtitle: 'x'.repeat(141), eyebrow: 'y'.repeat(25), imageUrl: 'http://insecure/a.jpg', ctaLabel: 'z'.repeat(25), sortOrder: '1001' }));
  assert.deepEqual(Object.keys(errors).sort(), ['ctaLabel', 'eyebrow', 'imageUrl', 'sortOrder', 'subtitle', 'title']);
  for (const sort of ['abc', '-1', '1.5', '10000']) assert.ok(validateBannerForm(bannerForm({ sortOrder: sort })).errors.sortOrder, `sort "${sort}"`);
  for (const sort of ['0', '1000', ' 7 ']) assert.equal(validateBannerForm(bannerForm({ sortOrder: sort })).errors.sortOrder, undefined, `sort "${sort}"`);
});

test('banner dates: typed in India time, the end must come after the start, an empty end means no end', () => {
  const ok = validateBannerForm(bannerForm({ startDate: '01-11-2026', endDate: '30-11-2026' }));
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.value.startAt, '2026-10-31T18:30:00.000Z');
  assert.equal(ok.value.endAt, '2026-11-30T18:29:59.000Z');
  assert.match(validateBannerForm(bannerForm({ startDate: '01-11-2026', endDate: '31-10-2026' })).errors.endDate, /after the start/);
  assert.equal(validateBannerForm(bannerForm({ startDate: '01-11-2026', endDate: '01-11-2026' })).errors.endDate, undefined, 'one-day banner: start of day to end of day');
  assert.ok(validateBannerForm(bannerForm({ startDate: '31-02-2026' })).errors.startDate);
  assert.ok(validateBannerForm(bannerForm({ endDate: 'soon' })).errors.endDate);
});

test('a banner that opens a category or product must name it; a link must be inside the app', () => {
  assert.match(validateBannerForm(bannerForm({ targetType: 'category' })).errors.target, /category/);
  assert.match(validateBannerForm(bannerForm({ targetType: 'product' })).errors.target, /product/);
  assert.equal(validateBannerForm(bannerForm({ targetType: 'category', targetId: 'c1' })).value.targetId, 'c1');
  assert.ok(validateBannerForm(bannerForm({ targetType: 'url', targetUrl: 'https://x.com' })).errors.targetUrl);
  assert.equal(validateBannerForm(bannerForm({ targetType: 'url', targetUrl: '/build-your-box' })).value.targetUrl, '/build-your-box');
  // switching the target away drops what was chosen for the old one
  const none = validateBannerForm(bannerForm({ targetType: 'none', targetId: 'c1', targetUrl: '/x' })).value;
  assert.deepEqual([none.targetId, none.targetUrl], [null, null]);
});

test('an offer needs a kind; it can open a category or product but never a link', () => {
  assert.deepEqual(validateOfferForm(offerForm()).errors, {});
  assert.match(validateOfferForm(offerForm({ category: null })).errors.category, /kind of offer/);
  assert.equal(validateOfferForm(offerForm({ targetType: 'url' })).value.targetType, 'none');
  assert.equal(OFFER_CATEGORIES.length, 6);
  assert.deepEqual(OFFER_CATEGORIES.map((c) => c.value).sort(), ['combo', 'first_order', 'free_delivery', 'festival', 'gifting', 'premium'].sort());
});

// ---- zones -----------------------------------------------------------------------------------------------------------------

const ZONE = { name: 'Awas Vikas service area', deliveryFee: 49, minimumOrderValue: 299, freeDeliveryThreshold: 499, estimatedMinutes: 35 };
const zoneForm = (over = {}) => ({ name: ZONE.name, deliveryFee: '49', minimumOrderValue: '299', freeDeliveryThreshold: '499', estimatedMinutes: '35', ...over });

test('an untouched zone form changes nothing', () => {
  assert.deepEqual(validateZoneForm(zoneForm(), ZONE), { errors: {}, patch: {} });
});

test('only changed prices are sent', () => {
  const { errors, patch } = validateZoneForm(zoneForm({ deliveryFee: '39.50', freeDeliveryThreshold: '599', estimatedMinutes: '40' }), ZONE);
  assert.deepEqual(errors, {});
  assert.deepEqual(patch, { deliveryFee: 39.5, freeDeliveryThreshold: 599, estimatedMinutes: 40 });
});

test('free delivery is switched off with an empty box, and a ₹0 fee is allowed', () => {
  assert.deepEqual(validateZoneForm(zoneForm({ freeDeliveryThreshold: '' }), ZONE).patch, { noFreeDelivery: true });
  assert.deepEqual(validateZoneForm(zoneForm({ freeDeliveryThreshold: '' }), { ...ZONE, freeDeliveryThreshold: null }).patch, {}, 'already off: nothing to do');
  assert.deepEqual(validateZoneForm(zoneForm({ freeDeliveryThreshold: '400' }), { ...ZONE, freeDeliveryThreshold: null }).patch, { freeDeliveryThreshold: 400 });
  assert.deepEqual(validateZoneForm(zoneForm({ deliveryFee: '0' }), ZONE).patch, { deliveryFee: 0 });
});

test('zone limits: fee 0-500, minimum 0-5000, free delivery at or above the minimum, minutes 5-240', () => {
  const e = (over) => validateZoneForm(zoneForm(over), ZONE).errors;
  assert.ok(e({ deliveryFee: '-1' }).deliveryFee && e({ deliveryFee: '501' }).deliveryFee && e({ deliveryFee: 'free' }).deliveryFee && e({ deliveryFee: '' }).deliveryFee);
  assert.equal(e({ deliveryFee: '500' }).deliveryFee, undefined);
  assert.ok(e({ minimumOrderValue: '5001' }).minimumOrderValue);
  assert.ok(e({ estimatedMinutes: '4' }).estimatedMinutes && e({ estimatedMinutes: '241' }).estimatedMinutes && e({ estimatedMinutes: '' }).estimatedMinutes);
  assert.equal(e({ estimatedMinutes: '5' }).estimatedMinutes, undefined);
  assert.match(e({ freeDeliveryThreshold: '100' }).freeDeliveryThreshold, /at or above the minimum/);
  assert.match(e({ minimumOrderValue: '600' }).freeDeliveryThreshold, /at or above the minimum/, 'raising the minimum above the free level is caught too');
  assert.equal(e({ freeDeliveryThreshold: '299' }).freeDeliveryThreshold, undefined, 'exactly the minimum is allowed');
  assert.ok(e({ freeDeliveryThreshold: '0' }).freeDeliveryThreshold, 'free from ₹0 is not a real level');
  assert.ok(e({ name: 'x' }).name);
});

// ---- the cart and what checkout charges -----------------------------------------------------------------------------------

const P = { deliveryFee: 49, minimumOrderValue: 299, freeDeliveryThreshold: 499 };

test('the cart charges the zone\'s fee below the free-delivery level and nothing at or above it (the same rule as checkout)', () => {
  assert.deepEqual(quoteDelivery(0, P), { deliveryFee: 0, amountToFreeDelivery: 499, freeDeliveryProgress: 0, hasFreeDelivery: true });
  assert.deepEqual(quoteDelivery(400, P), { deliveryFee: 49, amountToFreeDelivery: 99, freeDeliveryProgress: 400 / 499, hasFreeDelivery: true });
  assert.equal(quoteDelivery(498, P).deliveryFee, 49);
  assert.deepEqual(quoteDelivery(499, P), { deliveryFee: 0, amountToFreeDelivery: 0, freeDeliveryProgress: 1, hasFreeDelivery: true });
  assert.equal(quoteDelivery(2000, P).deliveryFee, 0);
});

test('a different zone fee changes the cart: ₹49 is no longer ₹40', () => {
  assert.equal(quoteDelivery(100, { ...P, deliveryFee: 49 }).deliveryFee, 49);
  assert.equal(quoteDelivery(100, { ...P, deliveryFee: 35 }).deliveryFee, 35);
  assert.equal(quoteDelivery(100, { ...P, deliveryFee: 0 }).deliveryFee, 0);
  assert.equal(quoteDelivery(550, { ...P, freeDeliveryThreshold: 599 }).amountToFreeDelivery, 49);
});

test('free delivery needs the minimum order too, as at checkout', () => {
  const q = { deliveryFee: 49, minimumOrderValue: 500, freeDeliveryThreshold: 300 }; // not allowed by the database, but the cart must never promise more than checkout gives
  assert.equal(quoteDelivery(400, q).deliveryFee, 49);
  assert.equal(quoteDelivery(400, q).amountToFreeDelivery, 100, 'it counts up to the minimum, where it really becomes free');
  assert.equal(quoteDelivery(500, q).deliveryFee, 0);
});

test('an area with no free-delivery level never shows a "free delivery" bar or message', () => {
  const none = { ...P, freeDeliveryThreshold: null };
  assert.deepEqual(quoteDelivery(1000, none), { deliveryFee: 49, amountToFreeDelivery: 0, freeDeliveryProgress: 0, hasFreeDelivery: false });
  assert.equal(quoteDelivery(0, none).deliveryFee, 0, 'an empty cart is not charged');
});

test('the server\'s answer is read strictly; "nothing serves this place" and nonsense give null', () => {
  assert.deepEqual(parseDeliveryPricing({ deliveryFee: 49, minimumOrderValue: 299, freeDeliveryThreshold: 499, estimatedMinutes: 35 }), P);
  assert.deepEqual(parseDeliveryPricing({ deliveryFee: 49, minimumOrderValue: 299, freeDeliveryThreshold: null }), { ...P, freeDeliveryThreshold: null });
  assert.deepEqual(parseDeliveryPricing({ deliveryFee: 0, minimumOrderValue: 0 }), { deliveryFee: 0, minimumOrderValue: 0, freeDeliveryThreshold: null });
  for (const bad of [{}, null, undefined, 'x', 5, [], { deliveryFee: '49', minimumOrderValue: 299 }, { deliveryFee: -1, minimumOrderValue: 299 }, { deliveryFee: 49 }, { deliveryFee: 49, minimumOrderValue: 299, freeDeliveryThreshold: 'x' }, { deliveryFee: Number.NaN, minimumOrderValue: 1 }]) {
    assert.equal(parseDeliveryPricing(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(FALLBACK_PRICING, P, 'the stand-in numbers equal the zones\' current prices');
});

// ---- messages ---------------------------------------------------------------------------------------------------------------

test('what an admin is told when saving fails', () => {
  assert.match(describeAdminWriteError({ code: 'PGRST202', message: 'Could not find the function' }, 'the banner'), /database update that has not been applied/);
  assert.equal(describeAdminWriteError({ message: 'not authorized' }, 'the banner'), "You don't have permission to change the banner.");
  assert.equal(describeAdminWriteError({ message: 'the end must be after the start' }, 'the banner'), 'the end must be after the start');
  assert.equal(describeAdminWriteError({ message: 'free delivery must start at or above the minimum order (250)' }, 'the delivery area'), 'free delivery must start at or above the minimum order (250)');
  assert.equal(describeAdminWriteError({ message: 'violates row-level security policy for table "banners"' }, 'the banner'), "Couldn't save the banner. Please try again.");
  assert.equal(describeAdminWriteError({ message: 'invalid input syntax for type uuid' }, 'the banner'), "Couldn't save the banner. Please try again.");
  assert.equal(describeAdminWriteError(null, 'the banner'), "Couldn't save the banner. Please try again.");
});

// ---- wiring -------------------------------------------------------------------------------------------------------------------

/** The `p_…` parameter names a SQL function declares. */
const sqlParams = (sql, fn) => {
  const m = new RegExp(`function (?:public\\.)?${fn}\\(([\\s\\S]*?)\\)\\s*returns`).exec(sql);
  assert.ok(m, `function ${fn} in the migration`);
  return new Set([...m[1].matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]));
};
/** The `p_…` keys the app sends in `supabase.rpc('fn', {...})`. */
const repoParams = (repo, fn) => {
  const start = repo.indexOf(`rpc('${fn}'`);
  assert.ok(start >= 0, `app calls ${fn}`);
  const end = repo.indexOf(');', start);
  return new Set([...repo.slice(start, end).matchAll(/\b(p_[a-z_]+)\b/g)].map((x) => x[1]));
};

test('every parameter the app sends is one the database function declares, and the other way round (a mismatch would only fail on a phone)', () => {
  const repo = code('services/repositories/adminRepository.ts');
  const promo = source('supabase/migrations/20260829000004_admin_promotions_and_zones.sql');
  const rider = source('supabase/migrations/20260829000001_admin_update_rider.sql');
  for (const fn of ['admin_save_banner', 'admin_save_offer', 'admin_set_promotion_active', 'admin_delete_promotion', 'admin_update_zone']) {
    assert.deepEqual([...repoParams(repo, fn)].sort(), [...sqlParams(promo, fn)].sort(), fn);
  }
  assert.deepEqual([...repoParams(repo, 'admin_update_rider')].sort(), [...sqlParams(rider, 'admin_update_rider')].sort(), 'admin_update_rider');
  assert.deepEqual([...repoParams(repo, 'admin_set_category_active')].sort(), [...sqlParams(source('supabase/migrations/20260829000005_admin_set_category_active.sql'), 'admin_set_category_active')].sort(), 'admin_set_category_active');
  assert.doesNotMatch(repo, /from\('categories'\)\.update\(\{ is_active/, 'the on/off switch is no longer an unaudited table write');
  for (const fn of ['admin_get_promotions', 'admin_get_zones']) assert.ok(repo.includes(`rpc('${fn}')`), fn);
});

test('the zone and promotion permissions exist in the database enum, the app type and the menu', () => {
  assert.match(source('supabase/migrations/20260829000003_promotions_zones_permissions.sql'), /add value if not exists 'promotions\.manage'/);
  assert.match(source('supabase/migrations/20260829000003_promotions_zones_permissions.sql'), /add value if not exists 'zones\.manage'/);
  assert.match(code('services/repositories/adminRepository.ts'), /\| 'promotions\.manage' \| 'zones\.manage'/);
  const shell = code('components/admin/AdminShell.tsx');
  assert.match(shell, /label: 'Delivery & Pricing', href: '\/admin\/pricing', icon: IndianRupee, permission: 'zones\.manage'/);
  assert.match(shell, /label: 'Banners & Offers', href: '\/admin\/promotions', icon: Megaphone, permission: 'promotions\.manage'/);
});

test('both screens are shown only to those who may use them, and writes show the server\'s reason', () => {
  const pricing = code('app/admin/pricing.tsx');
  assert.match(pricing, /hasPermission\('zones\.manage'\)/);
  assert.match(pricing, /\{canManage && \(\s*<View style=\{styles\.actions\}>/);
  assert.match(pricing, /Customers in this area will not be able to place orders/, 'switching an area off asks first');
  assert.match(pricing, /showToast\(e instanceof Error \? e\.message/);
  const promo = code('app/admin/promotions.tsx');
  assert.match(promo, /hasPermission\('promotions\.manage'\)/);
  assert.match(promo, /It disappears from the app for good/, 'delete asks first');
  assert.match(promo, /validateBannerForm\(/);
  assert.match(promo, /validateOfferForm\(/);
});

test('the cart takes its delivery numbers from the server, not from constants in the app', () => {
  const hook = code('hooks/useCartLines.ts');
  assert.match(hook, /useDeliveryPricingStore\(\(s\) => s\.pricing\) \?\? FALLBACK_PRICING/);
  assert.match(hook, /quoteDelivery\(itemTotal, pricing\)/);
  for (const f of ['hooks/useCartLines.ts', 'app/cart.tsx', 'components/home/FloatingCartBar.tsx', 'app/checkout.tsx']) {
    assert.doesNotMatch(code(f), /FREE_DELIVERY_THRESHOLD|STANDARD_DELIVERY_FEE/, f);
  }
  assert.match(code('store/deliveryPricingStore.ts'), /supabase\.rpc\('get_delivery_pricing', \{ p_lat: lat, p_lng: lng \}\)/);
  assert.match(code('app/_layout.tsx'), /<DeliveryPricingSync \/>/);
  const sync = code('components/system/DeliveryPricingSync.tsx');
  assert.match(sync, /useRefetchOnForeground\(load\)/);
  assert.match(sync, /if \(!signedIn\) useDeliveryPricingStore\.getState\(\)\.clear\(\)/);
});

test('with no free-delivery level the cart hides the progress bar and never says "Free delivery unlocked"', () => {
  assert.match(code('app/cart.tsx'), /\{hasFreeDelivery && <FreeDeliveryProgress /);
  const bar = code('components/home/FloatingCartBar.tsx');
  assert.match(bar, /hasFreeDelivery && amountToFreeDelivery > 0/);
  assert.match(bar, /: hasFreeDelivery\s*\? 'Free delivery unlocked'\s*: 'Ready to checkout'/);
});

test('Settings no longer offers two price fields that changed nothing; Help no longer promises a coupon box that does not exist', () => {
  const settings = code('app/admin/settings.tsx');
  assert.doesNotMatch(settings, /default_min_order_value|default_delivery_fee|defaultMinOrderValue|defaultDeliveryFee/);
  assert.match(settings, /pushAdmin\('\/admin\/pricing'\)/);
  assert.doesNotMatch(source('app/help.tsx'), /Offers & Coupons/);
  assert.match(source('app/help.tsx'), /Promo codes aren't available in the app yet/);
});
