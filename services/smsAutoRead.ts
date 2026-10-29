import { cancelReadCodeMessage, isSmsUserConsentAvailable, readCodeMessage } from '../modules/sms-user-consent';
import { extractOtp } from './otpExtract';

/** True on an Android build that contains the SMS User Consent module. */
export const smsAutoReadAvailable = isSmsUserConsentAvailable;

/**
 * Waits for the sign-in SMS and hands over the code in it. Google shows its own one-tap "allow this app to read this message?" screen
 * first; if the user declines, or no message arrives within five minutes, nothing is called and the boxes just stay for typing.
 * Returns a function that stops listening — call it when the screen closes, so the consent screen cannot appear over anything else.
 */
export function listenForSmsCode(onCode: (code: string) => void, length: number): () => void {
  if (!smsAutoReadAvailable) return () => {};
  let stopped = false;
  readCodeMessage()
    .then((message) => {
      if (stopped || !message) return;
      const code = extractOtp(message, length);
      if (code) onCode(code);
    })
    .catch(() => {
      // no Play services / not allowed: typing and the keyboard suggestion remain
    });
  return () => {
    stopped = true;
    cancelReadCodeMessage();
  };
}
