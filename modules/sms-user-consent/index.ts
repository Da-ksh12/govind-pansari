import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

interface SmsUserConsentNative {
  /** The text of the SMS the user allowed the app to read, or null (declined / nothing arrived in five minutes / cancelled). */
  readCodeMessageAsync(): Promise<string | null>;
  cancel(): void;
}

// Null on iOS, and in any build that does not contain the Android module (an older APK): callers then simply do not auto-read —
// the keyboard's code suggestion and typing keep working.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<SmsUserConsentNative>('SmsUserConsent') : null;

export const isSmsUserConsentAvailable = native !== null;

export function readCodeMessage(): Promise<string | null> {
  return native ? native.readCodeMessageAsync() : Promise.resolve(null);
}

export function cancelReadCodeMessage(): void {
  try {
    native?.cancel();
  } catch {
    // nothing is listening — nothing to cancel
  }
}
