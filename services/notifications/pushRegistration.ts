import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { notificationRepository } from '../repositories/notificationRepository';

let cachedToken: string | null = null;

/**
 * Foreground behavior (section 36): never show a system alert while the
 * app is open — the Realtime-driven in-app banner (notificationsStore +
 * InAppNotificationBanner) already covers that case, near-instantly and
 * without waiting on the push round-trip. Background/killed-app taps
 * are the only case a native notification needs to actually present
 * anything, and the OS handles that itself once delivered.
 */
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    }).catch(() => {});

    // A background push for a new order/delivery assignment landing
    // in the 'default' channel at DEFAULT importance can render
    // silently with no vibration — easy to miss entirely, exactly
    // the "driver never noticed the order" failure mode real
    // gig-delivery apps design hard against. HIGH importance +
    // an explicit, distinct vibration pattern makes it a real
    // heads-up alert. send-push-notifications routes urgent/high
    // priority sends here (see that function).
    Notifications.setNotificationChannelAsync('urgent', {
      name: 'New orders & deliveries',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 300, 150, 300, 150, 300],
      sound: 'default',
      lightColor: '#6E1423',
    }).catch(() => {});

    // A rider's "New Delivery" alert is the single most time-critical
    // notification in the app — missing one directly delays a real
    // customer's order. It gets its own channel, separate from the
    // generic 'urgent' one above (shared by new-order-to-store-staff,
    // admin alerts, etc.), so it's never dulled by unrelated high-
    // priority traffic: a bundled custom sound (assets/sounds/
    // rider_delivery_alert.wav, via the expo-notifications config
    // plugin — see app.json; Android raw-resource names can't contain
    // hyphens, hence the underscore filename), a distinct short-short-long vibration
    // pattern, and PUBLIC lock-screen visibility (safe here because
    // the notification body never contains customer name/address/
    // phone — see notify_on_delivery_event() — only the order number,
    // item count and amount). send-push-notifications routes
    // delivery_assigned/_reminder/_reassigned/_exception here.
    //
    // Note: Android notification channels are immutable once created
    // on a given device except for a few user-facing settings — if
    // this channel was already created with different settings on a
    // test device (e.g. while this was being built), the OS keeps the
    // old settings; reinstalling the app (not just re-running it) is
    // the only reliable way to pick up a changed channel definition
    // during development.
    Notifications.setNotificationChannelAsync('rider-delivery-alerts', {
      name: 'New Deliveries',
      description: "Urgent alerts when a delivery is assigned to you — Govind Pansari's most important rider notification.",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 120, 250, 120, 600],
      sound: 'rider_delivery_alert.wav',
      lightColor: '#6E1423',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: false,
    }).catch(() => {});
  }
}

/**
 * Requests permission (if not already determined) and registers this
 * device's Expo push token. Called once per sign-in (authStore) —
 * never blocks it: every failure here (permission denied, no EAS
 * project configured, simulator with no push capability, offline) is
 * swallowed by the caller.
 */
export async function registerForPushNotifications(): Promise<void> {
  // Push tokens don't exist on simulators/emulators — Device.isDevice
  // is false there, and requesting would just fail.
  if (!Device.isDevice) return;

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.granted;
  }
  if (!granted) return;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) return; // not configured — see docs/push-notifications.md

  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  cachedToken = token;

  await notificationRepository.registerDevice(
    token,
    Platform.OS === 'ios' ? 'ios' : 'android',
    Constants.expoConfig?.version,
    Constants.sessionId ?? undefined,
  );
}

/** Called from authStore.logout() while the session is still valid — deactivates only this device's own token (section 55/56). */
export async function deactivateCurrentDeviceToken(): Promise<void> {
  if (!cachedToken) return;
  await notificationRepository.deactivateDevice(cachedToken);
  cachedToken = null;
}
