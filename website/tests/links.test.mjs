// Link safety and the "no phantom coupons" rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionsCouponCode, safeHref, websitePath } from '../lib/links.ts';

test('only same-site paths and https links are followed', () => {
  assert.equal(safeHref('/category/almonds'), '/category/almonds');
  assert.equal(safeHref('https://example.com/x'), 'https://example.com/x');
  for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'http://example.com', '//evil.example', '/\\evil.example', 'vbscript:x', '']) {
    assert.equal(safeHref(bad), '/shop', bad);
  }
  assert.equal(safeHref(null, '/'), '/');
});

test('banner targets written for the mobile app map onto website pages', () => {
  assert.equal(websitePath('/(tabs)/categories'), '/shop');
  assert.equal(websitePath('/build-your-box'), '/gift-hampers');
  assert.equal(websitePath('/category/dry-fruits'), '/category/dry-fruits');
  assert.equal(websitePath('javascript:alert(1)'), '/shop');
});

test('offers that ask customers to use a coupon code are recognised (coupons are not applied at checkout)', () => {
  assert.equal(mentionsCouponCode('First Order Offer Flat Rs.50 off with WELCOME50'), true);
  assert.equal(mentionsCouponCode('Use coupon at checkout'), true);
  assert.equal(mentionsCouponCode('Free Delivery Weekend On orders above Rs.499'), false);
  assert.equal(mentionsCouponCode('Premium Almonds Naturally rich. Carefully selected.'), false);
});

import { safeNext } from '../lib/links.ts';
import { phoneSchema, otpSchema, profileSchema } from '../lib/auth/schemas.ts';
import { classifyAuthError } from '../lib/auth/errors.ts';
import { isValidIndianMobile, toE164, formatPhoneDisplay } from '../lib/auth/phone.ts';

test('after sign-in only a path on this site is followed (no open redirect)', () => {
  assert.equal(safeNext('/checkout'), '/checkout');
  assert.equal(safeNext('/account/orders?x=1'), '/account/orders?x=1');
  for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, undefined, '/login', '/login?next=/x', '/ok\r\nSet-Cookie: a=b']) {
    assert.equal(safeNext(bad), '/account', String(bad));
  }
  assert.equal(safeNext(null, '/'), '/');
});

test('indian mobile numbers are recognised and sent in one format', () => {
  assert.equal(isValidIndianMobile('98765 43210'), true);
  assert.equal(isValidIndianMobile('+91 98765-43210'), true);
  assert.equal(isValidIndianMobile('12345 67890'), false);
  assert.equal(isValidIndianMobile('98765'), false);
  assert.equal(toE164('98765 43210'), '+919876543210');
  assert.equal(toE164('+91 9876543210'), '+919876543210');
  assert.equal(formatPhoneDisplay('9876543210'), '+91 98765 43210');
});

test('sign-in forms accept good input and explain bad input', () => {
  assert.equal(phoneSchema.safeParse({ phone: '9876543210' }).success, true);
  assert.equal(phoneSchema.safeParse({ phone: '' }).success, false);
  assert.equal(phoneSchema.safeParse({ phone: '1234567890' }).success, false);
  assert.equal(otpSchema.safeParse({ code: '123456' }).success, true);
  for (const bad of ['12345', '1234567', 'abcdef', '12 3456']) assert.equal(otpSchema.safeParse({ code: bad }).success, false, bad);
  assert.equal(profileSchema.safeParse({ fullName: 'Asha Verma', email: '' }).success, true);
  assert.equal(profileSchema.safeParse({ fullName: 'Asha Verma', email: 'asha@example.com' }).success, true);
  assert.equal(profileSchema.safeParse({ fullName: 'A', email: '' }).success, false);
  assert.equal(profileSchema.safeParse({ fullName: 'Asha', email: 'nope' }).success, false);
});

test('provider detail never reaches the customer; the wrong code and rate limits are told apart', () => {
  assert.match(classifyAuthError({ code: 'otp_expired' }).message, /incorrect or has expired/);
  assert.equal(classifyAuthError({ code: 'over_sms_send_rate_limit' }).code, 'RATE_LIMITED');
  const hook = classifyAuthError({ code: 'hook_failed', message: 'Fast2SMS balance low https://x' });
  assert.doesNotMatch(hook.message, /Fast2SMS|https/);
  assert.equal(classifyAuthError({ name: 'AuthRetryableFetchError', message: 'fetch failed' }).code, 'NETWORK_ERROR');
});
