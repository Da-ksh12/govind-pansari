// What to tell an admin when the camera cannot be used, and what they can do about it. Pure (no native imports) so it is tested.

export type MediaSource = 'camera' | 'gallery';

export interface PermissionSnapshot {
  granted: boolean;
  /** False once Android/iOS will no longer show the permission prompt (the person must open Settings). */
  canAskAgain: boolean;
}

export type PermissionOutcome =
  | { state: 'granted' }
  | { state: 'denied'; message: string; canRetry: true; canOpenSettings: false }
  | { state: 'blocked'; message: string; canRetry: false; canOpenSettings: true };

export function describePermission(source: MediaSource, snapshot: PermissionSnapshot): PermissionOutcome {
  if (snapshot.granted) return { state: 'granted' };
  const what = source === 'camera' ? 'Camera' : 'Photo';
  const alternative = source === 'camera' ? 'choose a photo from your gallery instead' : 'take a photo with the camera instead';
  if (snapshot.canAskAgain) {
    return {
      state: 'denied',
      message: `${what} access was not allowed. Tap "Try again" and allow it, or ${alternative}.`,
      canRetry: true,
      canOpenSettings: false,
    };
  }
  return {
    state: 'blocked',
    message: `${what} access is turned off for this app. Open Settings → Permissions → ${source === 'camera' ? 'Camera' : 'Photos'} to allow it, or ${alternative}.`,
    canRetry: false,
    canOpenSettings: true,
  };
}

/** A chosen file the editor cannot work with, as a sentence for the admin. */
export function describeUnusableImage(reason: 'type' | 'size' | 'unreadable'): string {
  switch (reason) {
    case 'type':
      return 'That file is not a supported image. Use a JPG, PNG or WEBP photo.';
    case 'size':
      return 'That photo is too large (over 20 MB). Choose a smaller one.';
    default:
      return "We couldn't read that photo. Try another one, or take a new photo.";
  }
}

/** Raw camera / gallery files are checked before editing (the edited result is what gets uploaded, and it is always small). */
export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

export function checkSourceImage(asset: { uri: string; mimeType?: string | null; fileSize?: number | null }): 'type' | 'size' | null {
  if (asset.mimeType && !SUPPORTED_MIME.has(asset.mimeType.toLowerCase())) return 'type';
  if (!asset.mimeType) {
    const ext = asset.uri.split('?')[0]!.split('.').pop()?.toLowerCase();
    if (ext && !['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext)) return 'type';
  }
  if (asset.fileSize && asset.fileSize > MAX_SOURCE_BYTES) return 'size';
  return null;
}
