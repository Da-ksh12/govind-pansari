// Admin editing of stores and riders: the accepted values, which fields count as "changed", and the wiring that makes the buttons work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clockLabel, normalizeIndianMobile, parseClockTime, validateStoreForm } from '../../services/storeEdit.ts';
import { RIDER_EDIT_MIGRATION_PENDING, describeRiderEditError, validateRiderForm } from '../../services/riderEdit.ts';

const file = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const source = (p) => readFileSync(file(p), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// ---- store hours -----------------------------------------------------------------------------------------------------------

test('times are understood in 24-hour and 12-hour writing', () => {
  const cases = {
    '9': '09:00', '09:00': '09:00', '9:30': '09:30', '21:00': '21:00', '23:59': '23:59', '0': '00:00', '00:00': '00:00',
    '9 am': '09:00', '9am': '09:00', '9:30 PM': '21:30', '9.30pm': '21:30', '12 am': '00:00', '12 pm': '12:00', '12:15 am': '00:15', '11:59 PM': '23:59', '  7 : 05  p.m. ': '19:05',
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(parseClockTime(text), want, `"${text}"`);
});

test('things that are not a time are refused', () => {
  for (const text of ['', 'abc', '24:00', '25', '9:60', '13 pm', '0 pm', '9:5', '930', '9:30:00', '-1', '9 xm', '9::30']) assert.equal(parseClockTime(text), null, `"${text}"`);
});

test('the 12-hour label shown beside the box', () => {
  assert.equal(clockLabel('09:00:00'), '9:00 AM');
  assert.equal(clockLabel('21:30'), '9:30 PM');
  assert.equal(clockLabel('00:00:00'), '12:00 AM');
  assert.equal(clockLabel('12:00:00'), '12:00 PM');
  assert.equal(clockLabel('23:59:00'), '11:59 PM');
  assert.equal(clockLabel(null), '');
  assert.equal(clockLabel('nope'), '');
});

// ---- store phone -----------------------------------------------------------------------------------------------------------

test('a mobile number is stored the way the stores already show it', () => {
  assert.equal(normalizeIndianMobile('9000000103'), '+91 90000 00103');
  assert.equal(normalizeIndianMobile('+91 90000 00103'), '+91 90000 00103');
  assert.equal(normalizeIndianMobile('09000000103'), '+91 90000 00103');
  assert.equal(normalizeIndianMobile('+91-90000-00103'), '+91 90000 00103');
  assert.equal(normalizeIndianMobile('919000000103'), '+91 90000 00103');
});

test('numbers that cannot be a mobile are refused', () => {
  for (const text of ['', '12345', '5000000103', '90000001030', '+1 415 555 0100', 'abcdefghij']) assert.equal(normalizeIndianMobile(text), null, `"${text}"`);
});

// ---- store form ------------------------------------------------------------------------------------------------------------

const STORE = { name: 'Govind Pansari — Awas Vikas', phone: '+91 90000 00103', address_line: 'Awas Vikas Colony, Agra', city: 'Agra', opening_time: '09:00:00', closing_time: '21:00:00' };
const storeForm = (over = {}) => ({ name: STORE.name, phone: STORE.phone, addressLine: STORE.address_line, city: STORE.city, opening: '09:00', closing: '21:00', ...over });

test('an untouched form changes nothing, even though the stored times carry seconds', () => {
  const { errors, patch } = validateStoreForm(storeForm(), STORE);
  assert.deepEqual({ errors, patch }, { errors: {}, patch: {} });
});

test('only the fields that changed go in the update, hours with seconds', () => {
  const { errors, patch } = validateStoreForm(storeForm({ closing: '10 pm', phone: '98765 43210', name: '  Govind   Pansari — Awas Vikas  ' }), STORE);
  assert.deepEqual(errors, {});
  assert.deepEqual(patch, { phone: '+91 98765 43210', closing_time: '22:00:00' }, 'extra spaces in the name are not a change');
});

test('a store can be renamed, moved and given new hours in one save', () => {
  const { patch } = validateStoreForm(storeForm({ name: 'GP Awas Vikas', addressLine: 'Sector 11, Awas Vikas', city: 'Agra ', opening: '8:30 am', closing: '9:30 pm' }), STORE);
  assert.deepEqual(patch, { name: 'GP Awas Vikas', address_line: 'Sector 11, Awas Vikas', opening_time: '08:30:00', closing_time: '21:30:00' });
});

test('closing must be after opening — the open-hours check cannot wrap past midnight', () => {
  for (const [opening, closing] of [['21:00', '09:00'], ['09:00', '09:00'], ['10 pm', '2 am']]) {
    const { errors, patch } = validateStoreForm(storeForm({ opening, closing }), STORE);
    assert.match(errors.closing ?? '', /later than opening/, `${opening} -> ${closing}`);
    assert.deepEqual(patch.opening_time, undefined, 'hours are all-or-nothing: a bad pair saves neither');
  }
  assert.deepEqual(validateStoreForm(storeForm({ opening: '00:00', closing: '11:59 PM' }), STORE).errors, {}, 'all night is allowed');
});

test('each bad field gets its own message and nothing is saved from it', () => {
  const { errors } = validateStoreForm(storeForm({ name: 'A', phone: '123', addressLine: 'x', city: '', opening: 'soon', closing: '' }), STORE);
  assert.deepEqual(Object.keys(errors).sort(), ['addressLine', 'city', 'closing', 'name', 'opening', 'phone']);
});

// ---- rider form ------------------------------------------------------------------------------------------------------------

const RIDER = { fullName: 'Ravi', vehicleType: 'scooter', vehicleNumber: 'UP80 QA 1004', primaryStoreId: 's1', maxActive: 1 };
const riderForm = (over = {}) => ({ fullName: 'Ravi', vehicleType: 'scooter', vehicleNumber: 'UP80 QA 1004', primaryStoreId: 's1', maxActive: '1', ...over });

test('an untouched rider form changes nothing', () => {
  assert.deepEqual(validateRiderForm(riderForm(), RIDER), { errors: {}, patch: {} });
});

test('only changed rider fields are sent; vehicle type is lower-case and the number upper-case', () => {
  const { errors, patch } = validateRiderForm(riderForm({ vehicleType: ' Bike ', vehicleNumber: 'up80  ab  1234', primaryStoreId: 's2', maxActive: '3', fullName: 'Ravi Kumar' }), RIDER);
  assert.deepEqual(errors, {});
  assert.deepEqual(patch, { fullName: 'Ravi Kumar', vehicleType: 'bike', vehicleNumber: 'UP80 AB 1234', primaryStoreId: 's2', maxActiveDeliveries: 3 });
});

test('rider limits match the database function: name 2-60, vehicle 1-30, number 1-20, capacity 1-10, a store is required', () => {
  const bad = validateRiderForm(riderForm({ fullName: 'R', vehicleType: '', vehicleNumber: 'X'.repeat(21), primaryStoreId: null, maxActive: '0' }), RIDER).errors;
  assert.deepEqual(Object.keys(bad).sort(), ['fullName', 'maxActive', 'primaryStoreId', 'vehicleNumber', 'vehicleType']);
  for (const max of ['11', '', 'two', '1.5', '-1', '100']) assert.ok(validateRiderForm(riderForm({ maxActive: max }), RIDER).errors.maxActive, `capacity "${max}"`);
  for (const max of ['1', '10', ' 5 ']) assert.equal(validateRiderForm(riderForm({ maxActive: max }), RIDER).errors.maxActive, undefined, `capacity "${max}"`);
  assert.equal(validateRiderForm(riderForm({ fullName: 'N'.repeat(61) }), RIDER).errors.fullName !== undefined, true);
});

test('what the admin is told when the server refuses', () => {
  assert.equal(describeRiderEditError({ code: 'PGRST202', message: 'Could not find the function public.admin_update_rider(...) in the schema cache' }), RIDER_EDIT_MIGRATION_PENDING);
  assert.equal(describeRiderEditError({ message: 'Could not find the function x' }), RIDER_EDIT_MIGRATION_PENDING);
  assert.equal(describeRiderEditError({ message: 'not authorized' }), "You don't have permission to edit riders.");
  assert.equal(describeRiderEditError({ message: 'this rider has a delivery in progress — finish or cancel it first' }), 'this rider has a delivery in progress — finish or cancel it first');
  assert.equal(describeRiderEditError({ message: 'active deliveries at once must be between 1 and 10' }), 'active deliveries at once must be between 1 and 10');
  assert.equal(describeRiderEditError({ message: 'permission denied for table riders' }), "Couldn't save the rider. Please try again.");
  assert.equal(describeRiderEditError({ message: 'duplicate key value violates unique constraint "x"' }), "Couldn't save the rider. Please try again.");
  assert.equal(describeRiderEditError({ message: 'x'.repeat(250) }), "Couldn't save the rider. Please try again.");
  assert.equal(describeRiderEditError(null), "Couldn't save the rider. Please try again.");
});

// ---- wiring ---------------------------------------------------------------------------------------------------------------

test('rider changes go through the checked database function — the locked table is never written directly', () => {
  const repo = code('services/repositories/adminRepository.ts');
  assert.doesNotMatch(repo, /from\('riders'\)\.update/);
  assert.match(repo, /supabase\.rpc\('admin_update_rider', \{ p_rider_id: riderId, p_is_active: isActive \}\)/);
  const update = repo.slice(repo.indexOf('async updateRider'), repo.indexOf('async setRiderActive'));
  for (const p of ['p_full_name', 'p_vehicle_type', 'p_vehicle_number', 'p_primary_store_id', 'p_max_active_deliveries', 'p_is_active']) assert.ok(update.includes(p), p);
  assert.equal((update.match(/\?\? null/g) ?? []).length, 6, 'an absent field is sent as NULL = unchanged');
  const sql = source('supabase/migrations/20260829000001_admin_update_rider.sql');
  for (const p of ['p_full_name', 'p_vehicle_type', 'p_vehicle_number', 'p_primary_store_id', 'p_max_active_deliveries', 'p_is_active']) assert.ok(sql.includes(p), `migration ${p}`);
  assert.match(sql, /has_permission\('riders\.manage'\) or is_admin\(\)/);
  assert.doesNotMatch(sql, /grant update/i, 'the table stays locked');
});

test('a store update that row-level security silently ignored is reported, not shown as saved', () => {
  const repo = code('services/repositories/adminRepository.ts');
  assert.match(repo, /\.update\(patch\)\.eq\('id', storeId\)\.select\('id'\)/);
  assert.match(repo, /data\.length === 0\) throw new Error\("You don't have permission to edit this store\."\)/);
});

test('both detail screens offer Edit details only to those who can manage, and the switches show the server\'s reason', () => {
  const store = code('app/admin/stores/[id].tsx');
  assert.match(store, /\{canManage && \(\s*<Pressable style=\{styles\.editBtn\} onPress=\{\(\) => setEditing\(true\)\}/);
  assert.match(store, /canManage = hasPermission\('stores\.manage'\)/);
  assert.match(store, /validateStoreForm\(\{ name, phone, addressLine, city, opening, closing \}, store\)/);
  assert.match(store, /clockLabel\(store\.opening_time\)/, 'hours read "9:00 AM", not "09:00:00"');
  const rider = code('app/admin/riders/[id].tsx');
  assert.match(rider, /canManage = hasPermission\('riders\.manage'\)/);
  assert.match(rider, /adminRepository\.updateRider\(rider\.id, patch\)/);
  assert.match(rider, /showToast\(e instanceof Error \? e\.message : "Couldn't update the rider\."/);
  assert.match(code('app/admin/riders.tsx'), /showToast\(e instanceof Error \? e\.message : "Couldn't update the rider\."/);
});

test('an edit with no changes closes quietly instead of calling the server', () => {
  for (const screen of ['app/admin/stores/[id].tsx', 'app/admin/riders/[id].tsx']) {
    const s = code(screen);
    assert.match(s, /Object\.keys\(patch\)\.length === 0\) \{\s*showToast\('Nothing was changed\.', 'info'\);\s*onClose\(\);\s*return;/, screen);
  }
});
