/**
 * expo-notifications has no web implementation of getLastNotificationResponse
 * — there is no browser equivalent of tapping a push notification while the
 * app is backgrounded/killed. No-op so app/_layout.tsx's call site stays
 * identical across platforms.
 */
export function useNotificationResponseNavigation(): boolean {
  return false;
}
