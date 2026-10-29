// The realtime subscription layer: shared channels, exact cleanup, no duplicate listeners, burst coalescing and a
// refetch after a dropped connection comes back. Runs against a fake Realtime client — the live behaviour against
// the real service is covered by supabase/tests/realtime-live.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindingKey, createLiveFeed } from '../../services/realtime/liveFeedCore.ts';

function fakeClient() {
  const channels = [];
  const removed = [];
  return {
    channels,
    removed,
    channel(name) {
      const ch = {
        name,
        bindings: [],
        statusCallback: null,
        on(type, filter, cb) {
          ch.bindings.push({ type, filter, cb });
          return ch;
        },
        subscribe(cb) {
          ch.statusCallback = cb;
          return ch;
        },
        status(s) {
          ch.statusCallback?.(s);
        },
        emit(payload) {
          for (const b of ch.bindings) b.cb(payload);
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      removed.push(ch);
    },
  };
}

function fakeTimers() {
  let now = 0;
  const pending = [];
  return {
    setTimeout(fn, ms) {
      const t = { at: now + ms, fn, live: true };
      pending.push(t);
      return t;
    },
    clearTimeout(t) {
      if (t) t.live = false;
    },
    advance(ms) {
      now += ms;
      for (const t of pending.filter((p) => p.live && p.at <= now)) {
        t.live = false;
        t.fn();
      }
    },
  };
}

const ORDERS = { table: 'orders' };
const row = (eventType = 'UPDATE', n = {}) => ({ eventType, new: n, old: {} });

test('the same table+filter is ONE channel no matter how many screens listen', () => {
  const client = fakeClient();
  const feed = createLiveFeed(client, fakeTimers());
  const a = feed.watch([ORDERS], () => {});
  const b = feed.watch([ORDERS], () => {});
  const c = feed.watchRows(ORDERS, () => {});
  assert.equal(client.channels.length, 1);
  assert.deepEqual(feed.stats(), { channels: 1, listeners: 3 });
  a();
  b();
  c();
});

test('different filters or events are separate channels, and the filter is passed through to Realtime', () => {
  const client = fakeClient();
  const feed = createLiveFeed(client, fakeTimers());
  feed.watch([{ table: 'orders', filter: 'id=eq.1' }], () => {});
  feed.watch([{ table: 'orders', filter: 'id=eq.2' }], () => {});
  feed.watch([{ table: 'orders', event: 'UPDATE', filter: 'id=eq.1' }], () => {});
  assert.equal(client.channels.length, 3);
  assert.deepEqual(client.channels[0].bindings[0].filter, { event: '*', schema: 'public', table: 'orders', filter: 'id=eq.1' });
  assert.notEqual(bindingKey({ table: 'orders' }), bindingKey({ table: 'orders', filter: 'id=eq.1' }));
});

test('cleanup is exact: the last listener removes the channel, a second unsubscribe is harmless, nothing arrives afterwards', () => {
  const client = fakeClient();
  const feed = createLiveFeed(client, fakeTimers());
  let calls = 0;
  const leaveA = feed.watch([ORDERS], () => calls++);
  const leaveB = feed.watch([ORDERS], () => calls++);
  leaveA();
  assert.equal(client.removed.length, 0, 'another screen still listens');
  leaveA(); // double unsubscribe
  leaveB();
  assert.equal(client.removed.length, 1);
  assert.deepEqual(feed.stats(), { channels: 0, listeners: 0 });
  client.channels[0].emit(row());
  assert.equal(calls, 0, 'a removed channel must not call back');
  feed.watch([ORDERS], () => {});
  assert.equal(client.channels.length, 2, 'listening again opens a fresh channel');
});

test('a stale unsubscribe cannot tear down the fresh channel that replaced it', () => {
  const client = fakeClient();
  const feed = createLiveFeed(client, fakeTimers());
  const leaveOld = feed.watch([ORDERS], () => {});
  leaveOld(); // channel #1 closes
  let calls = 0;
  feed.watch([ORDERS], () => calls++); // a new screen opens channel #2 for the same stream
  assert.equal(client.channels.length, 2);
  leaveOld(); // the old screen's cleanup runs again (e.g. a repeated effect cleanup)
  assert.equal(client.removed.length, 1, 'only the first channel was ever removed');
  client.channels[1].emit(row());
  assert.equal(calls, 1, 'the new screen still receives events');
});

test('a burst of events becomes one immediate call plus one trailing call, then it is quiet again', () => {
  const client = fakeClient();
  const timers = fakeTimers();
  const feed = createLiveFeed(client, timers);
  let calls = 0;
  feed.watch([ORDERS], () => calls++, { coalesceMs: 300 });
  const ch = client.channels[0];
  for (let i = 0; i < 50; i++) ch.emit(row());
  assert.equal(calls, 1, 'the first event is not delayed');
  timers.advance(299);
  assert.equal(calls, 1);
  timers.advance(1);
  assert.equal(calls, 2, '49 events inside the window collapse into one trailing refetch');
  timers.advance(1000);
  assert.equal(calls, 2, 'no further calls without new events');
  ch.emit(row());
  assert.equal(calls, 3, 'after a quiet period the next event is immediate again');
});

test('one watch over several tables is still one call per window', () => {
  const client = fakeClient();
  const timers = fakeTimers();
  const feed = createLiveFeed(client, timers);
  let calls = 0;
  feed.watch([{ table: 'orders' }, { table: 'delivery_assignments' }, { table: 'riders' }], () => calls++);
  assert.equal(client.channels.length, 3);
  client.channels[0].emit(row());
  client.channels[1].emit(row());
  client.channels[2].emit(row());
  assert.equal(calls, 1);
  timers.advance(300);
  assert.equal(calls, 2);
});

test('after a dropped connection comes back, listeners refetch exactly once (with catch-up on the first connect turned off)', () => {
  const client = fakeClient();
  const timers = fakeTimers();
  const feed = createLiveFeed(client, timers);
  let calls = 0;
  feed.watch([ORDERS], () => calls++, { catchUpOnConnect: false });
  const ch = client.channels[0];
  ch.status('SUBSCRIBED');
  assert.equal(calls, 0, 'opted out of the first-connect catch-up');
  ch.status('CHANNEL_ERROR');
  assert.equal(calls, 0, 'dropping alone does nothing');
  ch.status('SUBSCRIBED');
  assert.equal(calls, 1, 'events may have been missed while down, so refetch');
  ch.status('SUBSCRIBED');
  timers.advance(300);
  assert.equal(calls, 1, 'a repeated SUBSCRIBED is not another gap');
  ch.status('TIMED_OUT');
  ch.status('SUBSCRIBED');
  assert.equal(calls, 2);
  timers.advance(300);
  ch.status('CLOSED');
  ch.status('SUBSCRIBED');
  assert.equal(calls, 3);
});

test('by default a screen catches up once when its channel first becomes ready — events in the join window would otherwise be lost', () => {
  const client = fakeClient();
  const feed = createLiveFeed(client, fakeTimers());
  let first = 0;
  feed.watch([ORDERS], () => first++);
  assert.equal(first, 0, 'nothing yet: the channel is still joining');
  client.channels[0].status('SUBSCRIBED');
  assert.equal(first, 1, 'ready: one catch-up refetch');
  client.channels[0].status('SUBSCRIBED');
  assert.equal(first, 1, 'not repeated');
  let second = 0;
  feed.watch([ORDERS], () => second++);
  assert.equal(second, 1, 'joined an already-healthy channel: one catch-up');
});

test('a screen that never saw its channel become ready is caught up when it finally does, even after errors while joining', () => {
  const client = fakeClient();
  const timers = fakeTimers();
  const feed = createLiveFeed(client, timers);
  let calls = 0;
  feed.watch([ORDERS], () => calls++);
  client.channels[0].status('CHANNEL_ERROR');
  client.channels[0].status('TIMED_OUT');
  assert.equal(calls, 0);
  client.channels[0].status('SUBSCRIBED');
  assert.equal(calls, 1);
});

test('watchRows delivers each row, reports a gap through onResync, and is not coalesced', () => {
  const client = fakeClient();
  const feed = createLiveFeed(client, fakeTimers());
  const seen = [];
  let resyncs = 0;
  feed.watchRows({ table: 'rider_locations', event: 'INSERT', filter: 'delivery_id=eq.d1' }, (c) => seen.push(c.new.n), { onResync: () => resyncs++ });
  const ch = client.channels[0];
  ch.status('SUBSCRIBED');
  ch.emit(row('INSERT', { n: 1 }));
  ch.emit(row('INSERT', { n: 2 }));
  ch.emit(row('INSERT', { n: 3 }));
  assert.deepEqual(seen, [1, 2, 3]);
  ch.status('CHANNEL_ERROR');
  ch.status('SUBSCRIBED');
  assert.equal(resyncs, 1);
});

test('a listener that throws does not stop the others hearing the same event', () => {
  const client = fakeClient();
  const feed = createLiveFeed(client, fakeTimers());
  let ok = 0;
  feed.watchRows(ORDERS, () => {
    throw new Error('boom');
  });
  feed.watchRows(ORDERS, () => ok++);
  client.channels[0].emit(row());
  assert.equal(ok, 1);
});

test('foreground resync reaches only the listeners that asked for it', () => {
  const client = fakeClient();
  const feed = createLiveFeed(client, fakeTimers());
  let asked = 0;
  let notAsked = 0;
  feed.watch([ORDERS], () => asked++, { resyncOnForeground: true });
  feed.watch([{ table: 'riders' }], () => notAsked++);
  feed.notifyForeground();
  assert.equal(asked, 1);
  assert.equal(notAsked, 0);
});

test('events arriving after the last listener left are ignored (no late setState on an unmounted screen)', () => {
  const client = fakeClient();
  const feed = createLiveFeed(client, fakeTimers());
  let calls = 0;
  const leave = feed.watch([ORDERS], () => calls++);
  const ch = client.channels[0];
  leave();
  ch.emit(row());
  ch.status('SUBSCRIBED');
  assert.equal(calls, 0);
});

test('a pending trailing refetch is cancelled when the screen unmounts', () => {
  const client = fakeClient();
  const timers = fakeTimers();
  const feed = createLiveFeed(client, timers);
  let calls = 0;
  const leave = feed.watch([ORDERS], () => calls++);
  client.channels[0].emit(row());
  client.channels[0].emit(row());
  assert.equal(calls, 1);
  leave();
  timers.advance(1000);
  assert.equal(calls, 1);
});
