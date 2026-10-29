// The crop geometry behind the product image editor, and the camera / gallery permission wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASPECTS,
  EDIT_MAX_EDGE,
  MAX_ZOOM,
  OUTPUT_MAX_EDGE,
  aspectRatio,
  clampPan,
  coverScale,
  cropRect,
  fitFrame,
  isEdited,
  maxPan,
  normalizeQuarterTurns,
  outputSize,
  rotatedSize,
} from '../../services/imageEditing.ts';
import { MAX_SOURCE_BYTES, checkSourceImage, describePermission, describeUnusableImage } from '../../services/imagePermissions.ts';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('aspect ratios: the presets are real width/height ratios', () => {
  assert.deepEqual(ASPECTS.map((a) => a.key), ['1:1', '4:5', '4:3', '16:9']);
  near(aspectRatio('1:1'), 1);
  near(aspectRatio('4:5'), 0.8);
  near(aspectRatio('16:9'), 16 / 9);
});

test('quarter turns swap the photo\'s width and height, and wrap around', () => {
  assert.deepEqual(rotatedSize({ width: 4000, height: 3000 }, 0), { width: 4000, height: 3000 });
  assert.deepEqual(rotatedSize({ width: 4000, height: 3000 }, 1), { width: 3000, height: 4000 });
  assert.deepEqual(rotatedSize({ width: 4000, height: 3000 }, 2), { width: 4000, height: 3000 });
  assert.deepEqual(rotatedSize({ width: 4000, height: 3000 }, 3), { width: 3000, height: 4000 });
  assert.equal(normalizeQuarterTurns(-1), 3);
  assert.equal(normalizeQuarterTurns(5), 1);
  assert.equal(normalizeQuarterTurns(8), 0);
});

test('the crop frame is the largest one of the chosen ratio that fits the screen', () => {
  assert.deepEqual(fitFrame({ width: 300, height: 500 }, 1), { width: 300, height: 300 });
  const wide = fitFrame({ width: 300, height: 500 }, 16 / 9);
  near(wide.width, 300);
  near(wide.height, 168.75);
  const tall = fitFrame({ width: 400, height: 300 }, 4 / 5);
  near(tall.height, 300);
  near(tall.width, 240);
  assert.deepEqual(fitFrame({ width: 0, height: 100 }, 1), { width: 0, height: 0 });
});

test('with no zoom the photo exactly covers the frame and the crop is its centre', () => {
  const photo = { width: 4000, height: 3000 };
  const frame = { width: 300, height: 300 };
  near(coverScale(photo, frame), 0.1);
  assert.deepEqual(cropRect(photo, frame, 1, { x: 0, y: 0 }), { originX: 500, originY: 0, width: 3000, height: 3000 });
});

test('zooming in crops a smaller area around the same centre', () => {
  const photo = { width: 4000, height: 3000 };
  const frame = { width: 300, height: 300 };
  assert.deepEqual(cropRect(photo, frame, 2, { x: 0, y: 0 }), { originX: 1250, originY: 750, width: 1500, height: 1500 });
  // zoom beyond the maximum is held at the maximum
  assert.equal(cropRect(photo, frame, 99, { x: 0, y: 0 }).width, Math.round(3000 / MAX_ZOOM));
});

test('dragging moves the crop the opposite way, and cannot drag past the photo\'s edge', () => {
  const photo = { width: 4000, height: 3000 };
  const frame = { width: 300, height: 300 };
  // limit at zoom 1: (4000*0.1 - 300) / 2 = 50 px each way sideways, none up/down
  assert.deepEqual(maxPan(photo, frame, 1), { x: 50, y: 0 });
  assert.equal(cropRect(photo, frame, 1, { x: 50, y: 0 }).originX, 0);
  assert.equal(cropRect(photo, frame, 1, { x: -50, y: 0 }).originX, 1000);
  assert.deepEqual(cropRect(photo, frame, 1, { x: 9999, y: 9999 }), cropRect(photo, frame, 1, { x: 50, y: 0 }));
  assert.deepEqual(clampPan({ x: -500, y: 20 }, photo, frame, 1), { x: -50, y: 0 });
});

test('a rotated portrait photo is cropped in its rotated pixels', () => {
  const portrait = { width: 3000, height: 4000 };
  const rotated = rotatedSize(portrait, 1); // 4000 x 3000
  assert.deepEqual(cropRect(rotated, { width: 300, height: 300 }, 1, { x: 0, y: 0 }), { originX: 500, originY: 0, width: 3000, height: 3000 });
});

