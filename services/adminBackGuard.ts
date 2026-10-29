/**
 * Lets a screen with unsaved work (the Add Product wizard) answer the admin header's Back button itself — step back, or ask
 * before throwing a half-entered product away — instead of the header silently leaving the screen. At most one guard is
 * active (the focused screen's); it returns true when it handled the press.
 */
type Guard = () => boolean;

let guard: Guard | null = null;

export function setAdminBackGuard(next: Guard | null): void {
  guard = next;
}

/** True when the focused screen handled Back itself. */
export function handleAdminBack(): boolean {
  return guard ? guard() : false;
}
