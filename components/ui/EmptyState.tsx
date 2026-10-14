import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LucideIcon, PackageSearch } from 'lucide-react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { motionDuration } from '../../theme/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { AnimatedPressable } from '../motion/AnimatedPressable';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onPressCta?: () => void;
  icon?: LucideIcon;
  children?: React.ReactNode;
}

/**
 * Section 31 — every "nothing here yet" screen (empty cart, no orders,
 * no search results, empty wishlist) routes through this one component,
 * so a single tasteful entrance + idle-breathing animation upgrades all
 * of them consistently instead of each screen getting its own one-off
 * treatment.
 */
export function EmptyState({ title, subtitle, ctaLabel, onPressCta, icon: Icon = PackageSearch, children }: EmptyStateProps) {
  const reducedMotion = useReducedMotion();
  const breathe = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) return;
    breathe.value = withDelay(
      400,
      withRepeat(withSequence(withTiming(1.05, { duration: 1400, easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.sin) })), -1, true),
    );
  }, [reducedMotion, breathe]);

  const breatheStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));

  return (
    <View style={styles.container}>
      <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(motionDuration.normal).springify().damping(16)} style={[styles.iconCircle, breatheStyle]}>
        <Icon size={ICON_SIZE.xxl} color={colors.primary} strokeWidth={ICON_STROKE} />
      </Animated.View>
      <Animated.Text entering={reducedMotion ? undefined : FadeInDown.duration(motionDuration.normal).delay(80)} style={styles.title}>
        {title}
      </Animated.Text>
      {subtitle && (
        <Animated.Text entering={reducedMotion ? undefined : FadeInDown.duration(motionDuration.normal).delay(140)} style={styles.subtitle}>
          {subtitle}
        </Animated.Text>
      )}
      {ctaLabel && onPressCta && (
        <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(motionDuration.normal).delay(200)}>
          <AnimatedPressable style={styles.cta} onPress={onPressCta} pressScale={0.95}>
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </AnimatedPressable>
        </Animated.View>
      )}
      {children && (
        <Animated.View entering={reducedMotion ? undefined : FadeInDown.duration(motionDuration.normal).delay(240)} style={styles.extra}>
          {children}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: spacing.xxxl, paddingHorizontal: spacing.xl },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { fontFamily: 'PlayfairDisplay_600SemiBold', fontSize: 19, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...textStyles.bodySmall, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  cta: {
    marginTop: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  ctaText: { ...textStyles.button, color: colors.white, fontSize: 14 },
  extra: { marginTop: spacing.lg, width: '100%', alignItems: 'center' },
});
