import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabase/client';
import { checkSourceImage, describePermission, describeUnusableImage, type PermissionOutcome } from '../imagePermissions';

const BUCKET = 'product-images';
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB — the edited result is far below this; it stops a raw file that skipped editing
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);
/** Gallery shots per product. */
export const MAX_GALLERY_IMAGES = 8;

export class ImageUploadError extends Error {}

/** The camera could not be used. `outcome` says whether the admin can retry or must open Settings. */
export class ImagePermissionError extends Error {
  readonly outcome: Exclude<PermissionOutcome, { state: 'granted' }>;
  constructor(outcome: Exclude<PermissionOutcome, { state: 'granted' }>) {
    super(outcome.message);
    this.outcome = outcome;
  }
}

function extensionOf(uri: string, mimeType?: string | null): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/jpeg') return 'jpg';
  const fromUri = uri.split('?')[0]!.split('.').pop()?.toLowerCase();
  return fromUri && ALLOWED_EXT.has(fromUri) ? fromUri : 'jpg';
}

function assertUsable(asset: ImagePicker.ImagePickerAsset): ImagePicker.ImagePickerAsset {
  const problem = checkSourceImage(asset);
  if (problem) throw new ImageUploadError(describeUnusableImage(problem));
  return asset;
}

/**
 * Opens the camera. The permission is asked for only while Android will still show the prompt; once it was refused for good the
 * caller gets an ImagePermissionError with `canOpenSettings` instead of a prompt that never appears. Returns null if the admin
 * backed out of the camera.
 */
export async function capturePhoto(): Promise<ImagePicker.ImagePickerAsset | null> {
  const current = await ImagePicker.getCameraPermissionsAsync();
  let snapshot = { granted: current.granted, canAskAgain: current.canAskAgain };
  if (!snapshot.granted && snapshot.canAskAgain) {
    const asked = await ImagePicker.requestCameraPermissionsAsync();
    snapshot = { granted: asked.granted, canAskAgain: asked.canAskAgain };
  }
  const outcome = describePermission('camera', snapshot);
  if (outcome.state !== 'granted') throw new ImagePermissionError(outcome);

  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, allowsEditing: false });
  if (result.canceled || !result.assets[0]) return null;
  return assertUsable(result.assets[0]);
}

/**
 * Opens the system photo picker (Android's needs no storage permission). `limit` > 1 lets the admin pick several photos for
 * the gallery at once; each one is then edited in turn. Returns [] if they backed out.
 */
export async function pickFromGallery(limit = 1): Promise<ImagePicker.ImagePickerAsset[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9,
    allowsEditing: false,
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit > 1 ? limit : 1,
    orderedSelection: true,
  });
  if (result.canceled || result.assets.length === 0) return [];
  return result.assets.slice(0, limit).map(assertUsable);
}

/**
 * The simple one-step picker (no editor) — still used by the category image upload. Product photos go through
 * capturePhoto / pickFromGallery and the editor instead.
 */
export async function pickProductImage(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new ImageUploadError('Photo library permission was denied.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, base64: true, allowsEditing: false });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  if (asset.fileSize && asset.fileSize > MAX_FILE_BYTES) {
    throw new ImageUploadError('Image is larger than 5MB — please choose a smaller file.');
  }
  if (!ALLOWED_EXT.has(extensionOf(asset.uri, asset.mimeType))) {
    throw new ImageUploadError('Unsupported image type — use JPG, PNG, or WEBP.');
  }
  return asset;
}

/** What an upload needs of a picked or edited image. */
export interface UploadableImage {
  uri: string;
  base64?: string | null;
  mimeType?: string | null;
}

/**
 * Uploads one finished image to Supabase Storage and returns its public URL. RLS on storage.objects (product-images bucket)
 * requires products.create/products.edit — an unauthorized upload attempt fails server-side, not just by hiding the button.
 */
export async function uploadProductImage(asset: UploadableImage): Promise<string> {
  if (!asset.base64) throw new ImageUploadError("Couldn't read the selected image.");
  const ext = extensionOf(asset.uri, asset.mimeType);
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const bytes = decode(asset.base64);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new ImageUploadError('Image is larger than 5MB — please choose a smaller file.');

  // File names are unique and never overwritten, so a long cache lifetime is safe — without it the
  // bucket serves "private, no-cache" and every image is revalidated over the network on each view.
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false, cacheControl: '31536000' });
  if (error) throw new ImageUploadError(error.message || 'Upload failed. Please try again.');

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Deletes an uploaded image given its public URL — used when an admin removes/replaces an image before or after publishing, so unused files don't accumulate. */
export async function deleteProductImage(publicUrl: string): Promise<void> {
  const marker = `/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return; // not one of our storage URLs (e.g. a legacy external URL) — nothing to clean up
  const path = publicUrl.slice(idx + marker.length);
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
}
