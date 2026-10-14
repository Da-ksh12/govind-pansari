import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { colors, spacing, textStyles } from '../../theme';
import { motionDuration } from '../../theme/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import type { OrderStatus } from '../../types/models';

const TIMELINE: { status: OrderStatus; label: string }[] = [
  { status: 'placed', label: 'Order Placed' },
  { status: 'confirmed', label: 'Order Confirmed' },
  { status: 'preparing', label: 'Preparing Your Order' },
  { status: 'packed', label: 'Packed' },
  { status: 'out_for_delivery', label: 'Out for Delivery' },
  { status: 'arriving', label: 'Arriving Soon' },
  { status: 'delivered', label: 'Delivered' },
];

const ORDER_INDEX: Record<OrderStatus, number> = {
  placed: 0,
  confirmed: 1,
  preparing: 2,
  // Store-internal sub-phases of "preparing" (Phase 07) — no new
  // customer-visible timeline step per section 39 ("do not redesign
  // the customer UI"), just kept between preparing and packed so the
  // timeline still renders sensibly if an order is fetched mid-picking.
  picking: 2.3,
  packing: 2.6,
  packed: 3,
  rider_assigned: 3.5,
  out_for_delivery: 4,
  arriving: 5,
  delivered: 6,
  cancelled: -1,
};

/** The connecting line between two steps grows to full when the step below is reached, rather than snapping — the "story" the status evolves through (section 22). */
function TimelineLine({ done }: { done: boolean }) {
  const fill = useSharedValue(done ? 1 : 0);
  useEffect(() => {
    fill.value = withTiming(done ? 1 : 0, { duration: motionDuration.emphasis, easing: Easing.out(Easing.cubic) });
  }, [done, fill]);
  const style = useAnimatedStyle(() => ({ height: `${fill.value * 100}%` }));
  return (
    <View style={styles.line}>
      <Animated.View style={[styles.lineFill, style]} />
    </View>
  );
}

/** The current/active step's dot pulses gently — a live, "this is happening now" signal instead of a static ring. */
function TimelineDot({ done, active }: { done: boolean; active: boolean }) {
  const reducedMotion = useReducedMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (!active || reducedMotion) {
      pulse.value = withTiming(1, { duration: motionDuration.fast });
      return;
    }
    pulse.value = withRepeat(withSequence(withTiming(1.25, { duration: 700, easing: Easing.inOut(Easing.sin) }), withTiming(1, { duration: 700, easing: Easing.inOut(Easing.sin) })), -1, true);
  }, [active, reducedMotion, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  return (
    <Animated.View style={[styles.dot, done && styles.dotDone, active && styles.dotActive, pulseStyle]}>
      {done && <Check size={10} color={colors.white} strokeWidth={3} />}
    </Animated.View>
  );
}

export function OrderTimeline({ status }: { status: OrderStatus }) {
  // Defensive fallback — an unrecognized status must never break the
  // index math below (NaN comparisons silently render every step as
  // "not yet reached" rather than crashing, but starting from a real
  // number is still more correct than starting from undefined).
  const currentIndex = ORDER_INDEX[status] ?? 0;

  return (
    <View>
      {TIMELINE.map((step, i) => {
        const stepIndex = ORDER_INDEX[step.status];
        const done = currentIndex > stepIndex;
        const active = Math.floor(currentIndex) === stepIndex || (step.status === 'out_for_delivery' && currentIndex >= 3.5 && currentIndex < 5);
        const isLast = i === TIMELINE.length - 1;
        return (
          <View key={step.status} style={styles.row}>
            <View style={styles.indicatorCol}>
              <TimelineDot done={done} active={active} />
              {!isLast && <TimelineLine done={done} />}
            </View>
            <View style={styles.labelCol}>
              <Text style={[styles.label, (done || active) && styles.labelActive]}>{step.label}</Text>
              {active && <Text style={styles.liveTag}>Live</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  indicatorCol: { alignItems: 'center', width: 24 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.success, borderColor: colors.success },
  dotActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  line: { width: 2, flex: 1, minHeight: 24, backgroundColor: colors.border, overflow: 'hidden' },
  lineFill: { width: '100%', backgroundColor: colors.success },
  labelCol: { flex: 1, paddingBottom: spacing.md, paddingLeft: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { ...textStyles.bodySmall, color: colors.textMuted },
  labelActive: { color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  liveTag: { ...textStyles.caption, color: colors.white, backgroundColor: colors.primary, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, fontSize: 9 },
});
