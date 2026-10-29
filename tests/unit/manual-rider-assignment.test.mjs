// Riders are assigned only by a person choosing one: statuses in the list, "didn't accept" asks again, and a
// cancel needs two separate confirmations before the order goes back to the list of riders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canCancelAssignment,
  cancelPrompt,
  describeRiderStatus,
  describeUnanswered,
  formatRiderDistance,
  nextCancelStep,
  riderBlockedReason,
  unansweredAttempt,
} from '../../services/riderAssignment.ts';
import { describeAssignmentError } from '../../services/assignmentErrors.ts';
import { navigateForNotification } from '../../services/notifications/navigateForNotification.ts';

const source = (path) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

test('every status the database reports has a plain label and a tone', () => {
  assert.deepEqual(describeRiderStatus('free'), { label: 'Free', tone: 'good' });
  assert.equal(describeRiderStatus('delivering').label, 'Delivering');
  assert.equal(describeRiderStatus('heading_to_store').label, 'Heading to store');
  assert.equal(describeRiderStatus('at_store').label, 'At a store');
  assert.equal(describeRiderStatus('request_pending').label, 'Request pending');
  assert.deepEqual(describeRiderStatus('offline'), { label: 'Offline', tone: 'muted' });
  // A status the app does not know about is shown as such, never as "Free".
  assert.equal(describeRiderStatus('something_new').tone, 'muted');
});

test('distance is shown in metres or km, and flagged when the rider\'s position is old', () => {
  assert.equal(formatRiderDistance(null, null), 'Location unknown');
  assert.equal(formatRiderDistance(850, 30), '850 m away');
  assert.equal(formatRiderDistance(1400, 60), '1.4 km away');
  assert.equal(formatRiderDistance(1400, 20 * 60), '1.4 km away · seen 20 min ago');
  assert.equal(formatRiderDistance(900, 3 * 3600), '900 m away · seen 3 h ago');
});

test('a rider who cannot take the order says why', () => {
  assert.equal(riderBlockedReason({ canAssign: true, status: 'free', activeDeliveries: 0, capacity: 1 }), null);
  assert.match(riderBlockedReason({ canAssign: false, status: 'offline', activeDeliveries: 0, capacity: 1 }), /Offline/);
  assert.match(riderBlockedReason({ canAssign: false, status: 'delivering', activeDeliveries: 1, capacity: 1 }), /1\/1/);
});

const attempt = (over) => ({ assignmentId: 'a1', riderId: 'r1', riderName: 'Ramesh', status: 'declined', reason: null, assignedAt: '2026-10-27T10:00:00Z', endedAt: '2026-10-27T10:01:00Z', ...over });

test('a declined or timed-out rider is asked about again until someone else is chosen', () => {
  assert.equal(unansweredAttempt([attempt({ status: 'declined' })], false)?.assignmentId, 'a1');
  assert.equal(unansweredAttempt([attempt({ status: 'expired' })], false)?.assignmentId, 'a1');
  // Someone else already has the order: nothing to ask.
  assert.equal(unansweredAttempt([attempt({ status: 'declined' })], true), null);
  // The manager's own cancel, a finished delivery or no history at all need no prompt.
  assert.equal(unansweredAttempt([attempt({ status: 'cancelled' })], false), null);
  assert.equal(unansweredAttempt([attempt({ status: 'completed' })], false), null);
  assert.equal(unansweredAttempt([], false), null);
  // Only the newest attempt counts: an old decline followed by a cancel is not "unanswered".
  assert.equal(unansweredAttempt([attempt({ assignmentId: 'a2', status: 'cancelled' }), attempt({ status: 'declined' })], false), null);
});

test('the prompt names the rider and the reason', () => {
  assert.deepEqual(describeUnanswered(attempt({ reason: 'busy right now' })), { title: 'Ramesh declined this order', detail: 'Reason: busy right now' });
  assert.equal(describeUnanswered(attempt()).detail, 'No reason was given.');
  assert.deepEqual(describeUnanswered(attempt({ status: 'expired' })), { title: "Ramesh didn't respond", detail: 'The request ran out of time (5 minutes).' });
});

