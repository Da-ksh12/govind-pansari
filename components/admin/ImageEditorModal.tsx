import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, LayoutChangeEvent, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Eye, EyeOff, Minus, Plus, RotateCcw, RotateCw, X } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import {
  ASPECTS,
  DEFAULT_ASPECT,
  MAX_ZOOM,
  MIN_ZOOM,
  aspectRatio,
  clamp,
  clampPan,
  coverScale,
  cropRect,
  fitFrame,
  normalizeQuarterTurns,
  rotatedSize,
  type AspectKey,
} from '../../services/imageEditing';
import { prepareForEditing, renderEditedImage, type EditedImage, type WorkingImage } from '../../services/storage/imageProcessing';

// The editor is a dark "darkroom" so the photo, not the chrome, holds the eye; controls sit on the usual cream surface.
const EDITOR_BG = '#1B100E';
const FRAME_MARGIN = 20;
const ROTATE_MS = 240;

interface Props {
  visible: boolean;
  /** The raw photo from the camera or gallery. */
  source: { uri: string } | null;
  /** "Photo 2 of 3" when several gallery photos are being edited in turn. */
  queueLabel?: string;
  initialAspect?: AspectKey;
  onApply: (edited: EditedImage) => void;
  onCancel: () => void;
}

/**
 * Crop / zoom / rotate editor for a product photo. Drag to reposition, pinch (or the +/- buttons) to zoom, rotate in quarter
 * turns, choose an aspect ratio, Reset to start over, Preview to see exactly what will be saved. Apply renders the result
 * (cropped, JPEG, at most 1600 px on the long edge); Cancel changes nothing. The geometry lives in services/imageEditing.
 */
