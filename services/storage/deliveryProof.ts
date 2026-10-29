import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../supabase/client';
import { shrinkProofPhoto, type ProofPhoto } from './imageProcessing';
import { PENDING_PROOF_KEY, PROOF_MAX_BYTES, base64ByteLength, parsePendingProof, serializePendingProof } from '../proofPhoto';

const BUCKET = 'delivery-proofs';

export type { ProofPhoto };

export class DeliveryProofError extends Error {}

/**
 * Opens the CAMERA (not the photo library) — proof of delivery has to be
 * a live photo taken at the doorstep, the same rule Zepto/Blinkit riders
 * work under, not any image the rider happens to have saved.
 *
 * The picker is asked for the camera's untouched file (quality 1, no base64): any other setting makes the phone decode the whole
 * full-size photo and encode it again — twice more for base64 — which can kill the app on a low-memory phone. The photo is then
 * shrunk once (shrinkProofPhoto). `onProcessing` fires when the camera has handed the photo back and the shrinking starts.
 *
 * While the camera is open Android may kill this app. A marker is kept from here until the photo is ready, so the restarted app
 * knows to come back to this delivery and ask for the lost result (recoverInterruptedProofPhoto).
 */
export async function captureDeliveryProofPhoto(assignmentId: string, onProcessing?: () => void): Promise<ProofPhoto | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new DeliveryProofError('Camera permission is required to confirm this delivery.');
  }
  await rememberCapture(assignmentId);
  try {
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, base64: false, exif: false, allowsEditing: false });
    if (result.canceled || !result.assets[0]) return null;
    onProcessing?.();
    return await shrink(result.assets[0].uri);
  } finally {
    await forgetCapture();
  }
}

async function shrink(uri: string): Promise<ProofPhoto> {
  try {
    return await shrinkProofPhoto(uri);
  } catch (e) {
    throw new DeliveryProofError(e instanceof Error ? e.message : "We couldn't prepare that photo. Please take it again.");
  }
}

export type RecoveredProof = { status: 'none' } | { status: 'recovered'; photo: ProofPhoto } | { status: 'lost' };

const RECOVERY_ATTEMPTS = 3;
const RECOVERY_RETRY_MS = 1200;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * After Android killed the app while the camera was open: asks the picker for the photo it could not deliver. Only looks when a
 * recent marker names this delivery. The picker hands the result over once the restarted activity is up, a moment after the app
 * itself, hence the few short retries.
 *  - none: no interrupted capture for this delivery;
 *  - recovered: the photo, shrunk and ready;
 *  - lost: a capture was interrupted but no photo came back (the rider should simply take it again).
 */
export async function recoverInterruptedProofPhoto(assignmentId: string): Promise<RecoveredProof> {
  const pending = await readCapture();
  if (!pending || pending.assignmentId !== assignmentId) return { status: 'none' };
  try {
    for (let attempt = 0; attempt < RECOVERY_ATTEMPTS; attempt++) {
      const result = await ImagePicker.getPendingResultAsync();
      const asset = result && 'assets' in result && !result.canceled ? result.assets[0] : undefined;
      if (asset) return { status: 'recovered', photo: await shrink(asset.uri) };
      if (attempt < RECOVERY_ATTEMPTS - 1) await sleep(RECOVERY_RETRY_MS);
    }
    return { status: 'lost' };
  } catch {
    return { status: 'lost' };
  } finally {
    await forgetCapture();
  }
}

/** The delivery whose proof photo was being taken when the app was last killed, if that was recent. */
export async function interruptedProofAssignmentId(): Promise<string | null> {
  const pending = await readCapture();
  if (!pending) await forgetCapture(); // a stale or garbled marker is dropped, not kept for next time
  return pending?.assignmentId ?? null;
}

async function rememberCapture(assignmentId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_PROOF_KEY, serializePendingProof(assignmentId, Date.now()));
  } catch {
    // the marker only helps recovery; taking the photo must not depend on it
  }
}

async function readCapture() {
  try {
    return parsePendingProof(await AsyncStorage.getItem(PENDING_PROOF_KEY), Date.now());
  } catch {
    return null;
  }
}

async function forgetCapture(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PENDING_PROOF_KEY);
  } catch {
    // nothing to do: an old marker expires on its own
  }
}

/**
 * Uploads under `${assignmentId}/...` so storage RLS (delivery_proofs_rider_write
 * in the mandatory-photo-proof migration) can confirm the uploader is
 * actually this delivery's assigned rider. Returns the storage PATH, not
 * a public URL — the bucket is private, so viewers resolve it to a
 * short-lived signed URL on demand via getDeliveryProofPhotoUrl below.
 */
export async function uploadDeliveryProofPhoto(assignmentId: string, photo: ProofPhoto): Promise<string> {
  if (!photo.base64) throw new DeliveryProofError("Couldn't read the captured photo.");
  if (base64ByteLength(photo.base64) > PROOF_MAX_BYTES) throw new DeliveryProofError('Photo is too large — please retake it.');
  const path = `${assignmentId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, decode(photo.base64), { contentType: 'image/jpeg', upsert: false });
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
