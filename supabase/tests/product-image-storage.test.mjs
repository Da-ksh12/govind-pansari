#!/usr/bin/env node
/**
 * The upload path of the product image editor, against real Supabase Storage, with the same call the app makes
 * (services/storage/productImages.uploadProductImage): an admin uploads a small JPEG to the product-images bucket with the same
 * options, it is served from the public URL with the long cache lifetime, and it is deleted afterwards (the same remove call
 * the wizard uses when a photo is replaced or discarded). A customer must not be able to upload. Cleans up after itself.
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... node supabase/tests/product-image-storage.test.mjs
 */
const U = process.env.EXPO_PUBLIC_SUPABASE_URL;
const K = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!U || !K) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.');
  process.exit(1);
}
const base = { apikey: K, 'Content-Type': 'application/json' };
async function login(phone) {
  await fetch(`${U}/auth/v1/otp`, { method: 'POST', headers: base, body: JSON.stringify({ phone }) });
  const s = await (await fetch(`${U}/auth/v1/verify`, { method: 'POST', headers: base, body: JSON.stringify({ type: 'sms', phone, token: '123456' }) })).json();
  if (!s.access_token) throw new Error(`login failed for ${phone}`);
  return s.access_token;
}

// A tiny but valid JPEG (what an edited, cropped result looks like to Storage: JPEG bytes).
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const BUCKET = 'product-images';
const upload = (token, path, body = JPEG, contentType = 'image/jpeg') =>
  fetch(`${U}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: K, Authorization: `Bearer ${token}`, 'Content-Type': contentType, 'cache-control': 'max-age=31536000', 'x-upsert': 'false' },
    body,
  });

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '  ok ' : 'FAIL '} ${name}${ok ? '' : `  ${detail}`}`); ok ? passed++ : failed++; };

const admin = await login('+919000000301');
const customer = await login('+919000001015');
const path = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
let uploaded = false;
try {
  const res = await upload(admin, path);
  uploaded = res.ok;
  check('an admin can upload the edited JPEG', res.ok, `${res.status} ${await res.text().catch(() => '')}`);

  const url = `${U}/storage/v1/object/public/${BUCKET}/${path}`;
  const got = await fetch(url);
  const bytes = Buffer.from(await got.arrayBuffer());
  check('it is served from its public URL as an image', got.status === 200 && /image\/jpeg/.test(got.headers.get('content-type') ?? ''), `${got.status} ${got.headers.get('content-type')}`);
  check('the stored bytes are exactly what was uploaded (no re-encoding in Storage)', bytes.equals(JPEG));
  check('it carries the long cache lifetime (file names are unique and never overwritten)', /max-age=31536000/.test(got.headers.get('cache-control') ?? ''), got.headers.get('cache-control') ?? '(none)');

  const again = await upload(admin, path);
  check('uploading the same name again is refused — a file can never be silently overwritten', !again.ok, `${again.status}`);

  const denied = await upload(customer, `probe-customer-${Date.now()}.jpg`);
  check('a customer cannot upload product images', !denied.ok, `${denied.status}`);
  if (denied.ok) await fetch(`${U}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { apikey: K, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [`probe-customer-${Date.now()}.jpg`] }) });
} finally {
  if (uploaded) {
    // The same call the wizard makes (deleteProductImage -> storage.remove([path])).
    const del = await fetch(`${U}/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { apikey: K, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }) });
    check('the admin can delete it again (replaced / discarded photos leave no file behind)', del.ok, `${del.status}`);
    const list = await fetch(`${U}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: { apikey: K, Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', search: path, limit: 5 }) });
    const files = await list.json().catch(() => []);
    check('the file is gone from the bucket', Array.isArray(files) && !files.some((f) => f.name === path), JSON.stringify(files).slice(0, 120));
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
