// Auto-filling the sign-in code. The pure part (finding the code in a message) is tested for behaviour; the Android module can only be
// built on the user's machine, so its wiring is checked here instead: names that must agree, the API it must use, and cleanup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractOtp, sanitizeOtpInput } from '../../services/otpExtract.ts';

const file = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const source = (p) => readFileSync(file(p), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('the code is found in typical SMS wording', () => {
  assert.equal(extractOtp('123456 is your OTP for Govind Pansari. Do not share it.'), '123456');
  assert.equal(extractOtp('Your OTP is 654321. Valid for 10 minutes.'), '654321');
  assert.equal(extractOtp('<#> Use 482913 to sign in'), '482913');
  assert.equal(extractOtp('Code:007421'), '007421', 'leading zeros are kept');
});

test('only a run of exactly the right length counts — never part of a longer number', () => {
  assert.equal(extractOtp('Call 9876543210 now'), null, 'a 10-digit phone number');
  assert.equal(extractOtp('Order 1234567 shipped'), null, 'seven digits');
  assert.equal(extractOtp('Ref 12345 and code 678901'), '678901', 'a shorter number before it is skipped');
  assert.equal(extractOtp('Your order 99 code 246810'), '246810');
  assert.equal(extractOtp('no digits here'), null);
  assert.equal(extractOtp(''), null);
  assert.equal(extractOtp('1234 5678'), null, 'groups are not joined');
  assert.equal(extractOtp('code 1234', 4), '1234', 'other lengths work');
});

test('typing and the keyboard suggestion send plain digits; a pasted message gives just the code', () => {
  assert.equal(sanitizeOtpInput('1'), '1');
  assert.equal(sanitizeOtpInput('1234'), '1234');
  assert.equal(sanitizeOtpInput('123456'), '123456');
  assert.equal(sanitizeOtpInput('1234567'), '123456', 'extra digits are cut');
  assert.equal(sanitizeOtpInput('12 34 56'), '123456', 'spaces are ignored');
  assert.equal(sanitizeOtpInput('123-456'), '123456');
  assert.equal(sanitizeOtpInput('Your OTP is 654321. Valid for 10 minutes.'), '654321', 'not "65432110"');
  assert.equal(sanitizeOtpInput('OTP 482913 for order 99'), '482913');
  assert.equal(sanitizeOtpInput('abc'), '');
  assert.equal(sanitizeOtpInput(''), '');
});

// ---- the Android module: things that must agree for it to load at all ------------------------------------------------------

test('the native module is named the same on both sides, and its class is where the config says', () => {
  const kt = source('modules/sms-user-consent/android/src/main/java/expo/modules/smsuserconsent/SmsUserConsentModule.kt');
  const js = code('modules/sms-user-consent/index.ts');
  const name = /Name\("([^"]+)"\)/.exec(kt)?.[1];
  assert.equal(name, 'SmsUserConsent');
  assert.match(js, new RegExp(`requireOptionalNativeModule<SmsUserConsentNative>\\('${name}'\\)`));
  const config = JSON.parse(source('modules/sms-user-consent/expo-module.config.json'));
  assert.deepEqual(config.platforms, ['android']);
  assert.deepEqual(config.android.modules, ['expo.modules.smsuserconsent.SmsUserConsentModule']);
  assert.match(kt, /^package expo\.modules\.smsuserconsent$/m);
  assert.match(kt, /^class SmsUserConsentModule : Module\(\)/m);
  assert.match(source('modules/sms-user-consent/android/build.gradle'), /namespace "expo\.modules\.smsuserconsent"/);
  for (const fn of ['readCodeMessageAsync', 'cancel']) {
    assert.ok(kt.includes(`"${fn}"`), `native function ${fn}`);
    assert.ok(js.includes(fn), `JS calls ${fn}`);
  }
});

test('it uses the SMS User Consent API (no app hash in the DLT template, no SMS permission) and only trusts Google Play services', () => {
  const kt = code('modules/sms-user-consent/android/src/main/java/expo/modules/smsuserconsent/SmsUserConsentModule.kt');
  assert.match(kt, /startSmsUserConsent\(null\)/);
  assert.doesNotMatch(kt, /startSmsRetriever/, 'the Retriever API needs an 11-character hash added to the message, which the registered template does not have');
  assert.match(kt, /SmsRetriever\.SEND_PERMISSION/, 'the receiver accepts broadcasts only from Google Play services');
  assert.match(kt, /Activity\.RESULT_OK\) intent\?\.getStringExtra\(SmsRetriever\.EXTRA_SMS_MESSAGE\) else null/, 'a declined consent screen gives nothing');
  const manifest = source('modules/sms-user-consent/android/src/main/AndroidManifest.xml');
  assert.doesNotMatch(manifest, /uses-permission/, 'no SMS permission is requested');
});

test('the listener is always released: on cancel, on destroy, when a message arrives, and when starting again', () => {
  const kt = code('modules/sms-user-consent/android/src/main/java/expo/modules/smsuserconsent/SmsUserConsentModule.kt');
  assert.match(kt, /Function\("cancel"\) \{ ->\s*settle\(null\)/);
  assert.match(kt, /OnDestroy \{\s*settle\(null\)/);
  assert.match(kt, /settle\(consent\)/);
  assert.match(kt, /unregisterReceiver\(listener\)/);
  const read = kt.slice(kt.indexOf('"readCodeMessageAsync"'), kt.indexOf('Function("cancel")'));
  assert.ok(read.indexOf('settle(null)') > 0 && read.indexOf('settle(null)') < read.indexOf('awaitConsentIntent(context)'), 'a listener from an earlier screen is released before a new one starts');
  assert.match(kt, /addOnFailureListener \{ settle\(null\) \}/);
});

test('the module is optional: iOS and older APKs fall back to typing and the keyboard suggestion', () => {
  const js = code('modules/sms-user-consent/index.ts');
  assert.match(js, /Platform\.OS === 'android' \? requireOptionalNativeModule/);
  assert.match(js, /native \? native\.readCodeMessageAsync\(\) : Promise\.resolve\(null\)/);
  const svc = code('services/smsAutoRead.ts');
  assert.match(svc, /if \(!smsAutoReadAvailable\) return \(\) => \{\};/);
  assert.match(svc, /extractOtp\(message, length\)/);
});

test('the OTP screen listens only for phone sign-in, re-arms after Resend, and stops when it closes', () => {
  const otp = code('app/otp.tsx');
  assert.match(otp, /if \(identifierKind !== 'phone'\) return;\s*return listenForSmsCode\(/, 'the cleanup returned by listenForSmsCode stops the listener');
  assert.match(otp, /\[identifierKind, smsListenRound\]/);
  assert.match(otp, /setSmsListenRound\(\(round\) => round \+ 1\)/);
  assert.match(otp, /setOtp\(sanitizeOtpInput\(t, OTP_LENGTH\)\)/);
  assert.doesNotMatch(otp, /maxLength=\{OTP_LENGTH\}/, 'a pasted message must reach the sanitiser whole, not cut to 6 characters first');
  assert.match(otp, /importantForAutofill="yes"/);
  assert.match(otp, /textContentType="oneTimeCode"/);
  assert.match(otp, /autoComplete="sms-otp"/);
});

test('the module folder is where Expo autolinking looks, with the files it needs', () => {
  for (const p of ['expo-module.config.json', 'index.ts', 'android/build.gradle', 'android/src/main/AndroidManifest.xml', 'android/src/main/java/expo/modules/smsuserconsent/SmsUserConsentModule.kt']) {
    assert.ok(existsSync(file(`modules/sms-user-consent/${p}`)), p);
  }
});
