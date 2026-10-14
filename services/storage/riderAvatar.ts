import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabase/client';

const BUCKET = 'avatars';
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB, matches the bucket's own server-side limit
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export class AvatarUploadError extends Error {}

function extensionOf(uri: string, mimeType?: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/jpeg') return 'jpg';
  const fromUri = uri.split('.').pop()?.toLowerCase();
  return fromUri && ALLOWED_EXT.has(fromUri) ? fromUri : 'jpg';
}

/** Same picker contract as pickProductImage — null means the admin cancelled, never a caught error. */
export async function pickRiderAvatar(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new AvatarUploadError('Photo library permission was denied.');
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.85,
    base64: true,
    allowsEditing: true,
    aspect: [1, 1],
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  if (asset.fileSize && asset.fileSize > MAX_FILE_BYTES) {
    throw new AvatarUploadError('Image is larger than 5MB — please choose a smaller file.');
  }
  const ext = extensionOf(asset.uri, asset.mimeType);
  if (!ALLOWED_EXT.has(ext)) {
    throw new AvatarUploadError('Unsupported image type — use JPG, PNG, or WEBP.');
  }
  return asset;
}

/** Uploads to the public `avatars` bucket, scoped under the rider's own id so re-uploads don't collide with another rider's file. RLS (riders.manage/users.manage/is_admin) enforces who may actually write here, server-side. */
export async function uploadRiderAvatar(riderId: string, asset: ImagePicker.ImagePickerAsset): Promise<string> {
  if (!asset.base64) throw new AvatarUploadError("Couldn't read the selected image.");
  const ext = extensionOf(asset.uri, asset.mimeType);
  const path = `${riderId}/${Date.now()}.${ext}`;
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  const { error } = await supabase.storage.from(BUCKET).upload(path, decode(asset.base64), { contentType, upsert: false });
  if (error) throw new AvatarUploadError(error.message || 'Upload failed. Please try again.');

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Best-effort cleanup of a replaced/removed photo — mirrors deleteProductImage's "not one of ours, nothing to do" tolerance for legacy/external URLs. */
export async function deleteRiderAvatar(publicUrl: string): Promise<void> {
  const marker = `/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;
  const path = publicUrl.slice(idx + marker.length);
  await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
}
