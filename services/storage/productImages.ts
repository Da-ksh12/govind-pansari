import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabase/client';

const BUCKET = 'product-images';
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export class ImageUploadError extends Error {}

function extensionOf(uri: string, mimeType?: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/jpeg') return 'jpg';
  const fromUri = uri.split('.').pop()?.toLowerCase();
  return fromUri && ALLOWED_EXT.has(fromUri) ? fromUri : 'jpg';
}

/** Opens the native/web picker, returns null if the admin cancelled. Validates size/type before ever touching the network. */
export async function pickProductImage(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new ImageUploadError('Photo library permission was denied.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    base64: true,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  if (asset.fileSize && asset.fileSize > MAX_FILE_BYTES) {
    throw new ImageUploadError('Image is larger than 5MB — please choose a smaller file.');
  }
  const ext = extensionOf(asset.uri, asset.mimeType);
  if (!ALLOWED_EXT.has(ext)) {
    throw new ImageUploadError('Unsupported image type — use JPG, PNG, or WEBP.');
  }
  return asset;
}

/**
 * Uploads one already-picked asset to Supabase Storage and returns its
 * public URL. RLS on storage.objects (product-images bucket) requires
 * products.create/products.edit — an unauthorized upload attempt fails
 * server-side, not just by hiding the picker button.
 */
export async function uploadProductImage(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  if (!asset.base64) throw new ImageUploadError("Couldn't read the selected image.");
  const ext = extensionOf(asset.uri, asset.mimeType);
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  const { error } = await supabase.storage.from(BUCKET).upload(path, decode(asset.base64), { contentType, upsert: false });
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
