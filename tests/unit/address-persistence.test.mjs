// "My address is not getting saved": the app sent address columns the database did not have yet (migration 20260828000001 not
// applied), so PostgREST refused EVERY save with PGRST204. These tests pin the fix: the save falls back to the long-standing
// columns, nothing the customer typed is lost, and a failed Save always tells the customer what is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STRUCTURED_COLUMNS, createStructuredColumnMemory, isMissingColumnError, withoutStructuredColumns } from '../../services/addressPersistence.ts';
import { EMPTY_FIELDS, FIELD_ORDER, problemsInOrder, validateFields } from '../../services/addressForm.ts';

// The exact error PostgREST returned from the live database (captured 2026-10-28).
const LIVE_ERROR = { code: 'PGRST204', message: "Could not find the 'building' column of 'addresses' in the schema cache" };

// What the new app sent (every new column present, even when blank) and what the old app sent, which the live database accepted.
const NEW_PAYLOAD = {
  user_id: 'u1', label: 'other', recipient_name: 'Probe', phone: '9000000000',
  address_line_1: 'Probe line 1', address_line_2: null, landmark: null, city: 'Agra', state: 'Uttar Pradesh', postal_code: '282002',
  latitude: 27.2, longitude: 78.0,
  house_no: '12', building: null, floor: null, street: 'Rajpur Road', locality: null,
  formatted_address: null, place_id: null, delivery_instructions: null, geocode_source: 'manual',
};
const OLD_PAYLOAD = {
  user_id: 'u1', label: 'other', recipient_name: 'Probe', phone: '9000000000',
  address_line_1: 'Probe line 1', address_line_2: null, landmark: null, city: 'Agra', state: 'Uttar Pradesh', postal_code: '282002',
  latitude: 27.2, longitude: 78.0,
};

test('the real error the live database returned is recognised as "the columns are not there yet"', () => {
  assert.equal(isMissingColumnError(LIVE_ERROR), true);
  assert.equal(isMissingColumnError({ code: 'PGRST204' }), true, 'by its code alone');
  assert.equal(isMissingColumnError({ message: LIVE_ERROR.message }), true, 'and by its text alone');
});

test('only a missing-column error triggers the fallback: a real problem with the address still surfaces', () => {
  assert.equal(isMissingColumnError({ code: '42703', message: 'column "house_no" of relation "addresses" does not exist' }), true);
  assert.equal(isMissingColumnError({ message: "Could not find the 'floor' column of 'addresses' in the schema cache" }), true);
  for (const real of [
    { code: '23514', message: 'new row for relation "addresses" violates check constraint "addresses_latitude_valid"' },
    { code: '42501', message: 'new row violates row-level security policy for table "addresses"' },
    { code: '23502', message: 'null value in column "city" violates not-null constraint' },
    { code: 'PGRST301', message: 'JWT expired' },
    { message: 'Network request failed' },
    null,
    undefined,
  ]) {
    assert.equal(isMissingColumnError(real), false, JSON.stringify(real));
  }
});

test('the fallback payload is exactly what the old app sent — the one the live database accepted', () => {
  assert.deepEqual(withoutStructuredColumns(NEW_PAYLOAD), OLD_PAYLOAD);
});

test('every structured column is removed, and only those', () => {
  const row = { ...NEW_PAYLOAD, house_no: 'H', building: 'B', floor: '2', street: 'S', locality: 'L', formatted_address: 'F', place_id: 'P', delivery_instructions: '', geocode_source: 'google' };
  const legacy = withoutStructuredColumns(row);
  for (const column of STRUCTURED_COLUMNS) assert.equal(column in legacy, false, column);
  for (const kept of Object.keys(OLD_PAYLOAD)) assert.equal(kept in legacy, true, kept);
  assert.equal(STRUCTURED_COLUMNS.length, 9);
});

test('delivery instructions are not lost: they travel in address_line_2, which riders and admins already see', () => {
  const withNote = withoutStructuredColumns({ ...NEW_PAYLOAD, address_line_2: 'Vijay Nagar', delivery_instructions: '  Call on arrival ' });
  assert.equal(withNote.address_line_2, 'Vijay Nagar — Note: Call on arrival');
  const noLine2 = withoutStructuredColumns({ ...NEW_PAYLOAD, address_line_2: null, delivery_instructions: 'Ring twice' });
  assert.equal(noLine2.address_line_2, 'Note: Ring twice');
  assert.equal(withoutStructuredColumns({ ...NEW_PAYLOAD, address_line_2: 'Vijay Nagar', delivery_instructions: '   ' }).address_line_2, 'Vijay Nagar', 'a blank note adds nothing');
});