export function ImageEditorModal({ visible, source, queueLabel, initialAspect = DEFAULT_ASPECT, onApply, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const [working, setWorking] = useState<WorkingImage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [aspect, setAspect] = useState<AspectKey>(initialAspect);
  const [turns, setTurns] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [canvas, setCanvas] = useState({ width: 0, height: 0 });
  const [retryTick, setRetryTick] = useState(0);
  const attempt = useRef(0);

  // Everything the gestures and the animated image read lives on the UI thread as shared values.
  const natW = useSharedValue(1);
  const natH = useSharedValue(1);
  const turnsSV = useSharedValue(0);
  const frameW = useSharedValue(0);
  const frameH = useSharedValue(0);
  const canvasW = useSharedValue(0);
  const canvasH = useSharedValue(0);
  const zoom = useSharedValue(MIN_ZOOM);
  const panX = useSharedValue(0);
  const panY = useSharedValue(0);
  const savedZoom = useSharedValue(MIN_ZOOM);
  const savedPanX = useSharedValue(0);
  const savedPanY = useSharedValue(0);
  // Rotate / reset animate from what is on screen to the new state: `anim` runs 0 -> 1 and every shown value mixes from -> to.
  const anim = useSharedValue(1);
  const fromRot = useSharedValue(0);
  const fromBase = useSharedValue(1);
  const fromZoom = useSharedValue(MIN_ZOOM);
  const fromPanX = useSharedValue(0);
  const fromPanY = useSharedValue(0);

  const rotated = useDerivedValue(() => {
    const odd = Math.abs(turnsSV.value) % 2 === 1;
    return { width: odd ? natH.value : natW.value, height: odd ? natW.value : natH.value };
  });
  const rotShown = useDerivedValue(() => fromRot.value + (turnsSV.value * 90 - fromRot.value) * anim.value);
  const baseShown = useDerivedValue(() => {
    const target = coverScale(rotated.value, { width: frameW.value, height: frameH.value });
    return fromBase.value + (target - fromBase.value) * anim.value;
  });
  const zoomShown = useDerivedValue(() => fromZoom.value + (zoom.value - fromZoom.value) * anim.value);
  const panShown = useDerivedValue(() =>
    clampPan(
      { x: fromPanX.value + (panX.value - fromPanX.value) * anim.value, y: fromPanY.value + (panY.value - fromPanY.value) * anim.value },
      rotated.value,
      { width: frameW.value, height: frameH.value },
      zoomShown.value,
    ),
  );

  const targetFrame = useCallback(
    (key: AspectKey, area = canvas) =>
      fitFrame({ width: Math.max(0, area.width - FRAME_MARGIN * 2), height: Math.max(0, area.height - FRAME_MARGIN * 2) }, aspectRatio(key)),
    [canvas],
  );

  // A new photo: prepare it (upright, editing size) and start from a clean state.
  useEffect(() => {
    if (!visible || !source) return;
    let cancelled = false;
    const mine = ++attempt.current;
    setWorking(null);
    setLoadError(null);
    setApplyError(null);
    setApplying(false);
    setPreviewing(false);
    setAspect(initialAspect);
    setTurns(0);
    prepareForEditing(source.uri)
      .then((image) => {
        if (cancelled || mine !== attempt.current) return;
        natW.value = image.width;
        natH.value = image.height;
        // A new photo always opens in the starting ratio, whatever the last one was left on.
        const startFrame = fitFrame({ width: Math.max(0, canvasW.value - FRAME_MARGIN * 2), height: Math.max(0, canvasH.value - FRAME_MARGIN * 2) }, aspectRatio(initialAspect));
        frameW.value = startFrame.width;
        frameH.value = startFrame.height;
        turnsSV.value = 0;
        zoom.value = MIN_ZOOM;
        panX.value = 0;
        panY.value = 0;
        anim.value = 1;
        fromRot.value = 0;
        fromZoom.value = MIN_ZOOM;
        fromPanX.value = 0;
        fromPanY.value = 0;
        setWorking(image);
      })
      .catch((e) => !cancelled && setLoadError(e instanceof Error ? e.message : "We couldn't open that photo."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, source?.uri, retryTick]);

  const onCanvasLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setCanvas({ width, height });
    canvasW.value = width;
    canvasH.value = height;
    const frame = targetFrame(aspect, { width, height });
    frameW.value = frame.width;
    frameH.value = frame.height;
  };

  const chooseAspect = (key: AspectKey) => {
    if (key === aspect) return;
    setAspect(key);
    const frame = targetFrame(key);
    frameW.value = withTiming(frame.width, { duration: ROTATE_MS, easing: Easing.out(Easing.cubic) });
    frameH.value = withTiming(frame.height, { duration: ROTATE_MS, easing: Easing.out(Easing.cubic) });
  };

  const snapshotShown = () => {
    fromRot.value = rotShown.value;
    fromBase.value = baseShown.value;
    fromZoom.value = zoomShown.value;
    fromPanX.value = panShown.value.x;
    fromPanY.value = panShown.value.y;
  };

  const rotate = () => {
    snapshotShown();
    const next = turns + 1;
    setTurns(next);
    turnsSV.value = next;
    zoom.value = MIN_ZOOM;
    panX.value = 0;
    panY.value = 0;
    anim.value = 0;
    anim.value = withTiming(1, { duration: ROTATE_MS, easing: Easing.out(Easing.cubic) });
  };

  const reset = () => {
    snapshotShown();
    // Back through the shortest way: to the nearest whole number of full turns.
    const home = Math.round(turns / 4) * 4;
    setTurns(home);
    turnsSV.value = home;
    zoom.value = MIN_ZOOM;
    panX.value = 0;
    panY.value = 0;
    anim.value = 0;
    anim.value = withTiming(1, { duration: ROTATE_MS, easing: Easing.out(Easing.cubic) });
    if (aspect !== DEFAULT_ASPECT) {
      setAspect(DEFAULT_ASPECT);
      const frame = targetFrame(DEFAULT_ASPECT);
      frameW.value = withTiming(frame.width, { duration: ROTATE_MS, easing: Easing.out(Easing.cubic) });
      frameH.value = withTiming(frame.height, { duration: ROTATE_MS, easing: Easing.out(Easing.cubic) });
    }
  };

  const zoomBy = (factor: number) => {
    zoom.value = withTiming(clamp(zoom.value * factor, MIN_ZOOM, MAX_ZOOM), { duration: 160 });
  };

  const gesturesOn = !!working && !previewing && !applying;
  const pan = Gesture.Pan()
    .enabled(gesturesOn)
    .onStart(() => {
      savedPanX.value = panShown.value.x;
      savedPanY.value = panShown.value.y;
    })
    .onUpdate((e) => {
      const next = clampPan({ x: savedPanX.value + e.translationX, y: savedPanY.value + e.translationY }, rotated.value, { width: frameW.value, height: frameH.value }, zoom.value);
      panX.value = next.x;
      panY.value = next.y;
    });
  const pinch = Gesture.Pinch()
    .enabled(gesturesOn)
    .onStart(() => {
      savedZoom.value = zoom.value;
      savedPanX.value = panShown.value.x;
      savedPanY.value = panShown.value.y;
    })
    .onUpdate((e) => {
      const nextZoom = clamp(savedZoom.value * e.scale, MIN_ZOOM, MAX_ZOOM);
      zoom.value = nextZoom;
      const next = clampPan({ x: savedPanX.value, y: savedPanY.value }, rotated.value, { width: frameW.value, height: frameH.value }, nextZoom);
      panX.value = next.x;
      panY.value = next.y;
    });
  const gestures = Gesture.Simultaneous(pan, pinch);

  const imageStyle = useAnimatedStyle(() => {
    const scale = baseShown.value * zoomShown.value;
    const width = natW.value * scale;
    const height = natH.value * scale;
    return {
      width,
      height,
      left: frameW.value / 2 - width / 2,
      top: frameH.value / 2 - height / 2,
      transform: [{ translateX: panShown.value.x }, { translateY: panShown.value.y }, { rotate: `${rotShown.value}deg` }],
    };
  });
  const frameStyle = useAnimatedStyle(() => ({ width: frameW.value, height: frameH.value }));
  // The four dim panels around the frame (opaque in Preview, so only the result is visible).
  const dimTop = useAnimatedStyle(() => ({ height: Math.max(0, (canvasH.value - frameH.value) / 2) }));
  const dimBottom = useAnimatedStyle(() => ({ height: Math.max(0, (canvasH.value - frameH.value) / 2) }));
  const dimLeft = useAnimatedStyle(() => ({ width: Math.max(0, (canvasW.value - frameW.value) / 2), top: Math.max(0, (canvasH.value - frameH.value) / 2), height: frameH.value }));
  const dimRight = useAnimatedStyle(() => ({ width: Math.max(0, (canvasW.value - frameW.value) / 2), top: Math.max(0, (canvasH.value - frameH.value) / 2), height: frameH.value }));

  const apply = async () => {
    if (!working || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      const target = targetFrame(aspect);
      const quarter = normalizeQuarterTurns(turns);
      const crop = cropRect(rotatedSize(working, quarter), target, zoom.value, { x: panX.value, y: panY.value });
      const result = await renderEditedImage(working, quarter, crop);
      onApply(result);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "We couldn't apply your edits. Please try again.");
      setApplying(false);
    }
  };

  const dimOpacity = previewing ? 1 : 0.62;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={applying ? undefined : onCancel} statusBarTranslucent>
      {/* A Modal is its own native root: gestures inside it need their own GestureHandlerRootView. */}
      <GestureHandlerRootView style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable style={styles.headerBtn} onPress={onCancel} disabled={applying} accessibilityRole="button" accessibilityLabel="Cancel editing" hitSlop={8}>
            <X size={ICON_SIZE.md} color={colors.white} strokeWidth={ICON_STROKE} />
            <Text style={styles.headerBtnText}>Cancel</Text>
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>{previewing ? 'Preview' : 'Edit photo'}</Text>
            {!!queueLabel && <Text style={styles.headerSub}>{queueLabel}</Text>}
          </View>
          <Pressable style={[styles.applyBtn, (!working || applying) && styles.applyBtnDisabled]} onPress={apply} disabled={!working || applying} accessibilityRole="button" accessibilityLabel="Apply edits">
            {applying ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.applyBtnText}>Apply</Text>}
          </Pressable>
        </View>

        <View style={styles.canvas} onLayout={onCanvasLayout}>
          {!working && !loadError && (
            <View style={styles.centerFill}>
              <ActivityIndicator color={colors.white} />
              <Text style={styles.stateText}>Preparing your photo…</Text>
            </View>
          )}
          {!!loadError && (
            <View style={styles.centerFill}>
              <Text style={styles.stateTitle}>Couldn't open this photo</Text>
              <Text style={styles.stateText}>{loadError}</Text>
              <View style={styles.stateActions}>
                <Pressable style={styles.stateBtn} onPress={() => setRetryTick((n) => n + 1)}>
                  <Text style={styles.stateBtnText}>Try again</Text>
                </Pressable>
                <Pressable style={styles.stateBtn} onPress={onCancel}>
                  <Text style={styles.stateBtnText}>Close</Text>
                </Pressable>
              </View>
            </View>
          )}
          {!!working && (
            <GestureDetector gesture={gestures}>
              <View style={StyleSheet.absoluteFill}>
                <View style={styles.frameHolder} pointerEvents="none">
                  <Animated.View style={[styles.frame, frameStyle, previewing && { borderRadius: radius.md }]}>
                    <Animated.Image source={{ uri: working.uri }} style={[styles.photo, imageStyle]} resizeMode="stretch" />
                  </Animated.View>
                </View>
                <Animated.View pointerEvents="none" style={[styles.dim, styles.dimTop, dimTop, { opacity: dimOpacity }]} />
                <Animated.View pointerEvents="none" style={[styles.dim, styles.dimBottom, dimBottom, { opacity: dimOpacity }]} />
                <Animated.View pointerEvents="none" style={[styles.dim, styles.dimLeft, dimLeft, { opacity: dimOpacity }]} />
                <Animated.View pointerEvents="none" style={[styles.dim, styles.dimRight, dimRight, { opacity: dimOpacity }]} />
                {!previewing && (
                  <View style={styles.frameHolder} pointerEvents="none">
                    <Animated.View style={[styles.frameBorder, frameStyle]}>
                      <View style={[styles.gridLine, styles.gridV1]} />
                      <View style={[styles.gridLine, styles.gridV2]} />
                      <View style={[styles.gridLine, styles.gridH1]} />
                      <View style={[styles.gridLine, styles.gridH2]} />
                    </Animated.View>
                  </View>
                )}
              </View>
            </GestureDetector>
          )}
        </View>

        <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          {!!applyError && <Text style={styles.errorText}>{applyError}</Text>}
          {previewing ? (
            <Text style={styles.hint}>This is exactly how the photo will be saved. Tap "Back to editing" to adjust it.</Text>
          ) : (
            <Text style={styles.hint}>Drag to reposition · pinch or use +/− to zoom</Text>
          )}
          <View style={styles.aspectRow}>
            {ASPECTS.map((a) => {
              const active = a.key === aspect;
              return (
                <Pressable key={a.key} style={[styles.aspectChip, active && styles.aspectChipActive]} onPress={() => chooseAspect(a.key)} disabled={!working || previewing || applying} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={`Crop ratio ${a.label}`}>
                  <Text style={[styles.aspectChipText, active && styles.aspectChipTextActive]}>{a.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.toolRow}>
            <ToolButton icon={Minus} label="Zoom out" onPress={() => zoomBy(1 / 1.25)} disabled={!working || previewing || applying} />
            <ToolButton icon={Plus} label="Zoom in" onPress={() => zoomBy(1.25)} disabled={!working || previewing || applying} />
            <ToolButton icon={RotateCw} label="Rotate" onPress={rotate} disabled={!working || previewing || applying} />
            <ToolButton icon={RotateCcw} label="Reset" onPress={reset} disabled={!working || applying} />
            <ToolButton icon={previewing ? EyeOff : Eye} label={previewing ? 'Back to editing' : 'Preview'} onPress={() => setPreviewing((p) => !p)} disabled={!working || applying} wide />
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ToolButton({ icon: Icon, label, onPress, disabled, wide }: { icon: typeof Plus; label: string; onPress: () => void; disabled?: boolean; wide?: boolean }) {
  return (
    <Pressable style={[styles.tool, wide && styles.toolWide, disabled && styles.toolDisabled]} onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
      <Text style={styles.toolLabel} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: EDITOR_BG },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.base, paddingVertical: spacing.sm, minHeight: 56 },
  headerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, minWidth: 44 },
  headerBtnText: { ...textStyles.bodySmall, color: colors.white },
  headerTitleWrap: { alignItems: 'center' },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 17, color: colors.white },
  headerSub: { ...textStyles.caption, color: colors.goldTint },
  applyBtn: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, height: 40, minWidth: 72, alignItems: 'center', justifyContent: 'center' },
  applyBtnDisabled: { opacity: 0.5 },
  applyBtnText: { ...textStyles.button, color: colors.white, fontSize: 14 },
  canvas: { flex: 1, minHeight: 0, overflow: 'hidden' },
  centerFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
  stateTitle: { ...textStyles.cardTitle, color: colors.white, textAlign: 'center' },
  stateText: { ...textStyles.bodySmall, color: colors.goldTint, textAlign: 'center' },
  stateActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  stateBtn: { borderWidth: 1, borderColor: colors.goldTint, borderRadius: radius.pill, paddingHorizontal: spacing.lg, height: 40, alignItems: 'center', justifyContent: 'center' },
  stateBtnText: { ...textStyles.button, color: colors.white, fontSize: 13 },
  frameHolder: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  frame: { overflow: 'hidden', backgroundColor: '#000' },
  photo: { position: 'absolute' },
  frameBorder: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)' },
  dim: { position: 'absolute', backgroundColor: EDITOR_BG },
  dimTop: { top: 0, left: 0, right: 0 },
  dimBottom: { bottom: 0, left: 0, right: 0 },
  dimLeft: { left: 0 },
  dimRight: { right: 0 },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },
  gridV1: { left: '33.33%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridV2: { left: '66.66%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH1: { top: '33.33%', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  gridH2: { top: '66.66%', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  controls: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: spacing.md, paddingHorizontal: spacing.base, gap: spacing.sm },
  hint: { ...textStyles.caption, color: colors.textSecondary, textAlign: 'center' },
  errorText: { ...textStyles.bodySmall, color: colors.error, textAlign: 'center' },
  aspectRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  aspectChip: { minWidth: 56, height: 36, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md },
  aspectChipActive: { backgroundColor: colors.primary },
  aspectChipText: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  aspectChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  toolRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs },
  tool: { flex: 1, minHeight: 56, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: 2, paddingHorizontal: 2 },
  toolWide: { flex: 1.5 },
  toolDisabled: { opacity: 0.4 },
  toolLabel: { ...textStyles.caption, fontSize: 10.5, color: colors.textSecondary },
});
