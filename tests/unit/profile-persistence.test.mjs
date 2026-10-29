// "I created my profile, logged out, and it asks for my name again."
// The server keeps the name (checked against the live database). What went wrong was the app: a profile that could not be READ
// (weak connection) was treated as a profile with NO NAME, and a failed refetch blanked a profile that had already loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { retryWithDelays } from '../../services/retry.ts';
import { routeAfterSignIn, startupDecision } from '../../services/startupRoute.ts';
import { profileAfterRefetch } from '../../services/profileState.ts';

const file = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const source = (p) => readFileSync(file(p), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const customer = (over = {}) => ({ role: 'customer', hasName: true, ...over });

// ---- retry --------------------------------------------------------------------------------------------------------------

test('retry: a call that works the first time is not delayed or repeated', async () => {
  const slept = [];
  let calls = 0;
  const value = await retryWithDelays(async () => (++calls, 'ok'), [700, 1800], { sleep: async (ms) => void slept.push(ms) });
  assert.deepEqual({ value, calls, slept }, { value: 'ok', calls: 1, slept: [] });
});

test('retry: a flaky call is tried again after each pause and then succeeds', async () => {
  const slept = [];
  let calls = 0;
  const value = await retryWithDelays(
    async () => {
      if (++calls < 3) throw new Error(`fail ${calls}`);
      return 'ok';
    },
    [700, 1800],
    { sleep: async (ms) => void slept.push(ms) },
  );
  assert.deepEqual({ value, calls, slept }, { value: 'ok', calls: 3, slept: [700, 1800] });
});

test('retry: when every try fails the LAST error is thrown, after exactly delays+1 tries', async () => {
  let calls = 0;
  await assert.rejects(
    retryWithDelays(async () => { throw new Error(`fail ${++calls}`); }, [10, 20], { sleep: async () => {} }),
    /fail 3/,
  );
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(retryWithDelays(async () => { throw new Error(`only ${++calls}`); }, [], { sleep: async () => {} }), /only 1/);
  assert.equal(calls, 1, 'no delays means a single try');
});

test('retry: an error that trying again cannot fix is thrown at once', async () => {
  const slept = [];
  let calls = 0;
  await assert.rejects(
    retryWithDelays(async () => { ++calls; throw new Error('Not signed in'); }, [700, 1800], { shouldRetry: () => false, sleep: async (ms) => void slept.push(ms) }),
    /Not signed in/,
  );
  assert.deepEqual({ calls, slept }, { calls: 1, slept: [] });
});

// ---- where the app goes -------------------------------------------------------------------------------------------------

test('THE BUG: signed in but the profile could not be loaded does NOT go to the name form — it offers a retry', () => {
  const decision = startupDecision({ hasOnboarded: true, authStatus: 'authenticated', profile: null, hasLocation: true });
  assert.deepEqual(decision, { kind: 'profile-unavailable' });
  assert.deepEqual(routeAfterSignIn(null, true), { kind: 'profile-unavailable' });
});

test('the name form is only for an account whose name really is empty', () => {
  assert.deepEqual(routeAfterSignIn(customer({ hasName: false }), true), { kind: 'go', route: '/welcome' });
  assert.deepEqual(routeAfterSignIn(customer({ hasName: true }), true), { kind: 'go', route: '/(tabs)' });
  assert.deepEqual(routeAfterSignIn(customer({ hasName: true }), false), { kind: 'go', route: '/location' });
});

test('staff, riders and admins go to their own area and never to the customer name form', () => {
  for (const [role, route] of [['store_manager', '/store'], ['staff', '/store'], ['rider', '/rider'], ['admin', '/admin']]) {
    assert.deepEqual(routeAfterSignIn({ role, hasName: false }, false), { kind: 'go', route }, role);
  }
});

test('launch order: onboarding first, then login, then the profile-based destination', () => {
  const base = { authStatus: 'authenticated', profile: customer(), hasLocation: true };
  assert.deepEqual(startupDecision({ ...base, hasOnboarded: false }), { kind: 'go', route: '/onboarding' });
  assert.deepEqual(startupDecision({ ...base, hasOnboarded: true, authStatus: 'unauthenticated' }), { kind: 'go', route: '/login' });
  assert.deepEqual(startupDecision({ ...base, hasOnboarded: false, profile: null }), { kind: 'go', route: '/onboarding' }, 'a missing profile does not outrank onboarding');
  assert.deepEqual(startupDecision({ ...base, hasOnboarded: false, authStatus: 'unauthenticated', profile: null }), { kind: 'go', route: '/onboarding' }, 'a first-time visitor sees the intro before login');
});

// ---- which profile is held ----------------------------------------------------------------------------------------------

test('a failed refetch keeps the profile already loaded for the same user, and never another user\'s', () => {
  const held = { id: 'u1', name: 'Priya' };
  const fresh = { id: 'u1', name: 'Priya S' };
  assert.equal(profileAfterRefetch(fresh, held, 'u1'), fresh, 'a fresh read wins');
  assert.equal(profileAfterRefetch(null, held, 'u1'), held, 'a failed read keeps what was loaded');
  assert.equal(profileAfterRefetch(null, held, 'u2'), null, 'another user\'s profile is never carried over');
  assert.equal(profileAfterRefetch(null, null, 'u1'), null);
});

// ---- wiring: the lines this fix depends on ------------------------------------------------------------------------------

test('the auth store reads the profile with retries, from the session\'s own user id, and never blanks a held one', () => {
  const store = code('store/authStore.ts');
  assert.match(store, /retryWithDelays\(\(\) => userRepository\.getProfile\(userId\), PROFILE_RETRY_DELAYS_MS,/, 'the pauses are actually passed');
  assert.match(store, /PROFILE_RETRY_DELAYS_MS = \[700, 1800\]/);
  assert.match(store, /loadProfile\(userId\)/, 'the listener passes the id it already has');
  assert.match(store, /profileAfterRefetch\(profile, get\(\)\.profile, userId\)/);
  assert.match(store, /profileError: !known/);
  assert.doesNotMatch(store, /set\(\{ status: 'authenticated', profile,/, 'the raw (possibly null) fetch result is not what gets stored');
  assert.match(store, /if \(get\(\)\.profileError\) get\(\)\.refreshProfile\(\)/, 'retried when the app returns to the foreground');
  assert.match(store, /shouldRetry: \(error\) => !\(error instanceof NotSignedInError\)/);
});

test('the profile read no longer needs the server round trip auth.getUser()', () => {
  const repo = code('services/repositories/userRepository.ts');
  const body = repo.slice(repo.indexOf('async getProfile'), repo.indexOf('async updateProfile'));
  assert.match(body, /supabase\.auth\.getSession\(\)/);
  assert.doesNotMatch(body, /auth\.getUser\(\)/);
});

test('the start screen and the OTP screen share the one routing rule and never read a missing profile as "no name"', () => {
  const splash = code('app/index.tsx');
  assert.match(splash, /startupDecision\(/);
  assert.doesNotMatch(splash, /!profile\?\.hasName/);
  assert.match(splash, /Couldn't load your account/);
  const otp = code('app/otp.tsx');
  assert.match(otp, /routeAfterSignIn\(profileLoaded \? useAuthStore\.getState\(\)\.profile : null, !!selectedLocation\)/);
  assert.doesNotMatch(otp, /!freshProfile\?\.hasName/);
  const refresh = /try \{\s*await useAuthStore\.getState\(\)\.refreshProfile\(\);\s*\} catch \{\s*profileLoaded = false;/.test(otp);
  assert.ok(refresh, 'a profile read that fails after a correct code is not reported as a wrong code');
});

test('the welcome screen asks the server first and skips itself when the name is already there', () => {
  const welcome = code('app/welcome.tsx');
  assert.match(welcome, /refreshProfile\(\)\s*\.then\(\(\) => \{\s*if \(alive && useAuthStore\.getState\(\)\.profile\?\.hasName\) router\.replace/);
});
