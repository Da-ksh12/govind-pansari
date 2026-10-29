import React, { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { ArrowLeft, ArrowRight, Camera, Eye, Images, RefreshCw, Trash2, X } from 'lucide-react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { GPConfirmModal } from '../ui/modals/GPModal';
import { ImageEditorModal } from './ImageEditorModal';
import { ImagePermissionError, ImageUploadError, MAX_GALLERY_IMAGES, capturePhoto, pickFromGallery } from '../../services/storage/productImages';
import type { PermissionOutcome } from '../../services/imagePermissions';
import type { EditedImage } from '../../services/storage/imageProcessing';

type Target = { kind: 'primary' } | { kind: 'gallery-add' } | { kind: 'gallery-replace'; index: number };

interface Props {
  primary: string | null;
  gallery: string[];
  /** An upload / save is running — every control is off so nothing can be doubled up. */
  busy: boolean;
  /** Shown under the primary image when the admin tried to continue without one. */
  primaryError?: string;
  /** Each handler receives the finished (cropped, resized) photo and resolves once the parent has stored it. */
  onPrimaryChosen: (image: EditedImage) => Promise<void>;
  onGalleryAdded: (image: EditedImage) => Promise<void>;
  onGalleryReplaced: (index: number, image: EditedImage) => Promise<void>;
  onGalleryRemoved: (index: number) => Promise<void> | void;
  onGalleryMoved: (index: number, direction: -1 | 1) => Promise<void> | void;
}

/**
 * Product photos: Take Photo or Choose from Gallery, then a crop / zoom / rotate editor before anything is kept. The primary
 * photo can be replaced (a product always keeps one); gallery photos can be previewed, replaced, reordered and removed.
 * Where the finished photo goes (a draft on the device, or Supabase Storage) is the wizard's decision, not this component's.
 */
export function ProductImageField({ primary, gallery, busy, primaryError, onPrimaryChosen, onGalleryAdded, onGalleryReplaced, onGalleryRemoved, onGalleryMoved }: Props) {
  const [sheet, setSheet] = useState<Target | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [permission, setPermission] = useState<Exclude<PermissionOutcome, { state: 'granted' }> | null>(null);
  const [opening, setOpening] = useState(false);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  // Where a camera / picker problem is shown: in the source sheet (gallery) or right under the primary photo buttons.
  const [problemAt, setProblemAt] = useState<'sheet' | 'primary'>('sheet');
  // The photos waiting to be edited, one after another (several can be picked from the gallery at once).
  const [editing, setEditing] = useState<{ target: Target; assets: ImagePickerAsset[]; index: number } | null>(null);
  const running = useRef(false);

  const disabled = busy || saving || opening;
  const closeSheet = () => {
    setSheet(null);
    setPickerError(null);
    setPermission(null);
  };

  const pick = async (source: 'camera' | 'gallery', chosen: Target | null = sheet) => {
    if (!chosen || opening) return;
    setProblemAt(chosen.kind === 'primary' ? 'primary' : 'sheet');
    setPickerError(null);
    setPermission(null);
    setOpening(true);
    try {
      let assets: ImagePickerAsset[];
      if (source === 'camera') {
        const shot = await capturePhoto();
        assets = shot ? [shot] : [];
      } else {
        const room = chosen.kind === 'gallery-add' ? Math.max(1, MAX_GALLERY_IMAGES - gallery.length) : 1;
        assets = await pickFromGallery(room);
      }
      if (assets.length === 0) return; // backed out of the camera / picker
      const target = chosen;
      closeSheet();
      setEditing({ target, assets, index: 0 });
    } catch (e) {
      if (e instanceof ImagePermissionError) setPermission(e.outcome);
      else setPickerError(e instanceof ImageUploadError ? e.message : "We couldn't open that. Please try again.");
    } finally {
      setOpening(false);
    }
  };

  const onEdited = async (image: EditedImage) => {
    if (!editing || running.current) return;
    running.current = true;
    const { target, assets, index } = editing;
    setEditing(null); // the editor closes; the saving overlay shows while the parent stores the photo
    setSaving(true);
    try {
      if (target.kind === 'primary') await onPrimaryChosen(image);
      else if (target.kind === 'gallery-add') await onGalleryAdded(image);
      else await onGalleryReplaced(target.index, image);
    } catch {
      // The parent reports its own failure; stop the queue rather than carry on with a broken state.
      setSaving(false);
      running.current = false;
      return;
    }
    setSaving(false);
    running.current = false;
    if (index + 1 < assets.length) setEditing({ target, assets, index: index + 1 });
  };

  const queueLabel = editing && editing.assets.length > 1 ? `Photo ${editing.index + 1} of ${editing.assets.length}` : undefined;
  const sheetTitle = sheet?.kind === 'primary' ? (primary ? 'Replace primary photo' : 'Add primary photo') : sheet?.kind === 'gallery-replace' ? 'Replace gallery photo' : 'Add gallery photos';

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Primary photo (required)</Text>
      {primary ? (
        <View>
          <Pressable style={styles.primaryBox} onPress={() => setPreview(primary)} accessibilityRole="imagebutton" accessibilityLabel="Preview the primary photo">
            <Image source={{ uri: primary }} style={styles.fill} contentFit="cover" />
          </Pressable>
          <View style={styles.row}>
            <ActionButton icon={Camera} label="Take Photo" onPress={() => pick('camera', { kind: 'primary' })} disabled={disabled} />
            <ActionButton icon={Images} label="Choose from Gallery" onPress={() => pick('gallery', { kind: 'primary' })} disabled={disabled} />
            <ActionButton icon={Eye} label="Preview" onPress={() => setPreview(primary)} disabled={disabled} />
          </View>
          <Text style={styles.hint}>Every product keeps a primary photo — replace it any time. Customers see it first.</Text>
        </View>
      ) : (
        <View style={[styles.emptyBox, !!primaryError && styles.emptyBoxError]}>
          <Camera size={ICON_SIZE.lg} color={colors.primary} strokeWidth={ICON_STROKE} />
          <Text style={styles.emptyTitle}>Add the main product photo</Text>
          <Text style={styles.hint}>A clear, well-lit photo on a plain background works best.</Text>
          <View style={styles.row}>
            <ActionButton icon={Camera} label="Take Photo" onPress={() => pick('camera', { kind: 'primary' })} disabled={disabled} primary />
            <ActionButton icon={Images} label="Choose from Gallery" onPress={() => pick('gallery', { kind: 'primary' })} disabled={disabled} />
          </View>
        </View>
      )}
      {!!primaryError && !primary && <Text style={styles.error}>{primaryError}</Text>}
      {problemAt === 'primary' && <PickProblem permission={permission} message={pickerError} onRetry={() => pick('camera', { kind: 'primary' })} />}

      <Text style={[styles.label, { marginTop: spacing.lg }]}>Gallery <Text style={styles.count}>({gallery.length}/{MAX_GALLERY_IMAGES})</Text></Text>
      <Text style={styles.hint}>Extra angles, packaging and close-ups. The first photo is shown first.</Text>
      <View style={styles.grid}>
        {gallery.map((uri, index) => (
          <Pressable key={uri} style={styles.thumb} onPress={() => setMenuIndex(index)} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Gallery photo ${index + 1}. Open options`}>
            <Image source={{ uri }} style={styles.fill} contentFit="cover" />
            <View style={styles.thumbBadge}>
              <Text style={styles.thumbBadgeText}>{index + 1}</Text>
            </View>
          </Pressable>
        ))}
        {gallery.length < MAX_GALLERY_IMAGES && (
          <Pressable style={[styles.thumb, styles.addThumb]} onPress={() => setSheet({ kind: 'gallery-add' })} disabled={disabled} accessibilityRole="button" accessibilityLabel="Add gallery photos">
            <Images size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.addThumbText}>Add photos</Text>
          </Pressable>
        )}
      </View>

      {(saving || busy) && (
        <View style={styles.savingRow} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.savingText}>Saving your photo…</Text>
        </View>
      )}

      {/* Where should the photo come from? */}
      <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={closeSheet}>
        <Pressable style={styles.overlay} onPress={closeSheet}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{sheetTitle}</Text>
              <Pressable onPress={closeSheet} hitSlop={10} accessibilityLabel="Close">
                <X size={ICON_SIZE.md} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
              </Pressable>
            </View>
            <SourceRow icon={Camera} title="Take Photo" subtitle="Open the camera" onPress={() => pick('camera')} disabled={opening} />
            <SourceRow icon={Images} title="Choose from Gallery" subtitle={sheet?.kind === 'gallery-add' ? 'Pick one or more photos' : 'Pick a photo you already have'} onPress={() => pick('gallery')} disabled={opening} />
            {opening && (
              <View style={styles.savingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.savingText}>Opening…</Text>
              </View>
            )}
            {problemAt === 'sheet' && <PickProblem permission={permission} message={pickerError} onRetry={() => pick('camera')} />}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Options for one gallery photo. */}
      <Modal visible={menuIndex !== null} transparent animationType="fade" onRequestClose={() => setMenuIndex(null)}>
        <Pressable style={styles.overlay} onPress={() => setMenuIndex(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            {menuIndex !== null && gallery[menuIndex] && (
              <>
                <View style={styles.menuHeader}>
                  <Image source={{ uri: gallery[menuIndex] }} style={styles.menuThumb} contentFit="cover" />
                  <Text style={styles.sheetTitle}>Gallery photo {menuIndex + 1}</Text>
                </View>
                <SourceRow icon={Eye} title="Preview" onPress={() => { setPreview(gallery[menuIndex]!); setMenuIndex(null); }} />
                <SourceRow icon={RefreshCw} title="Replace" onPress={() => { const i = menuIndex; setMenuIndex(null); setSheet({ kind: 'gallery-replace', index: i }); }} />
                {menuIndex > 0 && <SourceRow icon={ArrowLeft} title="Move earlier" onPress={async () => { const i = menuIndex; setMenuIndex(null); await onGalleryMoved(i, -1); }} />}
                {menuIndex < gallery.length - 1 && <SourceRow icon={ArrowRight} title="Move later" onPress={async () => { const i = menuIndex; setMenuIndex(null); await onGalleryMoved(i, 1); }} />}
                <SourceRow icon={Trash2} title="Remove" danger onPress={() => { const i = menuIndex; setMenuIndex(null); setConfirmRemove(i); }} />
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Full-size preview. */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.previewOverlay} onPress={() => setPreview(null)} accessibilityLabel="Close preview">
          {!!preview && <Image source={{ uri: preview }} style={styles.previewImage} contentFit="contain" />}
          <View style={styles.previewClose}>
            <X size={ICON_SIZE.md} color={colors.white} strokeWidth={ICON_STROKE} />
          </View>
        </Pressable>
      </Modal>

      <GPConfirmModal
        visible={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        destructive
        title="Remove this photo?"
        message="It will be taken off the product and its file deleted."
        primaryLabel="Remove"
        onPressPrimary={async () => { const i = confirmRemove!; setConfirmRemove(null); await onGalleryRemoved(i); }}
        secondaryLabel="Keep"
        onPressSecondary={() => setConfirmRemove(null)}
      />

      <ImageEditorModal
        visible={!!editing}
        source={editing ? { uri: editing.assets[editing.index]!.uri } : null}
        queueLabel={queueLabel}
        initialAspect="1:1"
        onApply={onEdited}
        onCancel={() => setEditing(null)}
      />
    </View>
  );
}

/** A camera permission problem (retry, or open Settings) or a plain picker error. */
function PickProblem({ permission, message, onRetry }: { permission: Exclude<PermissionOutcome, { state: 'granted' }> | null; message: string | null; onRetry: () => void }) {
  if (!permission && !message) return null;
  if (!permission) return <Text style={styles.error}>{message}</Text>;
  return (
    <View style={styles.permissionBox} accessibilityRole="alert">
      <Text style={styles.permissionText}>{permission.message}</Text>
      <View style={styles.row}>
        {permission.canRetry && <ActionButton icon={Camera} label="Try again" onPress={onRetry} />}
        {permission.canOpenSettings && <ActionButton icon={RefreshCw} label="Open Settings" onPress={() => Linking.openSettings().catch(() => {})} primary />}
      </View>
    </View>
  );
}

function ActionButton({ icon: Icon, label, onPress, disabled, primary }: { icon: typeof Camera; label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable style={[styles.actionBtn, primary && styles.actionBtnPrimary, disabled && styles.disabled]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={ICON_SIZE.sm} color={primary ? colors.white : colors.primary} strokeWidth={ICON_STROKE} />
      <Text style={[styles.actionBtnText, primary && styles.actionBtnTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function SourceRow({ icon: Icon, title, subtitle, onPress, disabled, danger }: { icon: typeof Camera; title: string; subtitle?: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable style={({ pressed }) => [styles.sourceRow, pressed && styles.sourceRowPressed, disabled && styles.disabled]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      <View style={[styles.sourceIcon, danger && styles.sourceIconDanger]}>
        <Icon size={ICON_SIZE.md} color={danger ? colors.error : colors.primary} strokeWidth={ICON_STROKE} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.sourceTitle, danger && { color: colors.error }]}>{title}</Text>
        {!!subtitle && <Text style={styles.hint}>{subtitle}</Text>}
      </View>
    </Pressable>
  );
}

const THUMB = 96;
const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  count: { color: colors.textMuted },
  hint: { ...textStyles.caption, fontSize: 11.5, color: colors.textMuted },
  error: { ...textStyles.caption, color: colors.error },
  fill: { width: '100%', height: '100%' },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  primaryBox: { width: '100%', aspectRatio: 1.4, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceSunken, borderWidth: 1, borderColor: colors.border },
  emptyBox: { alignItems: 'center', gap: spacing.xs, padding: spacing.lg, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.border, backgroundColor: colors.surface },
  emptyBoxError: { borderColor: colors.error },
  emptyTitle: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.surface },
  actionBtnPrimary: { backgroundColor: colors.primary },
  actionBtnText: { ...textStyles.button, fontSize: 13, color: colors.primary },
  actionBtnTextPrimary: { color: colors.white },
  disabled: { opacity: 0.5 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceSunken, borderWidth: 1, borderColor: colors.border },
  addThumb: { alignItems: 'center', justifyContent: 'center', gap: 4, borderStyle: 'dashed', borderWidth: 1.5, backgroundColor: colors.surface },
  addThumbText: { ...textStyles.caption, fontSize: 11, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  thumbBadge: { position: 'absolute', left: 6, top: 6, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(36,21,18,0.72)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  thumbBadgeText: { fontSize: 11, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  savingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  savingText: { ...textStyles.caption, color: colors.textSecondary },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm, ...shadows.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sheetTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: colors.textPrimary },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 60, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sourceRowPressed: { backgroundColor: colors.surfaceMuted },
  sourceIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  sourceIconDanger: { backgroundColor: colors.errorTint },
  sourceTitle: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  permissionBox: { backgroundColor: colors.warningTint, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  permissionText: { ...textStyles.bodySmall, color: colors.textPrimary },
  menuHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  menuThumb: { width: 48, height: 48, borderRadius: radius.sm },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  previewImage: { width: '100%', height: '85%' },
  previewClose: { position: 'absolute', top: 48, right: spacing.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
