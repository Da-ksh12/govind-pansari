// Two screens that looked broken on a phone: the admin Deliveries cards (order number wrapped one fragment per line, rider name
// running into the price) and the rider's "Confirm Pickup" box hidden under the keyboard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { actionBarBottomPadding, androidKeyboardTop, keyboardOverlap } from '../../services/keyboardOverlap.ts';

const file = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const source = (p) => readFileSync(file(p), 'utf8');
const code = (p) => source(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

// ---- keyboard maths --------------------------------------------------------------------------------------------------------

test('the keyboard top on Android is the screen height minus the keyboard and the navigation bar under it', () => {
  // 2400 px tall screen, 48 px navigation bar, keyboard 900 px above it
  assert.equal(androidKeyboardTop(2400, 900, 48), 1452);
});

test('a container whose bottom is under the keyboard is lifted by exactly the covered amount', () => {
  const top = androidKeyboardTop(2400, 900, 48); // 1452
  assert.equal(keyboardOverlap(2400, top), 948, 'a full-screen container: keyboard + navigation bar');
  assert.equal(keyboardOverlap(1800, top), 348);
});

test('no lift when the keyboard does not reach the container, or the window already shrank for it', () => {
  const top = androidKeyboardTop(2400, 900, 48);
  assert.equal(keyboardOverlap(1452, top), 0, 'bottom exactly at the keyboard top');
  assert.equal(keyboardOverlap(1000, top), 0);
  assert.equal(keyboardOverlap(1452, top), 0, 'a window resized by the system is not lifted a second time');
});

test('nonsense measurements give no lift instead of a broken layout', () => {
  assert.equal(keyboardOverlap(Number.NaN, 1000), 0);
  assert.equal(keyboardOverlap(2000, Number.NaN), 0);
  assert.equal(keyboardOverlap(Number.POSITIVE_INFINITY, 1000), 0);
});

test('the bottom bar clears the navigation bar normally, and only needs its own spacing once the keyboard covers that bar', () => {
  assert.equal(actionBarBottomPadding(0, 24, 16), 24);
  assert.equal(actionBarBottomPadding(0, 0, 16), 16);
  assert.equal(actionBarBottomPadding(500, 24, 16), 16);
});

// ---- rider screen wiring ---------------------------------------------------------------------------------------------------

test('the rider delivery screen lifts its whole content (including the bottom bar) above the keyboard', () => {
  const s = code('app/rider/delivery/[id].tsx');
  assert.match(s, /const keyboard = useKeyboardOverlap\(\)/);
  assert.match(s, /<View ref=\{keyboard\.ref\} onLayout=\{keyboard\.onLayout\} collapsable=\{false\} style=\{\{ flex: 1, paddingBottom: keyboard\.overlap \}\}>/);
  assert.match(s, /actionBarBottomPadding\(keyboard\.overlap, insets\.bottom, spacing\.base\)/);
  assert.doesNotMatch(s, /KeyboardAvoidingView/, 'the version that does nothing on Android is gone');
  // the hook is called before any early return (rules of hooks)
  assert.ok(s.indexOf('useKeyboardOverlap()') < s.indexOf('if (loading && !delivery)'));
});

test('the order-number box scrolls into view when focused, and Done on the keyboard confirms', () => {
  const s = code('app/rider/delivery/[id].tsx');
  assert.match(s, /scrollRef\.current\?\.scrollTo\(\{ y: Math\.max\(0, confirmCardY\.current - spacing\.md\)/);
  assert.match(s, /onFocus=\{\(\) => setOrderInputFocused\(true\)\}/);
  assert.match(s, /onBlur=\{\(\) => setOrderInputFocused\(false\)\}/);
  assert.match(s, /returnKeyType="done"/);
  assert.match(s, /if \(orderNumberInput\.trim\(\) && !busy\) handleConfirmPickup\(\)/);
  assert.match(s, /keyboardShouldPersistTaps="handled"/);
  assert.match(s, /confirmCardY\.current = e\.nativeEvent\.layout\.y/);
});

test('the keyboard hook measures the screen, uses Android\'s height above the navigation bar, and cleans up its listeners', () => {
  const h = code('hooks/useKeyboardOverlap.ts');
  assert.match(h, /measureInWindow/);
  assert.match(h, /androidKeyboardTop\(Dimensions\.get\('screen'\)\.height, height, insets\.bottom\)/);
  assert.match(h, /keyboardDidShow/);
  assert.match(h, /subscriptions\.forEach\(\(subscription\) => subscription\.remove\(\)\)/);
  assert.match(h, /keyboardOverlap\(y \+ height, current\.top\)/);
});

// ---- admin deliveries cards -----------------------------------------------------------------------------------------------

test('on a phone each delivery is a two-line card; the one-row layout is kept for wide screens', () => {
  const s = code('app/admin/deliveries.tsx');
  assert.match(s, /renderItem=\{\(\{ item \}\) => <DeliveryCard item=\{item\} narrow=\{narrow\} \/>\}/);
  assert.match(s, /renderItem=\{\(\{ item \}\) => <NeedsRiderCard item=\{item\} narrow=\{narrow\} onAssign=/);
  const card = s.slice(s.indexOf('function DeliveryCard'), s.indexOf('function NeedsRiderCard'));
  assert.match(card, /if \(narrow\) \{[\s\S]*styles\.cardTop[\s\S]*styles\.cardBottom[\s\S]*\}\s*return \(\s*<Pressable style=\{\[styles\.row/);
  // the two lines: order + status above, rider + amount + age below
  const narrowBranch = card.slice(card.indexOf('if (narrow)'), card.indexOf('return (\n    <Pressable style={[styles.row'));
  assert.ok(narrowBranch.indexOf('{orderBlock}') < narrowBranch.indexOf('styles.cardBottom'));
  assert.ok(narrowBranch.indexOf('StatusBadge') < narrowBranch.indexOf('styles.cardBottom'));
  assert.ok(narrowBranch.indexOf('{rider}') > narrowBranch.indexOf('styles.cardBottom'));
});

test('the order number never wraps, and text next to it is allowed to shrink instead of pushing it out', () => {
  const s = code('app/admin/deliveries.tsx');
  assert.equal((s.match(/style=\{styles\.orderNumber\} numberOfLines=\{1\}/g) ?? []).length, 2, 'both card types keep #GP… on one line');
  assert.match(s, /orderBlock: \{ flex: 1\.1, minWidth: 0 \}/);
  assert.match(s, /riderCell: \{ flex: 1, minWidth: 0,/);
  assert.match(s, /riderName: \{ flexShrink: 1, marginTop: 0 \}/);
  assert.match(s, /noShrink: \{ flexShrink: 0 \}/, 'the status pill keeps its size');
});

test('the narrow layout is chosen by the same width rule the map view already used', () => {
  const s = code('app/admin/deliveries.tsx');
  assert.match(s, /const narrow = width < 700;/);
});
