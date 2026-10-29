// Geometry of the product image editor: where the crop frame sits over the photo, how far it may be dragged and zoomed,
// and which pixels of the (rotated) photo end up in the result. No React Native / native imports, so tests/unit covers it.
//
// Terms: the photo is first rotated in quarter turns ("rotated space", size rw x rh). The crop FRAME (fw x fh, on screen) is
// fixed; the photo is scaled so that it always COVERS the frame (scale = coverScale * zoom) and can be panned. `pan` is where
// the photo's centre sits relative to the frame's centre, in screen pixels.
//
// The clamp helpers carry a 'worklet' directive so the editor can call them from gesture callbacks on the UI thread; in plain
// Node the directive is just an unused string.

export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export type AspectKey = '1:1' | '4:5' | '4:3' | '16:9';
export const ASPECTS: { key: AspectKey; label: string; ratio: number }[] = [
  { key: '1:1', label: '1:1', ratio: 1 },
  { key: '4:5', label: '4:5', ratio: 4 / 5 },
  { key: '4:3', label: '4:3', ratio: 4 / 3 },
  { key: '16:9', label: '16:9', ratio: 16 / 9 },
];
export const DEFAULT_ASPECT: AspectKey = '1:1';
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
/** The longest edge of the saved result (product photos never need more; keeps uploads small). */
export const OUTPUT_MAX_EDGE = 1600;
/** The photo is shrunk to this before editing so a 12 MP camera shot edits as smoothly as a small one. */
export const EDIT_MAX_EDGE = 2400;

export const aspectRatio = (key: AspectKey): number => ASPECTS.find((a) => a.key === key)?.ratio ?? 1;

export const normalizeQuarterTurns = (turns: number): number => ((Math.round(turns) % 4) + 4) % 4;

/** The photo's size after `turns` quarter turns. */
export function rotatedSize(size: Size, turns: number): Size {
  return normalizeQuarterTurns(turns) % 2 === 1 ? { width: size.height, height: size.width } : { ...size };
}

/** The largest frame with the given width/height ratio that fits inside `available`. */
export function fitFrame(available: Size, ratio: number): Size {
  if (available.width <= 0 || available.height <= 0 || !(ratio > 0)) return { width: 0, height: 0 };
  const byWidth = { width: available.width, height: available.width / ratio };
  return byWidth.height <= available.height ? byWidth : { width: available.height * ratio, height: available.height };
}

/** The scale at which the photo exactly covers the frame (zoom 1). */
export function coverScale(rotated: Size, frame: Size): number {
  'worklet';
  if (rotated.width <= 0 || rotated.height <= 0) return 1;
  return Math.max(frame.width / rotated.width, frame.height / rotated.height);
}

export function clamp(value: number, low: number, high: number): number {
  'worklet';
  return Math.min(Math.max(value, low), high);
}

/** How far the photo may be dragged from centre in each direction before the frame would show empty space. */
export function maxPan(rotated: Size, frame: Size, zoom: number): Point {
  'worklet';
  const scale = coverScale(rotated, frame) * zoom;
  return {
    x: Math.max(0, (rotated.width * scale - frame.width) / 2),
    y: Math.max(0, (rotated.height * scale - frame.height) / 2),
  };
}

export function clampPan(pan: Point, rotated: Size, frame: Size, zoom: number): Point {
  'worklet';
  const limit = maxPan(rotated, frame, zoom);
  return { x: clamp(pan.x, -limit.x, limit.x), y: clamp(pan.y, -limit.y, limit.y) };
}

/** The pixels of the rotated photo that sit inside the frame — whole numbers, always inside the photo. */
export function cropRect(rotated: Size, frame: Size, zoom: number, pan: Point): CropRect {
  const scale = coverScale(rotated, frame) * clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  const safePan = clampPan(pan, rotated, frame, zoom);
  const width = Math.max(1, Math.min(rotated.width, Math.round(frame.width / scale)));
  const height = Math.max(1, Math.min(rotated.height, Math.round(frame.height / scale)));
  const centreX = rotated.width / 2 - safePan.x / scale;
  const centreY = rotated.height / 2 - safePan.y / scale;
  return {
    originX: clamp(Math.round(centreX - width / 2), 0, rotated.width - width),
    originY: clamp(Math.round(centreY - height / 2), 0, rotated.height - height),
    width,
    height,
  };
}

/** The saved size: the crop, scaled DOWN (never up) so its longest edge is at most `maxEdge`. */
export function outputSize(crop: { width: number; height: number }, maxEdge: number = OUTPUT_MAX_EDGE): Size {
  const longest = Math.max(crop.width, crop.height);
  if (longest <= maxEdge) return { width: crop.width, height: crop.height };
  const factor = maxEdge / longest;
  return { width: Math.max(1, Math.round(crop.width * factor)), height: Math.max(1, Math.round(crop.height * factor)) };
}

/** True when the editor view differs from where it started (drives whether Reset does anything). */
export function isEdited(state: { zoom: number; pan: Point; turns: number; aspect: AspectKey }): boolean {
  return state.zoom !== MIN_ZOOM || state.pan.x !== 0 || state.pan.y !== 0 || normalizeQuarterTurns(state.turns) !== 0 || state.aspect !== DEFAULT_ASPECT;
}