test('a partial edit never overwrites the line it was not asked to change', () => {
  const patch = withoutStructuredColumns({ delivery_instructions: 'Gate code 4321', house_no: '9' });
  assert.deepEqual(patch, {}, 'only structured fields were edited and this database cannot store them: nothing to send');
  const keepsLine2 = withoutStructuredColumns({ city: 'Mathura', delivery_instructions: 'x' });
  assert.deepEqual(keepsLine2, { city: 'Mathura' });
});

test('the app does not pay for a failed attempt on every save, but re-checks so the new columns are used once the migration lands', () => {
  let now = 1_000_000;
  const memory = createStructuredColumnMemory(() => now, 10 * 60_000);
  assert.equal(memory.shouldTryStructured(), true, 'first save tries the new columns');
  memory.markMissing();
  assert.equal(memory.shouldTryStructured(), false, 'right after a refusal the next saves go straight to the old columns');
  now += 9 * 60_000;
  assert.equal(memory.shouldTryStructured(), false);
  now += 2 * 60_000;
  assert.equal(memory.shouldTryStructured(), true, 'ten minutes later it tries again — the migration may have been applied');
});

const source = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

test('create and update both fall back, and the error is inspected BEFORE it is wrapped (the wrapper hides the code)', () => {
  const repo = code('services/repositories/addressRepository.ts');
  assert.equal((repo.match(/isMissingColumnError\(attempt\.error\)/g) ?? []).length, 2, 'create and update');
  assert.equal((repo.match(/withoutStructuredColumns\(/g) ?? []).length, 2);
  assert.ok(repo.indexOf('isMissingColumnError(attempt.error)') < repo.indexOf('throw toCatalogueError(attempt.error)'));
});

test('every screen that saves an address goes through the repository (so none can bypass the fallback)', () => {
  for (const file of ['app/address/add.tsx', 'app/checkout.tsx']) {
    const src = code(file);
    assert.match(src, /addressRepository\.create\(/, file);
    assert.doesNotMatch(src, /from\('addresses'\)/, file);
  }
});

// ---- a failed Save is never silent ---------------------------------------------------------------------------------

test('an empty form lists every missing thing, in the order the customer meets it', () => {
  const { errors } = validateFields(EMPTY_FIELDS, false);
  const problems = problemsInOrder(errors);
  assert.deepEqual(problems.map((p) => p.key), ['position', 'receiverName', 'receiverPhone', 'houseNo', 'street', 'city', 'state', 'pincode']);
  assert.ok(problems.every((p) => p.label.length > 3 && !/undefined/.test(p.label)));
  assert.match(problems[0].label, /map or your current location/);
});

test('a form with one problem lists exactly that one', () => {
  const ok = { ...EMPTY_FIELDS, receiverName: 'Asha', receiverPhone: '9876543210', houseNo: '12-B', street: 'Rajpur Road', city: 'Agra', state: 'Uttar Pradesh', pincode: '282002' };
  assert.deepEqual(problemsInOrder(validateFields(ok, true).errors), []);
  const noPin = problemsInOrder(validateFields({ ...ok, pincode: '' }, true).errors);
  assert.deepEqual(noPin.map((p) => p.key), ['pincode']);
  assert.match(noPin[0].label, /Postal code/);
});

test('the form order matches the screen (position first, then who, then where)', () => {
  assert.equal(FIELD_ORDER[0], 'position');
  assert.ok(FIELD_ORDER.indexOf('receiverName') < FIELD_ORDER.indexOf('houseNo'));
  assert.ok(FIELD_ORDER.indexOf('houseNo') < FIELD_ORDER.indexOf('pincode'));
});

test('Add Address: a failed Save explains what is missing and scrolls to the first problem instead of doing nothing', () => {
  const src = code('app/address/add.tsx');
  const block = src.slice(src.indexOf('const handleSave'), src.indexOf('const saveAddress'));
  assert.match(block, /problemsInOrder\(validation\.errors\)/);
  assert.match(block, /scrollRef\.current\?\.scrollTo\(/);
  assert.match(block, /Alert\.alert\('Almost there'/);
  assert.match(src, /<ScrollView ref=\{scrollRef\}/);
  for (const key of ['position', 'receiverName', 'receiverPhone', 'houseNo', 'street', 'city', 'pincode']) assert.match(src, new RegExp(`anchor\\('${key}'\\)`), key);
});
