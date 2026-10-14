import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabase/client';

const BUCKET = 'delivery-proofs';
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

export class DeliveryProofError extends Error {}

/**
 * Opens the CAMERA (not the photo library) — proof of delivery has to be
 * a live photo taken at the doorstep, the same rule Zepto/Blinkit riders
 * work under, not any image the rider happens to have saved.
 */
export async function captureDeliveryProofPhoto(): Promise<ImagePicker.ImagePickerAsset | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new DeliveryProofError('Camera permission is required to confirm this delivery.');
  }
  const result = await ImagePicker.launchCameraAsync({
    quality: 0.8,
    base64: true,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  if (asset.fileSize && asset.fileSize > MAX_FILE_BYTES) {
    throw new DeliveryProofError('Photo is too large — please retake it.');
  }
  return asset;
}

/**
 * Uploads under `${assignmentId}/...` so storage RLS (delivery_proofs_rider_write
 * in the mandatory-photo-proof migration) can confirm the uploader is
 * actually this delivery's assigned rider. Returns the storage PATH, not
 * a public URL — the bucket is private, so viewers resolve it to a
 * short-lived signed URL on demand via getDeliveryProofPhotoUrl below.
 */
export async function uploadDeliveryProofPhoto(assignmentId: string, asset: ImagePicker.ImagePickerAsset): Promise<string> {
  if (!asset.base64) throw new DeliveryProofError("Couldn't read the captured photo.");
  const path = `${assignmentId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, decode(asset.base64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw new DeliveryProofError(error.message || 'Upload failed. Please try again.');

  return path;
}

/**
 * Bucket is private (RLS: customer, the assigned rider, admin, or store
 * staff of the fulfilling store only) — every viewer resolves a fresh
 * signed URL rather than one baked in at upload time, so a leaked link
 * doesn't stay valid forever.
 */
export async function getDeliveryProofPhotoUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}
