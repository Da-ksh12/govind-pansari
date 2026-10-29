import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { EDIT_MAX_EDGE, outputSize, type CropRect } from '../imageEditing';
import { PROOF_JPEG_QUALITY, proofResize } from '../proofPhoto';

/** A photo ready to be edited: upright (camera rotation applied) and no larger than the editor needs. */
export interface WorkingImage {
  uri: string;
  width: number;
  height: number;
}

/** The finished product photo: cropped, rotated, resized, JPEG. `base64` is what gets uploaded. */
export interface EditedImage {
  uri: string;
  width: number;
  height: number;
  base64: string;
  mimeType: 'image/jpeg';
}

/** The rider's delivery-proof photo, shrunk and ready to upload (`base64` is the JPEG). */
export interface ProofPhoto {
  uri: string;
  width: number;
  height: number;
  base64: string;
}

export class ImageProcessingError extends Error {}

/**
 * Re-encodes the picked photo upright and at editing size. The editor then shows exactly the pixels the
 * manipulator will crop (a camera shot's EXIF rotation can otherwise make the two disagree), and a 12-megapixel
 * photo edits as smoothly as a small one.
 */
export async function prepareForEditing(uri: string): Promise<WorkingImage> {
  try {
    const upright = await ImageManipulator.manipulate(uri).renderAsync();
    const longest = Math.max(upright.width, upright.height);
    if (longest <= EDIT_MAX_EDGE) {
      const saved = await upright.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
      return { uri: saved.uri, width: saved.width, height: saved.height };
    }
    const resized = await ImageManipulator.manipulate(upright)
      .resize(upright.width >= upright.height ? { width: EDIT_MAX_EDGE } : { height: EDIT_MAX_EDGE })
      .renderAsync();
    const saved = await resized.saveAsync({ format: SaveFormat.JPEG, compress: 0.95 });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } catch {
    throw new ImageProcessingError("We couldn't open that photo. Try another one, or take a new photo.");
  }
}

/**
 * Shrinks a camera photo for upload as delivery proof: upright, longest edge PROOF_MAX_EDGE, JPEG. The camera's full-size file is
 * decoded once, here, and released as soon as the small copy is written — nothing else in the proof flow ever holds the full photo.
 */
export async function shrinkProofPhoto(uri: string): Promise<ProofPhoto> {
  const refs: { release(): void }[] = [];
  try {
    const upright = await ImageManipulator.manipulate(uri).renderAsync();
    refs.push(upright);
    const resize = proofResize(upright.width, upright.height);
    const target = resize ? await ImageManipulator.manipulate(upright).resize(resize).renderAsync() : upright;
    if (target !== upright) refs.push(target);
    const saved = await target.saveAsync({ format: SaveFormat.JPEG, compress: PROOF_JPEG_QUALITY, base64: true });
    if (!saved.base64) throw new Error('no data');
    return { uri: saved.uri, width: saved.width, height: saved.height, base64: saved.base64 };
  } catch {
    throw new ImageProcessingError("We couldn't prepare that photo. Please take it again.");
  } finally {
    for (const ref of refs) {
      try {
        ref.release();
      } catch {
        // already released — the memory is freed either way
      }
    }
  }
}

/** Applies the editor's choices: rotate (quarter turns), crop (in the rotated photo's pixels), shrink to the output size. */
export async function renderEditedImage(source: WorkingImage, turns: number, crop: CropRect): Promise<EditedImage> {
  try {
    let context = ImageManipulator.manipulate(source.uri);
    if (turns % 4 !== 0) context = context.rotate(turns * 90);
    context = context.crop(crop);
    const out = outputSize(crop);
    if (out.width !== crop.width || out.height !== crop.height) context = context.resize(out);
    const ref = await context.renderAsync();
    const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    if (!saved.base64) throw new Error('no data');
    return { uri: saved.uri, width: saved.width, height: saved.height, base64: saved.base64, mimeType: 'image/jpeg' };
  } catch {
    throw new ImageProcessingError("We couldn't apply your edits. Please try again.");
  }
}
