import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, shadows, spacing } from '../../theme';
import { duration } from '../../theme/motion';
import type { LucideIcon } from 'lucide-react-native';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';

interface IconButtonProps {
  icon: LucideIcon;
  onPress?: () => void;
  variant?: 'outline' | 'filled';
  badge?: boolean;
}

/** The bordered square icon buttons used throughout the reference screens (search, filter, notifications) — one shared press micro-interaction (scale down 96%) instead of each screen re-implementing it. */
export function IconButton({ icon: Icon, onPress, variant = 'outline', badge }: IconButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.timing(scale, { toValue: 0.94, duration: duration.micro, useNativeDriver: true }).start();
  const pressOut = () => Animated.timing(scale, { toValue: 1, duration: duration.micro, useNativeDriver: true }).start();

  return (
    <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} hitSlop={6}>
      <Animated.View style={[styles.btn, variant === 'filled' && styles.btnFilled, { transform: [{ scale }] }]}>
        <Icon size={ICON_SIZE.sm} color={variant === 'filled' ? colors.white : colors.textPrimary} strokeWidth={ICON_STROKE} />
        {badge && <View style={styles.badge} />}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 42, height: 42, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs,
  },
  btnFilled: { backgroundColor: colors.primary, borderColor: colors.primary },
  badge: { position: 'absolute', top: 7, right: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.error, borderWidth: 1.5, borderColor: colors.surface },
});
