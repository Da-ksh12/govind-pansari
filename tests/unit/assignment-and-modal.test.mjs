// QA TC-11 (Assign Rider) and TC-12 (modal buttons wrapping).
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAssignmentError } from '../../services/assignmentErrors.ts';
import { shouldStackModalButtons } from '../../components/ui/modals/modalLayout.ts';

test('assignment failures become advice an admin can act on', () => {
  const stale = describeAssignmentError(new Error('Order is not ready for rider assignment'));
  assert.equal(stale.refresh, true, 'a stale list is reloaded rather than left as a dead row');
  assert.match(stale.message, /no longer waiting for a rider/);

  assert.match(describeAssignmentError('Rider is at capacity').message, /maximum number of active deliveries/);
  assert.equal(describeAssignmentError('Rider is at capacity').refresh, false);
  assert.match(describeAssignmentError(new Error('rider not found')).message, /no longer available/);
  assert.match(describeAssignmentError(new Error('not authorized to assign riders')).message, /permission/);
  assert.equal(describeAssignmentError(new Error('Order is waiting for its online payment')).refresh, true);
});

test('unknown, empty and non-error input gets a generic retry message', () => {
  for (const raw of [undefined, null, 42, {}, '', new Error('boom: relation "x" does not exist')]) {
    const failure = describeAssignmentError(raw);
    assert.equal(failure.message, "Couldn't assign a rider. Please try again.");
    assert.equal(failure.refresh, false);
  }
});

test('database text never leaks through', () => {
  const failure = describeAssignmentError(new Error('duplicate key value violates unique constraint "deliveries_order_id_key"'));
  assert.doesNotMatch(failure.message, /constraint|duplicate|deliveries_/);
});

test('"Change Payment Method" stacks its buttons; short labels stay side by side (TC-12)', () => {
  assert.equal(shouldStackModalButtons('Try Again', 'Change Payment Method'), true);
  assert.equal(shouldStackModalButtons('Change Payment Method', 'Cancel'), true);
  assert.equal(shouldStackModalButtons('Cancel', 'Delete'), false);
  assert.equal(shouldStackModalButtons('Keep Editing', 'Discard'), false);
});

test('a single-button modal never stacks', () => {
  assert.equal(shouldStackModalButtons('Change Payment Method', undefined), false);
  assert.equal(shouldStackModalButtons(undefined, 'Change Payment Method'), false);
  assert.equal(shouldStackModalButtons(undefined, undefined), false);
});

test('the boundary is 14 characters', () => {
  assert.equal(shouldStackModalButtons('12345678901234', 'OK'), false);
  assert.equal(shouldStackModalButtons('123456789012345', 'OK'), true);
});