test('an assignment can be cancelled until the rider has the parcel', () => {
  for (const status of ['assigned', 'accepted', 'at_store']) assert.equal(canCancelAssignment(status), true, status);
  for (const status of ['picked_up', 'in_transit', 'completed', 'cancelled', 'declined', 'expired', 'failed']) assert.equal(canCancelAssignment(status), false, status);
});

test('cancelling takes two separate confirmations: the second prompt is only reachable through the first', () => {
  let step = nextCancelStep('closed', 'open');
  assert.equal(step, 'first');
  step = nextCancelStep(step, 'continue');
  assert.equal(step, 'second');
  // "continue" from anywhere but the first prompt does nothing, so one stray action can never skip ahead.
  assert.equal(nextCancelStep('closed', 'continue'), 'closed');
  assert.equal(nextCancelStep('second', 'continue'), 'second');
  // Backing out or finishing closes it, from either prompt.
  assert.equal(nextCancelStep('first', 'back'), 'closed');
  assert.equal(nextCancelStep('second', 'back'), 'closed');
  assert.equal(nextCancelStep('second', 'finished'), 'closed');
});

test('the two prompts ask different questions and say what happens', () => {
  const first = cancelPrompt('first', 'Ramesh', '1042', 'assigned');
  const second = cancelPrompt('second', 'Ramesh', '1042', 'assigned');
  assert.notEqual(first.title, second.title);
  assert.match(first.message, /hasn't accepted Order #1042/);
  assert.match(cancelPrompt('first', 'Ramesh', '1042', 'accepted').message, /already on the way/);
  assert.match(second.title, /sure/i);
  assert.match(second.message, /choose another rider straight away/);
  assert.notEqual(first.primaryLabel, second.primaryLabel);
});

test('cancelling an assignment that already ended explains and refreshes', () => {
  const ended = describeAssignmentError(new Error('assignment is already in a terminal state (declined)'));
  assert.equal(ended.refresh, true);
  assert.match(ended.message, /already ended/);
});

test('"rider did not accept" notifications open the screen where someone can choose again', () => {
  assert.equal(navigateForNotification('dispatch_round_expired', { orderId: 'o1', audience: 'store' }), '/store/orders/o1');
  assert.equal(navigateForNotification('dispatch_round_expired', { orderId: 'o1' }), '/store/orders/o1');
  assert.equal(navigateForNotification('dispatch_round_expired', { orderId: 'o1', audience: 'admin' }), '/admin/deliveries?tab=needs-rider');
});

test('no screen offers automatic assignment any more', () => {
  const store = source('app/store/orders/[id].tsx');
  const modal = source('components/admin/AssignRiderModal.tsx');
  const repo = source('services/repositories/storeOpsRepository.ts');
  for (const [name, text] of [['store order screen', store], ['admin assign modal', modal]]) {
    assert.doesNotMatch(text, /Auto-?Assign|startAutoAssignment|stopAutoAssignment|Send to All Nearby|startDispatchRound/i, `${name} still offers automatic assignment`);
  }
  assert.doesNotMatch(repo, /start_auto_assignment|stop_auto_assignment/, 'the repository must not expose the disabled auto-assign calls');
  // The only way to give an order a rider from these screens is to pick one.
  assert.match(store, /storeOpsRepository\s*\.assignRider|storeOpsRepository\.assignRider/);
  assert.match(modal, /storeOpsRepository\.assignRider/);
});

test('cancel in the store and admin apps goes through the two-step dialog, then straight to choosing a rider', () => {
  const store = source('app/store/orders/[id].tsx');
  const admin = source('app/admin/deliveries/[id].tsx');
  for (const [name, text] of [['store', store], ['admin', admin]]) {
    assert.match(text, /<CancelAssignmentDialog/, `${name} must use the two-step cancel dialog`);
    assert.doesNotMatch(text, /Alert\.alert\([^)]*[Cc]ancel (this )?(rider )?[Aa]ssignment/, `${name} must not cancel behind a single Alert`);
  }
  // After the confirmed cancel the rider list opens immediately.
  assert.match(store, /handleConfirmCancel[\s\S]*?cancelAssignment\([\s\S]*?openRiderSheet\(\)/);
  assert.match(admin, /cancelAssignment[\s\S]*?setAssignOrder\(orderForAssign\)/);
});
