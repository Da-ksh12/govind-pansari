// How far the on-screen keyboard covers the bottom of a screen, so the screen can lift its content by that much. Pure, so tests/unit
// covers it.
//
// Why not KeyboardAvoidingView: the app draws edge-to-edge (android/gradle.properties edgeToEdgeEnabled=true). In that mode Android no
// longer resizes the window for the keyboard (the manifest's adjustResize does nothing), and React Native's own keyboard frame is
// not reliable enough for KeyboardAvoidingView — which is also switched off on Android in this app. So a form low on the screen ended
// up under the keyboard. What React Native does report reliably on Android is the keyboard's HEIGHT, measured above the navigation bar.

/** Where the keyboard's top edge is, in screen coordinates, on Android: the keyboard height is reported above the navigation bar. */
export function androidKeyboardTop(screenHeight: number, keyboardHeight: number, bottomInset: number): number {
  return screenHeight - keyboardHeight - bottomInset;
}

/**
 * How many pixels of the container's bottom the keyboard covers; 0 when it does not reach it. A window that already shrank for
 * the keyboard (some devices still do) has its bottom above the keyboard, which correctly gives 0 — nothing is lifted twice.
 */
export function keyboardOverlap(containerBottom: number, keyboardTop: number): number {
  if (!Number.isFinite(containerBottom) || !Number.isFinite(keyboardTop)) return 0;
  return Math.max(0, Math.round(containerBottom - keyboardTop));
}

/**
 * The bottom padding of a bar pinned to the bottom of a screen: it clears the navigation bar normally, and with the keyboard up
 * (the keyboard already covers the navigation bar) it only needs its own breathing space.
 */
export function actionBarBottomPadding(overlap: number, bottomInset: number, base: number): number {
  return overlap > 0 ? base : Math.max(bottomInset, base);
}
