// What the rider app may send and how a customer is told how fresh it is. Location must be real, recent and honest.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEARTBEAT_AFTER_MS,
  MAX_ACCEPTABLE_ACCURACY_M,
  MAX_FIX_AGE_MS,
  MIN_SEND_INTERVAL_MS,
  decideFix,
  heartbeatDue,
  isValidPosition,
} from '../../services/location/riderFixPolicy.ts';
import { APPROXIMATE_ACCURACY_METERS, STALE_AFTER_SECONDS, ageSeconds, describeFreshness, formatAge } from '../../services/riderFreshness.ts';

const NOW = 1_800_000_000_000;
const fix = (over = {}) => ({ latitude: 27.2, longitude: 78.0, accuracy: 20, timestamp: NOW - 1000, ...over });

test('a fresh, precise reading is sent', () => {
  assert.deepEqual(decideFix(fix(), NOW, null), { send: true });
});

test('a cached or delayed reading is never sent as if it were current', () => {
  assert.deepEqual(decideFix(fix({ timestamp: NOW - MAX_FIX_AGE_MS - 1 }), NOW, null), { send: false, reason: 'stale' });
  assert.deepEqual(decideFix(fix({ timestamp: NOW - MAX_FIX_AGE_MS }), NOW, null), { send: true }, 'exactly at the limit still counts as fresh');
  assert.deepEqual(decideFix(fix({ timestamp: Number.NaN }), NOW, null), { send: false, reason: 'stale' });
});

test('an imprecise reading is held back instead of moving the marker to a wrong street', () => {
  assert.deepEqual(decideFix(fix({ accuracy: MAX_ACCEPTABLE_ACCURACY_M + 1 }), NOW, null), { send: false, reason: 'inaccurate' });
  assert.deepEqual(decideFix(fix({ accuracy: MAX_ACCEPTABLE_ACCURACY_M }), NOW, null), { send: true });
  assert.deepEqual(decideFix(fix({ accuracy: -5 }), NOW, null), { send: false, reason: 'inaccurate' });
  assert.deepEqual(decideFix(fix({ accuracy: null }), NOW, null), { send: true }, 'a provider that reports no accuracy is not blocked');
});

test('impossible or placeholder positions are rejected', () => {
  for (const bad of [{ latitude: 91 }, { latitude: -91 }, { longitude: 181 }, { latitude: Number.NaN }, { latitude: 0, longitude: 0 }]) {
    assert.deepEqual(decideFix(fix(bad), NOW, null), { send: false, reason: 'invalid' }, JSON.stringify(bad));
  }
  assert.equal(isValidPosition(27.2, 78.0), true);
});

test('sending is throttled to one reading per interval whatever the OS delivers', () => {
  assert.deepEqual(decideFix(fix(), NOW, NOW - MIN_SEND_INTERVAL_MS + 1), { send: false, reason: 'too_soon' });
  assert.deepEqual(decideFix(fix(), NOW, NOW - MIN_SEND_INTERVAL_MS), { send: true });
});

test('a rider who has stopped still gets a heartbeat reading once the silence is long enough', () => {
  assert.equal(heartbeatDue(NOW, null), true, 'nothing sent yet');
  assert.equal(heartbeatDue(NOW, NOW - HEARTBEAT_AFTER_MS + 1), false);
  assert.equal(heartbeatDue(NOW, NOW - HEARTBEAT_AFTER_MS), true);
});

test('the heartbeat interval stays well inside the stale window so a waiting rider never looks lost', () => {
  assert.ok(HEARTBEAT_AFTER_MS / 1000 < STALE_AFTER_SECONDS, 'a heartbeat must arrive before the customer is told the position is stale');
});

test('age is measured from the stored time; a timestamp slightly ahead of this phone is clock skew, not the future', () => {
  const iso = (ms) => new Date(ms).toISOString();
  assert.equal(ageSeconds(iso(NOW - 12_000), NOW), 12);
  assert.equal(ageSeconds(iso(NOW + 5_000), NOW), 0);
  assert.equal(ageSeconds('not a date', NOW), Number.POSITIVE_INFINITY);
});

test('last-updated wording', () => {
  assert.equal(formatAge(0), 'Updated just now');
  assert.equal(formatAge(9), 'Updated just now');
  assert.equal(formatAge(10), 'Updated 10 s ago');
  assert.equal(formatAge(59), 'Updated 59 s ago');
  assert.equal(formatAge(60), 'Updated 1 min ago');
  assert.equal(formatAge(150), 'Updated 2 min ago');
  assert.equal(formatAge(3 * 3600), 'Updated 3 h ago');
  assert.equal(formatAge(Number.POSITIVE_INFINITY), 'Updated a while ago');
});

test('staleness and accuracy are reported from the stored fix only', () => {
  const iso = (ms) => new Date(ms).toISOString();
  const fresh = describeFreshness({ recordedAt: iso(NOW - 5_000), accuracy: 18.4 }, NOW);
  assert.deepEqual({ stale: fresh.stale, approximate: fresh.approximate, accuracyLabel: fresh.accuracyLabel, label: fresh.label }, { stale: false, approximate: false, accuracyLabel: '±18 m', label: 'Updated just now' });

  const stale = describeFreshness({ recordedAt: iso(NOW - (STALE_AFTER_SECONDS + 1) * 1000), accuracy: null }, NOW);
  assert.equal(stale.stale, true);
  assert.equal(stale.accuracyLabel, null);
  assert.equal(describeFreshness({ recordedAt: iso(NOW - STALE_AFTER_SECONDS * 1000), accuracy: null }, NOW).stale, false, 'exactly at the limit is not yet stale');

  const rough = describeFreshness({ recordedAt: iso(NOW - 2_000), accuracy: APPROXIMATE_ACCURACY_METERS + 1 }, NOW);
  assert.equal(rough.approximate, true);
});
