import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Check, Package, PackageCheck, ShoppingBasket } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { motionDuration } from '../../theme/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export type PreparationStage = 'gathering' | 'packing' | 'sealed';

const STAGES: PreparationStage[] = ['gathering', 'packing', 'sealed'];

const STAGE_ICON: Record<PreparationStage, typeof ShoppingBasket> = {
  gathering: ShoppingBasket,
  packing: Package,
  sealed: PackageCheck,
};

const STAGE_CAPTION: Record<PreparationStage, string> = {
  gathering: 'Gathering your items',
  packing: 'Carefully packing your order',
  sealed: 'Sealed and ready for dispatch',
};

/** One dot in the 3-step tracker beneath the badge — filled once reached, gently scaled up while the current one. */
function StepDot({ reached, current }: { reached: boolean; current: boolean }) {
  const fill = useSharedValue(reached ? 1 : 0);
  useEffect(() => {
    fill.value = withTiming(reached ? 1 : 0, { duration: motionDuration.normal, easing: Easing.out(Easing.cubic) });
  }, [reached, fill]);
  const style = useAnimatedStyle(() => ({
    backgroundColor: fill.value > 0.5 ? colors.gold : colors.divider,
    transform: [{ scale: current ? 1.3 : 1 }],
  }));
  return <Animated.View style={[styles.stepDot, style]} />;
}

/**
 * The Govind Pansari order-preparation scene (motion system, section 3)
 * — a single badge that transforms through the real in-store phases
 * (items gathered -> boxed -> sealed) rather than a generic spinner.
 * Icon cross-fades between states; a brand-gold seal ring and a check
 * mark appear only once the order is genuinely packed. Lives on the
 * order-detail screen alongside (not instead of) the existing text
 * timeline, as the "story" visual for the one phase that otherwise had
 * none (the rider-journey strip already covers everything from
 * rider-assigned onward).
 */
export function OrderPreparationScene({ stage }: { stage: PreparationStage }) {
  const reducedMotion = useReducedMotion();
  const iconOpacity = useSharedValue(1);
  const badgeScale = useSharedValue(1);
  const sealScale = useSharedValue(stage === 'sealed' ? 1 : 0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) {
      sealScale.value = stage === 'sealed' ? 1 : 0;
      return;
    }
    // Brief settle-and-refresh whenever the stage actually changes — the
    // icon itself just swaps (React key change), this is the "container"
    // reacting: a small dip then spring back, so the transformation reads
    // as one continuous object changing rather than a hard cut.
    iconOpacity.value = withSequence(withTiming(0, { duration: 140 }), withTiming(1, { duration: 220 }));
    badgeScale.value = withSequence(withTiming(0.92, { duration: 140 }), withSpring(1, { damping: 10, stiffness: 160 }));
    sealScale.value = stage === 'sealed' ? withDelay(260, withSpring(1, { damping: 8, stiffness: 200 })) : withTiming(0, { duration: 160 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, reducedMotion]);

  useEffect(() => {
    if (reducedMotion || stage === 'sealed') {
      pulse.value = withTiming(1, { duration: motionDuration.fast });
      return;
    }
    pulse.value = withRepeat(
      withSequence(withTiming(1.08, { duration: 700, easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) })),
      -1,
      true,
    );
  }, [stage, reducedMotion, pulse]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badgeScale.value * pulse.value }] }));
  const iconStyle = useAnimatedStyle(() => ({ opacity: iconOpacity.value }));
  const sealStyle = useAnimatedStyle(() => ({ opacity: sealScale.value, transform: [{ scale: sealScale.value }] }));

  const Icon = STAGE_ICON[stage];
  const currentIndex = STAGES.indexOf(stage);

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.badge, stage === 'sealed' && styles.badgeSealed, badgeStyle]}>
        <Animated.View style={iconStyle}>
          <Icon size={30} color={stage === 'sealed' ? colors.white : colors.primary} strokeWidth={1.8} />
        </Animated.View>
        <Animated.View style={[styles.sealBadge, sealStyle]}>
          <Check size={11} color={colors.white} strokeWidth={3} />
        </Animated.View>
      </Animated.View>
      <Text style={styles.caption}>{STAGE_CAPTION[stage]}</Text>
      <View style={styles.stepsRow}>
        {STAGES.map((s, i) => (
          <StepDot key={s} reached={i <= currentIndex} current={i === currentIndex} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  badge: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: colors.goldTint,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.gold,
  },
  badgeSealed: { backgroundColor: colors.primary, borderColor: colors.primary },
  sealBadge: {
    position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.surface,
  },
  caption: { ...textStyles.bodySmall, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold', textAlign: 'center' },
  stepsRow: { flexDirection: 'row', gap: spacing.xs, marginTop: 2 },
  stepDot: { width: 6, height: 6, borderRadius: 3 },
});
