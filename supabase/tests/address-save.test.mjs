#!/usr/bin/env node
/**
 * "Does saving an address actually work against the real database?" — the app's exact save sequence (try the structured columns;
 * if the database does not have them yet, fall back to the long-standing ones, services/addressPersistence.ts), run as a signed-in
 * QA customer through RLS. Works whether or not migration 20260828000001 has been applied; both outcomes must save correctly.
 * It creates ONE address for the QA customer and deletes it again.
 *
 *   node --env-file=.env --no-warnings --import ./tests/unit/register-ts-resolver.mjs supabase/tests/address-save.test.mjs
 */
import { createStructuredColumnMemory, isMissingColumnError, withoutStructuredColumns } from '../../services/addressPersistence.ts';

const U = process.env.EXPO_PUBLIC_SUPABASE_URL;
const K = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!U || !K) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const base = { apikey: K, 'Content-Type': 'application/json' };
const phone = '+919000001015';
await fetch(`${U}/auth/v1/otp`, { method: 'POST', headers: base, body: JSON.stringify({ phone }) });
const session = await (await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: base, body: JSON.stringify({ type: 'sms', phone, token: '123456' }) })).json();
if (!session.access_token) throw new Error('QA customer login failed');
const headers = { ...base, Authorization: `Bearer ${session.access_token}`, Prefer: 'return=representation' };

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`);
  ok ? passed++ : failed++;
};

const send = async (method, path, body) => {
  const res = await fetch(`${U}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: Array.isArray(json) ? json[0] : json, error: res.ok ? null : json };
};

// The app's insert: structured first, legacy on a missing-column error (addressRepository.create).
const memory = createStructuredColumnMemory();
const row = {
  user_id: session.user.id, label: 'other', recipient_name: 'Save Probe', phone: '9000000000',
  address_line_1: '12-B, Sharma Apartments, 2nd floor, Rajpur Road', address_line_2: 'Vijay Nagar', landmark: 'Opposite the temple',
  city: 'Agra', state: 'Uttar Pradesh', postal_code: '282002', latitude: 27.203721, longitude: 78.021908,
  house_no: '12-B', building: 'Sharma Apartments', floor: '2nd', street: 'Rajpur Road', locality: 'Vijay Nagar',
  formatted_address: 'Rajpur Rd, Vijay Nagar, Agra', place_id: null, delivery_instructions: 'Call when you reach the gate', geocode_source: 'manual',
};

let id = null;
try {
  let usedStructured = false;
  let result = null;
  if (memory.shouldTryStructured()) {
    const attempt = await send('POST', 'addresses?select=*', row);
    if (attempt.ok) {
      result = attempt;
      usedStructured = true;
    } else if (isMissingColumnError(attempt.error)) {
      memory.markMissing();
    } else {
      result = attempt;
    }
  }
  if (!result) result = await send('POST', 'addresses?select=*', withoutStructuredColumns(row));
  id = result.data?.id ?? null;

  console.log(`database has the structured columns: ${usedStructured ? 'YES (migration applied)' : 'NO (fallback used)'}\n`);
  check('the address is saved', result.ok && !!id, `${result.status} ${JSON.stringify(result.error)}`);

  const saved = (await send('GET', `addresses?id=eq.${id}&select=*`)).data ?? {};
  check('the readable address lines are stored exactly', saved.address_line_1 === row.address_line_1 && saved.city === 'Agra' && saved.postal_code === '282002' && saved.landmark === 'Opposite the temple');
  check('the pin is stored exactly', saved.latitude === 27.203721 && saved.longitude === 78.021908);
  if (usedStructured) {
    check('every structured field is stored', saved.house_no === '12-B' && saved.building === 'Sharma Apartments' && saved.floor === '2nd' && saved.street === 'Rajpur Road' && saved.delivery_instructions === 'Call when you reach the gate');
  } else {
    check('the delivery instructions are not lost — they are inside address_line_2', saved.address_line_2 === 'Vijay Nagar — Note: Call when you reach the gate', saved.address_line_2);
  }

  // The app's update path (addressRepository.update) with a structured field in the patch.
  const patch = { landmark: 'Near the post office', delivery_instructions: 'Leave with the guard' };
  let updated = await send('PATCH', `addresses?id=eq.${id}&select=*`, patch);
  if (!updated.ok && isMissingColumnError(updated.error)) updated = await send('PATCH', `addresses?id=eq.${id}&select=*`, withoutStructuredColumns(patch));
  check('an edit saves too', updated.ok && updated.data?.landmark === 'Near the post office', `${updated.status} ${JSON.stringify(updated.error)}`);
} finally {
  if (id) {
    const del = await send('DELETE', `addresses?id=eq.${id}`);
    check('the probe address was removed again', del.ok);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
