import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { navigateForNotification } from '../services/notifications/navigateForNotification';
import type { NotificationEventType } from '../services/repositories/notificationRepository';

// Dedupes across the two call sites (app/_layout.tsx, always mounted;
// app/index.tsx, cold-start only) — both see the same cached
// getLastNotificationResponse() value, so without this a cold-start
// notification tap would call router.push twice for the identical
// target. Module-level, not component state, since it must survive
// index.tsx unmounting once the splash redirects away.
let handledResponseId: string | null = null;

/**
 * Section 12/31: a tap on a background/killed-app push notification
 * navigates the same way an in-app tap does — one centralized mapping,
 * not a second copy of the routing logic. Native-only: expo-notifications'
 * underlying emitter module has no web implementation of
 * getLastNotificationResponse (throws UnavailabilityError there), so the
 * web build uses the no-op override in
 * useNotificationResponseNavigation.web.ts instead of calling this hook.
 *
 * Returns true once a pending notification's target has been (or is
 * about to be) navigated to — app/index.tsx's own cold-start redirect
 * checks this so it never overwrites a notification-driven navigation
 * a few seconds into its splash timer (section 47's reported bug: the
 * splash's fixed-delay redirect was racing this hook and always won).
 */
export function useNotificationResponseNavigation(): boolean {
  const lastResponse = Notifications.useLastNotificationResponse();

  const data = lastResponse?.notification.request.content.data as
    | { eventType?: NotificationEventType; orderId?: string; deliveryId?: string }
    | undefined;
  const target = data?.eventType ? navigateForNotification(data.eventType, data as Record<string, string>) : null;
  const responseId = lastResponse?.notification.request.identifier ?? null;
  const pending = !!target && responseId !== null && responseId !== handledResponseId;

  useEffect(() => {
    if (!pending || !responseId || !target) return;
    handledResponseId = responseId;
    router.push(target as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, responseId, target]);

  return pending;
}
