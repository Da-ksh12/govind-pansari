// The rider's delivery-proof photo: sized so the phone never holds the full camera shot in memory more than once, and recoverable when
// Android kills the app while the camera is open ("app reloads after the photo").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PENDING_PROOF_MAX_AGE_MS,
  PROOF_MAX_EDGE,
  base64ByteLength,
  parsePendingProof,
  proofResize,
  serializePendingProof,
} from '../../services/proofPhoto.ts';

const file = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const source = (p) => readFileSync(file(p), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const NOW = 1_800_000_000_000;

test('a big camera photo is shrunk on its longest edge, in either orientation, and never enlarged', () => {
  assert.deepEqual(proofResize(4000, 3000), { width: PROOF_MAX_EDGE }, 'landscape');
  assert.deepEqual(proofResize(3000, 4000), { height: PROOF_MAX_EDGE }, 'portrait');
  assert.deepEqual(proofResize(8160, 6120), { width: PROOF_MAX_EDGE }, 'a 50 MP shot');
  assert.deepEqual(proofResize(4000, 4000), { width: PROOF_MAX_EDGE }, 'square');
  assert.equal(proofResize(PROOF_MAX_EDGE, 900), null, 'exactly at the limit stays as it is');
  assert.deepEqual(proofResize(PROOF_MAX_EDGE + 1, 900), { width: PROOF_MAX_EDGE });
  assert.equal(proofResize(800, 600), null, 'a small photo is not enlarged');
  assert.equal(proofResize(0, 3000), null);
  assert.equal(proofResize(Number.NaN, 3000), null);
  assert.equal(proofResize(-5, -5), null);
});

test('base64ByteLength matches the bytes the string decodes to', () => {
  for (const size of [0, 1, 2, 3, 4, 5, 6, 7, 100, 1001]) {
    const bytes = Buffer.alloc(size, 7);
    assert.equal(base64ByteLength(bytes.toString('base64')), size, `${size} bytes`);
  }
});

test('the interrupted-capture marker round-trips and says which delivery it was for', () => {
  const raw = serializePendingProof('assignment-1', NOW);
  assert.deepEqual(parsePendingProof(raw, NOW + 5000), { assignmentId: 'assignment-1', startedAt: NOW });
});

test('a marker expires: a late restart does not throw the rider back into an old delivery', () => {
  const raw = serializePendingProof('a', NOW);
  assert.notEqual(parsePendingProof(raw, NOW + PENDING_PROOF_MAX_AGE_MS), null, 'exactly at the limit still counts');
  assert.equal(parsePendingProof(raw, NOW + PENDING_PROOF_MAX_AGE_MS + 1), null);
  assert.equal(parsePendingProof(raw, NOW - 1), null, 'a marker from the future (clock change) is not trusted');
});

test('a missing or damaged marker is simply "nothing pending"', () => {
  for (const raw of [null, undefined, '', 'not json', '{', 'null', '42', '"text"', '[]', '{}', '{"assignmentId":"a"}', '{"startedAt":1800000000000}']) {
    assert.equal(parsePendingProof(raw, NOW), null, String(raw));
  }
  assert.equal(parsePendingProof('{"assignmentId":"","startedAt":1800000000000}', NOW), null, 'empty id');
  assert.equal(parsePendingProof('{"assignmentId":7,"startedAt":1800000000000}', NOW), null, 'id must be text');
  assert.equal(parsePendingProof('{"assignmentId":"a","startedAt":"1800000000000"}', NOW), null, 'time must be a number');
});

// ---- wiring: these are the lines the crash fix depends on --------------------------------------------------------------

test('the camera is asked for the untouched file — no decode/re-encode, no base64 string — and shrunk exactly once afterwards', () => {
  const src = code('services/storage/deliveryProof.ts');
  const launch = /launchCameraAsync\(\{([^}]*)\}\)/.exec(src)?.[1] ?? '';
  assert.match(launch, /quality:\s*1\b/, 'quality 1 makes the picker copy the camera file instead of decoding and compressing it');
  assert.match(launch, /base64:\s*false/);
  assert.doesNotMatch(launch, /base64:\s*true/);
  assert.match(src, /shrinkProofPhoto\(/);
  assert.doesNotMatch(src, /quality:\s*0\./, 'no lossy picker-side compression');
});

test('the marker is written before the camera opens and removed when the photo is ready or the rider backs out', () => {
  const src = code('services/storage/deliveryProof.ts');
  const body = src.slice(src.indexOf('export async function captureDeliveryProofPhoto'), src.indexOf('async function shrink'));
  assert.ok(body.indexOf('rememberCapture(assignmentId)') > 0 && body.indexOf('rememberCapture(assignmentId)') < body.indexOf('launchCameraAsync'));
  assert.match(body, /finally\s*\{\s*await forgetCapture\(\);/);
  assert.ok(body.indexOf('shrink(') > body.indexOf('launchCameraAsync'), 'the marker outlives the shrinking too');
  assert.ok(body.indexOf('onProcessing?.()') > body.indexOf('launchCameraAsync') && body.indexOf('onProcessing?.()') < body.indexOf('shrink('), 'the screen is told the shrinking has begun');
});

test('recovery only asks the picker when a recent marker names this very delivery', () => {
  const src = code('services/storage/deliveryProof.ts');
  const body = src.slice(src.indexOf('export async function recoverInterruptedProofPhoto'), src.indexOf('export async function interruptedProofAssignmentId'));
  const guard = body.indexOf('pending.assignmentId !== assignmentId');
  assert.ok(guard > 0 && guard < body.indexOf('getPendingResultAsync'));
  assert.match(body, /return \{ status: 'none' \}/);
  assert.match(body, /finally\s*\{\s*await forgetCapture\(\);/, 'the marker never lingers after one recovery attempt');
});

test('the shrink step decodes the camera file once and releases it; the upload refuses an oversize result', () => {
  const proc = code('services/storage/imageProcessing.ts');
  const body = proc.slice(proc.indexOf('export async function shrinkProofPhoto'), proc.indexOf('export async function renderEditedImage'));
  assert.match(body, /proofResize\(upright\.width, upright\.height\)/);
  assert.match(body, /compress:\s*PROOF_JPEG_QUALITY,\s*base64:\s*true/);
  assert.match(body, /\.release\(\)/);
  assert.equal((body.match(/manipulate\(uri\)/g) ?? []).length, 1, 'the original file is loaded one time only');
  assert.match(code('services/storage/deliveryProof.ts'), /base64ByteLength\(photo\.base64\) > PROOF_MAX_BYTES/);
});

test('the delivery screen recovers a lost photo on open, and the rider home sends a restarted app back to that delivery', () => {
  const screen = code('app/rider/delivery/[id].tsx');
  assert.match(screen, /recoverInterruptedProofPhoto\(id\)/);
  assert.match(screen, /captureDeliveryProofPhoto\(id, \(\) => setBusy\(true\)\)/);
  assert.doesNotMatch(screen, /ImagePickerAsset/, 'the screen holds the small shrunk photo, not a picker asset');
  const home = code('app/rider/index.tsx');
  assert.match(home, /interruptedProofAssignmentId\(\)/);
  assert.match(home, /router\.push\(`\/rider\/delivery\/\$\{assignmentId\}`/);
});
