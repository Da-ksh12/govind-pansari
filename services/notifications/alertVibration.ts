import { Platform, Vibration } from 'react-native';
import type { NotificationPriority } from '../repositories/notificationRepository';

/**
 * expo-haptics' notificationAsync/impactAsync map to the OS's short
 * system "tap" haptics (tens of milliseconds) — the right feel for a
 * button press, much too weak and brief to notice a phone-in-pocket
 * new order (confirmed by a real user testing on a real device: "the
 * vibration is very low and short"). React Native's own Vibration API
 * drives the vibration motor directly with a real, felt duration —
 * this is what an incoming-call-style alert actually needs.
 */
const PATTERN_URGENT = [0, 400, 200, 400, 200, 400];
const PATTERN_HIGH = [0, 350];
const PATTERN_LIGHT = [0, 60];

function patternForPriority(priority: NotificationPriority): number[] {
  if (priority === 'urgent') return PATTERN_URGENT;
  if (priority === 'high') return PATTERN_HIGH;
  return PATTERN_LIGHT;
}

/** One-shot — used by the light in-app banner for every notification. */
export function vibrateForPriority(priority: NotificationPriority) {
  Vibration.vibrate(patternForPriority(priority));
}

/**
 * Repeats until stopVibration() is called — the "keeps ringing until
 * you respond" pattern for the full-screen new-delivery prompt. iOS
 * ignores custom patterns/repeat for Vibration (Apple's API is just
 * on/off), so this re-triggers a fresh short vibrate on an interval
 * there instead of relying on the (no-op) repeat flag.
 */
export function startUrgentVibration(): () => void {
  if (Platform.OS === 'android') {
    Vibration.vibrate(PATTERN_URGENT, true);
    return () => Vibration.cancel();
  }
  Vibration.vibrate();
  const interval = setInterval(() => Vibration.vibrate(), 1500);
  return () => {
    clearInterval(interval);
    Vibration.cancel();
  };
}
