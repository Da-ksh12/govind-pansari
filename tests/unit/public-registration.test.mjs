// Public registration is "mobile number + OTP": the same two screens sign a returning customer in and
// register a new one, after which a one-time welcome step collects the name. The screens can't be rendered
// in these tests, so this pins the wiring that makes that flow work — the specific edits that would silently
// break sign-up (a new number being refused, the name step being skipped, a broken email path being exposed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

test('asking for a phone code creates the account for a new number (sign-up is not switched off)', () => {
  const service = read('services/supabase/authService.ts');
  const requestOtp = service.slice(service.indexOf('async requestOtp'), service.indexOf('async verifyOtp'));
  assert.match(requestOtp, /signInWithOtp\(\{ phone: toE164\(phone\) \}\)/);
  assert.doesNotMatch(requestOtp, /shouldCreateUser\s*:\s*false/, 'phone sign-up must stay open');
  // The code is checked by Supabase Auth itself, never by app code.
  assert.match(service, /verifyOtp\(\{ phone: toE164\(phone\), token, type: 'sms' \}\)/);
});

test('the login screen tells people it is also how they register, and offers mobile + OTP only', () => {
  const login = read('app/login.tsx');
  assert.match(login, /Sign in or sign up/);
  assert.match(login, /New here\?/);
  assert.match(login, /const EMAIL_SIGN_IN_ENABLED = false;/, 'email codes are capped at 2 an hour; they must not be offered to the public');
  assert.match(login, /\{EMAIL_SIGN_IN_ENABLED && \(/);
});

test('a number is only accepted when it is a valid Indian mobile, and always sent in +91 form', () => {
  const login = read('app/login.tsx');
  assert.match(login, /isValidIndianMobile\(phone\)/);
  assert.match(login, /toE164\(phone\)/);
});

test('after the code is verified, a customer without a name is sent to the welcome step', () => {
  // The decision lives in one shared rule (services/startupRoute.ts) that the OTP screen and the start screen both use; the rule itself
  // is exercised for real in profile-persistence.test.mjs. Here: both screens use it, and it still sends a nameless customer to /welcome.
  const otp = read('app/otp.tsx');
  assert.match(otp, /await useAuthStore\.getState\(\)\.refreshProfile\(\)/, 'the profile must be loaded before deciding where to go');
  assert.match(otp, /routeAfterSignIn\(/);
  // A relaunch before finishing the welcome step lands there again.
  assert.match(read('app/index.tsx'), /startupDecision\(/);
  assert.match(read('services/startupRoute.ts'), /if \(!profile\.hasName\) return \{ kind: 'go', route: '\/welcome' \};/);
});

test('the welcome step needs a real name and saves it to the customer\'s own profile', () => {
  const welcome = read('app/welcome.tsx');
  assert.match(welcome, /name\.trim\(\)\.length > 1/);
  assert.match(welcome, /userRepository\.updateProfile\(\{\s*fullName: name\.trim\(\)/);
  // Role / phone / status are not part of what this screen can send.
  assert.doesNotMatch(welcome, /role\s*:|isActive|admin_role/);
});

test('the resend button waits as long as Supabase does before it will send another code', () => {
  assert.match(read('app/otp.tsx'), /const RESEND_SECONDS = 60;/);
});