test('the crop never leaves the photo, for any size, ratio, zoom and drag (randomised)', () => {
  let seed = 12345;
  const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  for (let i = 0; i < 3000; i++) {
    const photo = { width: 200 + Math.floor(random() * 4800), height: 200 + Math.floor(random() * 4800) };
    const frame = fitFrame({ width: 200 + random() * 400, height: 200 + random() * 600 }, ASPECTS[Math.floor(random() * 4)].ratio);
    const zoom = 1 + random() * 4;
    const pan = { x: (random() - 0.5) * 2000, y: (random() - 0.5) * 2000 };
    const c = cropRect(photo, frame, zoom, pan);
    assert.ok(Number.isInteger(c.originX) && Number.isInteger(c.originY) && Number.isInteger(c.width) && Number.isInteger(c.height));
    assert.ok(c.width >= 1 && c.height >= 1);
    assert.ok(c.originX >= 0 && c.originY >= 0);
    assert.ok(c.originX + c.width <= photo.width, `x overflow ${JSON.stringify({ photo, c })}`);
    assert.ok(c.originY + c.height <= photo.height, `y overflow ${JSON.stringify({ photo, c })}`);
    // the crop has the frame's shape (within rounding)
    assert.ok(Math.abs(c.width / c.height - frame.width / frame.height) < 0.05 + 2 / Math.min(c.width, c.height));
  }
});

test('the saved size only ever shrinks, keeping the shape', () => {
  assert.deepEqual(outputSize({ width: 3000, height: 3000 }), { width: OUTPUT_MAX_EDGE, height: OUTPUT_MAX_EDGE });
  assert.deepEqual(outputSize({ width: 800, height: 600 }), { width: 800, height: 600 });
  const wide = outputSize({ width: 4000, height: 2250 });
  assert.equal(wide.width, OUTPUT_MAX_EDGE);
  assert.equal(wide.height, 900);
  assert.ok(EDIT_MAX_EDGE > OUTPUT_MAX_EDGE);
});

test('Reset has something to undo only when the view was changed', () => {
  assert.equal(isEdited({ zoom: 1, pan: { x: 0, y: 0 }, turns: 0, aspect: '1:1' }), false);
  assert.equal(isEdited({ zoom: 1.4, pan: { x: 0, y: 0 }, turns: 0, aspect: '1:1' }), true);
  assert.equal(isEdited({ zoom: 1, pan: { x: 0, y: 0 }, turns: 4, aspect: '1:1' }), false, 'four turns is back where it started');
  assert.equal(isEdited({ zoom: 1, pan: { x: 0, y: 0 }, turns: 0, aspect: '4:3' }), true);
});

// ---- permissions ---------------------------------------------------------------------------------------------------

test('camera permission: granted, denied (can retry), blocked (must open Settings) each say what to do', () => {
  assert.deepEqual(describePermission('camera', { granted: true, canAskAgain: true }), { state: 'granted' });
  const denied = describePermission('camera', { granted: false, canAskAgain: true });
  assert.equal(denied.state, 'denied');
  assert.equal(denied.canRetry, true);
  assert.equal(denied.canOpenSettings, false);
  assert.match(denied.message, /Try again/);
  assert.match(denied.message, /gallery/);
  const blocked = describePermission('camera', { granted: false, canAskAgain: false });
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.canRetry, false, 'a prompt that will never appear must not be offered');
  assert.equal(blocked.canOpenSettings, true);
  assert.match(blocked.message, /Settings/);
  assert.match(blocked.message, /Camera/);
});

test('a chosen file that cannot be edited is explained', () => {
  assert.equal(checkSourceImage({ uri: 'file:///a/b.jpg', mimeType: 'image/jpeg', fileSize: 1000 }), null);
  assert.equal(checkSourceImage({ uri: 'file:///a/b.heic', mimeType: 'image/heic' }), null);
  assert.equal(checkSourceImage({ uri: 'file:///a/b.gif', mimeType: 'image/gif' }), 'type');
  assert.equal(checkSourceImage({ uri: 'file:///a/b.pdf' }), 'type');
  assert.equal(checkSourceImage({ uri: 'file:///a/b.jpg', mimeType: 'image/jpeg', fileSize: MAX_SOURCE_BYTES + 1 }), 'size');
  assert.match(describeUnusableImage('type'), /JPG, PNG or WEBP/);
  assert.match(describeUnusableImage('size'), /20 MB/);
  assert.match(describeUnusableImage('unreadable'), /another one/);
});
