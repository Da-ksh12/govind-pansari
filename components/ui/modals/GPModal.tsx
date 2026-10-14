import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { AlertTriangle, CheckCircle2, Info, type LucideIcon, XCircle } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { spring as springPresets, duration as motionDurations } from '../../../theme/motion';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { useReducedMotion } from '../../../hooks/useReducedMotion';

/**
 * The one Govind Pansari modal system (cart/checkout/order hardening
 * brief, sections 28-40) — a single base ("GPModal") plus thin,
 * semantically-named wrappers built on it, not a pile of unrelated
 * implementations. GPBottomSheet is `components/ui/BottomSheet.tsx`
 * (already built for the Categories/Search filter sheets) — reused
 * here rather than duplicated.
 */
export type GPModalTone = 'neutral' | 'success' | 'error' | 'warning';

const TONE_ICON: Record<GPModalTone, LucideIcon> = {
  neutral: Info,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
};

const TONE_COLOR: Record<GPModalTone, { icon: string; bg: string }> = {
  neutral: { icon: colors.primary, bg: colors.primaryTint },
  success: { icon: colors.success, bg: colors.successTint },
  error: { icon: colors.error, bg: colors.errorTint },
  warning: { icon: colors.warning, bg: colors.warningTint },
};

export interface GPModalProps {
  visible: boolean;
  onClose: () => void;
  tone?: GPModalTone;
  icon?: LucideIcon;
  /** Product/order/rider photo (section 39) — shown instead of the tone icon when provided. */
  image?: string;
  title: string;
  message?: string;
  children?: React.ReactNode;
  primaryLabel?: string;
  onPressPrimary?: () => void;
  primaryDestructive?: boolean;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onPressSecondary?: () => void;
  /** Tapping the dark backdrop closes the modal — default true, set false for a must-choose decision (e.g. cancel order). */
  dismissOnBackdrop?: boolean;
}

export function GPModal({
  visible,
  onClose,
  tone = 'neutral',
  icon,
  image,
  title,
  message,
  children,
  primaryLabel,
  onPressPrimary,
  primaryDestructive,
  primaryDisabled,
  secondaryLabel,
  onPressSecondary,
  dismissOnBackdrop = true,
}: GPModalProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(0.92);

  React.useEffect(() => {
    if (!visible) return;
    scale.value = reducedMotion ? 1 : withSpring(1, springPresets.gentle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Hardware back closes the modal instead of falling through to the
  // screen behind it (section 46) — Modal's own onRequestClose already
  // covers this, this just keeps `scale` reset for the next open.
  React.useEffect(() => {
    if (!visible) scale.value = 0.92;
  }, [visible, scale]);

  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const Icon = icon ?? TONE_ICON[tone];
  const toneColor = TONE_COLOR[tone];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(motionDurations.micro)} exiting={reducedMotion ? undefined : FadeOut.duration(motionDurations.micro)} style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismissOnBackdrop ? onClose : undefined} />
        <Animated.View style={[styles.card, cardStyle]}>
          {image ? (
            <Image source={{ uri: image }} style={styles.image} contentFit="cover" />
          ) : (
            <View style={[styles.iconCircle, { backgroundColor: toneColor.bg }]}>
              <Icon size={ICON_SIZE.xl} color={toneColor.icon} strokeWidth={ICON_STROKE} />
            </View>
          )}

          <Text style={styles.title}>{title}</Text>
          {message && <Text style={styles.message}>{message}</Text>}
          {children}

          {(primaryLabel || secondaryLabel) && (
            <View style={styles.buttonRow}>
              {secondaryLabel && (
                <Pressable style={styles.secondaryBtn} onPress={onPressSecondary ?? onClose}>
                  <Text style={styles.secondaryBtnText}>{secondaryLabel}</Text>
                </Pressable>
              )}
              {primaryLabel && (
                <Pressable
                  style={[styles.primaryBtn, primaryDestructive && styles.primaryBtnDestructive, primaryDisabled && styles.primaryBtnDisabled]}
                  onPress={onPressPrimary}
                  disabled={primaryDisabled}
                >
                  <Text style={styles.primaryBtnText}>{primaryLabel}</Text>
                </Pressable>
              )}
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

/** A yes/no decision — "Remove from cart?", "Cancel this order?". Backdrop tap is disabled by default so a real choice is made, not accidentally dismissed. */
export function GPConfirmModal(props: Omit<GPModalProps, 'dismissOnBackdrop'> & { destructive?: boolean }) {
  return <GPModal {...props} tone={props.tone ?? (props.destructive ? 'warning' : 'neutral')} primaryDestructive={props.destructive} dismissOnBackdrop={false} />;
}

/** A single-message outcome the user acknowledges — success, error, or a neutral heads-up. */
export function GPAlertModal(props: GPModalProps) {
  return <GPModal {...props} />;
}

export function GPSuccessModal(props: Omit<GPModalProps, 'tone'>) {
  return <GPModal {...props} tone="success" />;
}

export function GPErrorModal(props: Omit<GPModalProps, 'tone'>) {
  return <GPModal {...props} tone="error" />;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    ...shadows.lg,
  },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  image: { width: 88, height: 88, borderRadius: radius.lg, marginBottom: spacing.md, backgroundColor: colors.surfaceSunken },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary, textAlign: 'center' },
  message: { ...textStyles.bodySmall, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl, width: '100%' },
  secondaryBtn: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { ...textStyles.button, color: colors.textPrimary, fontSize: 14 },
  primaryBtn: { flex: 1, height: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDestructive: { backgroundColor: colors.error },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { ...textStyles.button, color: colors.white, fontSize: 14 },
});
