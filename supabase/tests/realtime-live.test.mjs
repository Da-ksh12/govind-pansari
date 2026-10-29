#!/usr/bin/env node
/**
 * The realtime layer (services/realtime/liveFeedCore.ts) against the REAL Supabase Realtime service, with real
 * sessions and real RLS — not a fake socket:
 *
 *   * an event written by one role reaches the role that is allowed to see it, through ONE shared channel
 *   * a role that is not allowed (a customer, an anonymous client) receives nothing
 *   * two listeners on the same stream do not open two channels, and nothing is left open afterwards
 *   * a dropped socket that comes back triggers a resync, and events flow again afterwards
 *   * each change is delivered once (no duplicate events)
 *
 * The only data it writes: the QA rider toggles its own availability and puts it back (a reversible, harmless
 * event source on a table all three roles can be tested against). No orders are created.
 *
 *   node --env-file=.env --no-warnings --import ./tests/unit/register-ts-resolver.mjs supabase/tests/realtime-live.test.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { createLiveFeed } from '../../services/realtime/liveFeedCore.ts';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!URL || !ANON) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`);
  ok ? passed++ : failed++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 8000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(step);
  }
  return cond();
}

async function clientFor(phone) {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  if (phone) {
    await client.auth.signInWithOtp({ phone });
    const { data, error } = await client.auth.verifyOtp({ phone, token: '123456', type: 'sms' });
    if (error || !data.session) throw new Error(`login failed for ${phone}: ${error?.message}`);
    await client.realtime.setAuth(data.session.access_token);
  }
  return client;
}

const admin = await clientFor('+919000000301');
const customer = await clientFor('+919000001015');
const rider = await clientFor('+919000001101');
const anon = await clientFor(null);

const { data: riderRow } = await rider.from('riders').select('id, is_available').single();
const originalAvailability = riderRow?.is_available;
if (!riderRow) {
  console.error('QA rider row not found');
  process.exit(1);
}

const flip = async (value) => {
  const { error } = await rider.rpc('set_rider_availability', { p_available: value });
  if (error) throw new Error(`set_rider_availability: ${error.message}`);
};

// A bare rows-only feed per role, so we count every raw event with no coalescing.
const feeds = { admin: createLiveFeed(admin), customer: createLiveFeed(customer), anon: createLiveFeed(anon) };
const seen = { admin: [], customer: [], anon: [] };
const statuses = [];

try {
  // ---- delivery, RLS, sharing -------------------------------------------------------------------------------
  const stopAdmin1 = feeds.admin.watchRows({ table: 'riders', filter: `id=eq.${riderRow.id}` }, (c) => seen.admin.push(c), { onResync: () => statuses.push('admin-resync'), catchUpOnConnect: false });
  const stopAdmin2 = feeds.admin.watchRows({ table: 'riders', filter: `id=eq.${riderRow.id}` }, () => {});
  const stopCustomer = feeds.customer.watchRows({ table: 'riders', filter: `id=eq.${riderRow.id}` }, (c) => seen.customer.push(c));
  const stopAnon = feeds.anon.watchRows({ table: 'riders', filter: `id=eq.${riderRow.id}` }, (c) => seen.anon.push(c));

  check('two listeners on the same stream share ONE channel (no duplicate listeners)', feeds.admin.stats().channels === 1 && feeds.admin.stats().listeners === 2, JSON.stringify(feeds.admin.stats()));
  check('the client holds one open channel per role stream, not one per listener', admin.getChannels().length === 1, `${admin.getChannels().length}`);

  // Joining takes a moment (seconds on a slow network): write only once every channel reports it has joined.
  const joined = await waitFor(() => [admin, customer, anon].every((c) => c.getChannels().length > 0 && c.getChannels().every((ch) => ch.state === 'joined')), 40000, 200);
  check('every channel joined the Realtime service', joined, [admin, customer, anon].map((c) => c.getChannels().map((ch) => ch.state).join('/')).join(' | '));
  await flip(!originalAvailability);
  const adminGot = await waitFor(() => seen.admin.length >= 1);
  check('the admin receives the rider change without refreshing', adminGot, `events=${seen.admin.length}`);
  check('the change arrives exactly once (no duplicate events)', (await sleep(1500), seen.admin.length === 1), `events=${seen.admin.length}`);
  check('the event carries the new value (is_available flipped)', seen.admin[0]?.new?.is_available === !originalAvailability, JSON.stringify(seen.admin[0]?.new));
  check('a customer with no delivery for this rider receives nothing (RLS)', seen.customer.length === 0, `events=${seen.customer.length}`);
  check('an anonymous client receives nothing (RLS)', seen.anon.length === 0, `events=${seen.anon.length}`);

  // ---- reconnect --------------------------------------------------------------------------------------------
  const before = seen.admin.length;
  admin.realtime.disconnect();
  await sleep(1500);
  // A change made while the admin's socket is DOWN is exactly what a stream cannot replay.
  await flip(originalAvailability);
  await sleep(1500);
  check('while the socket is down the admin sees nothing (as expected: the stream does not replay)', seen.admin.length === before, `events=${seen.admin.length - before}`);
  admin.realtime.connect();
  const resynced = await waitFor(() => statuses.includes('admin-resync'), 15000);
  check('after the socket comes back the layer tells the screen to refetch (resync)', resynced, `statuses=${JSON.stringify(statuses)}`);

  const afterResync = seen.admin.length;
  await flip(!originalAvailability);
  const gotAgain = await waitFor(() => seen.admin.length > afterResync, 10000);
  check('live events flow again after the reconnect', gotAgain, `events=${seen.admin.length - afterResync}`);
  await flip(originalAvailability);
  await sleep(1000);

  // ---- cleanup ----------------------------------------------------------------------------------------------
  stopAdmin1();
  check('one of two listeners leaving keeps the channel for the other', feeds.admin.stats().channels === 1 && admin.getChannels().length === 1);
  stopAdmin2();
  stopCustomer();
  stopAnon();
  await sleep(500);
  check('after every listener unsubscribes no channel is left open (admin)', feeds.admin.stats().channels === 0 && admin.getChannels().length === 0, `${admin.getChannels().length}`);
  check('... customer', feeds.customer.stats().channels === 0 && customer.getChannels().length === 0);
  check('... anonymous', feeds.anon.stats().channels === 0 && anon.getChannels().length === 0);

  const late = seen.admin.length;
  await flip(!originalAvailability);
  await sleep(1500);
  check('nothing is delivered after unsubscribing', seen.admin.length === late, `events=${seen.admin.length - late}`);
} finally {
  await flip(originalAvailability).catch(() => {});
  const { data: after } = await rider.from('riders').select('is_available').single();
  check('the QA rider is back to its original availability', after?.is_available === originalAvailability, `${after?.is_available} vs ${originalAvailability}`);
  for (const c of [admin, customer, rider, anon]) await c.removeAllChannels();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
