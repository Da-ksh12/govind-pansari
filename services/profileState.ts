// Which profile the app should hold after trying to read it again. Pure, so tests/unit covers it.

/**
 * A read that fails does not erase what was already loaded for the SAME user: a routine token refresh that happens to fail on a weak
 * connection used to blank the profile, which the start screen then read as "no name yet". A profile held for a DIFFERENT user is
 * never carried over (that would show one account's details to another).
 */
export function profileAfterRefetch<T extends { id: string }>(fetched: T | null, held: T | null, userId: string): T | null {
  if (fetched) return fetched;
  return held && held.id === userId ? held : null;
}
