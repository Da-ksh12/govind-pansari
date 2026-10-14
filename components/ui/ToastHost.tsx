import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { useUIStore } from '../../store/uiStore';

export function ToastHost() {
  const toast = useUIStore((s) => s.toast);
  const dismissToast = useUIStore((s) => s.dismissToast);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, 2200);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;

  const bg =
    toast.variant === 'success' ? colors.primaryDark : toast.variant === 'error' ? colors.error : colors.textPrimary;

  return (
    <Animated.View
      entering={FadeInDown.duration(220)}
      exiting={FadeOutDown.duration(180)}
      style={[styles.toast, { bottom: insets.bottom + spacing.xxl, backgroundColor: bg }]}
      pointerEvents="none"
    >
      <Text style={styles.text}>{toast.message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: 'center',
    ...shadows.lg,
  },
  text: {
    ...textStyles.bodySmall,
    color: colors.white,
    fontFamily: 'PlusJakartaSans_600SemiBold',
    textAlign: 'center',
  },
});
