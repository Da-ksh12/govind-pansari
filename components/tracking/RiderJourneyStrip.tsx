import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Bike, Home, Store } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { motionDuration } from '../../theme/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export type JourneyStage = 'assigned' | 'accepted' | 'at_store' | 'picked_up' | 'in_transit' | 'arriving' | 'delivered';

/**
 * How far along the Store -> Customer journey each real delivery stage
 * represents. Deliberately not evenly spaced — "picked up" and "on the
 * way" are the bulk of the actual travel time, so they get the bulk of
 * the track; "assigned" (rider hasn't moved yet) barely nudges off zero.
 */
const STAGE_PROGRESS: Record<JourneyStage, number> = {
  assigned: 0.06,
  accepted: 0.22,
  at_store: 0.38,
  picked_up: 0.52,
  in_transit: 0.78,
  arriving: 0.94,
  delivered: 1,
};

const STAGE_CAPTION: Record<JourneyStage, string> = {
  assigned: 'Waiting for pickup',
  accepted: 'Heading to the store',
  at_store: 'At the store',
  picked_up: 'Picked up your order',
  in_transit: 'On the way to you',
  arriving: 'Almost there',
  delivered: 'Delivered',
};

interface RiderJourneyStripProps {
  stage: JourneyStage;
}

/**
 * The Govind Pansari signature rider-journey visual (motion system,
 * section 1) — an original schematic complement to the real live map,
 * not a replacement for it. A store badge and a home badge anchor
 * either end of a track; a bike badge travels between them as the
 * real delivery stage advances, with the traveled portion of the
 * track filling in burgundy-to-gold rather than the flat single-tone
 * progress bar most delivery apps use. Pulses gently while genuinely
 * in motion (in_transit) as a "this is live" cue, still, calm state
 * otherwise — never animates just to look busy.
 */
export function RiderJourneyStrip({ stage }: RiderJourneyStripProps) {
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(STAGE_PROGRESS[stage]);
  const pulse = useSharedValue(1);

  useEffect(() => {
    progress.value = withTiming(STAGE_PROGRESS[stage], {
      duration: reducedMotion ? motionDuration.instant : motionDuration.cinematic,
      easing: Easing.out(Easing.cubic),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, reducedMotion]);

  useEffect(() => {
    if (reducedMotion || stage !== 'in_transit') {
      pulse.value = withTiming(1, { duration: motionDuration.fast });
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.16, { duration: 620, easing: Easing.inOut(Easing.sin) }),
        withTiming(1, { duration: 620, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
  }, [stage, reducedMotion, pulse]);

  const trackFillStyle = useAnimatedStyle(() => ({
    width: `${progress.value * 100}%`,
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.primary, colors.gold]),
  }));

  const bikeWrapStyle = useAnimatedStyle(() => ({
    left: `${progress.value * 100}%`,
    transform: [{ translateX: -18 }, { scale: pulse.value }],
  }));

  return (
    <View style={styles.wrap}>
      <View style={styles.trackRow}>
        <View style={styles.endpointCircle}>
          <Store size={16} color={colors.primary} strokeWidth={2} />
        </View>
        <View style={styles.trackTrack}>
          <View style={styles.trackBase} />
          <Animated.View style={[styles.trackFill, trackFillStyle]} />
          <Animated.View style={[styles.bikeWrap, bikeWrapStyle]}>
            <View style={styles.bikeBadge}>
              <Bike size={15} color={colors.white} strokeWidth={2.2} />
            </View>
          </Animated.View>
        </View>
        <View style={[styles.endpointCircle, stage === 'delivered' && styles.endpointCircleActive]}>
          <Home size={16} color={stage === 'delivered' ? colors.white : colors.textMuted} strokeWidth={2} />
        </View>
      </View>
      <Text style={styles.caption}>{STAGE_CAPTION[stage]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  trackRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  endpointCircle: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primaryTint,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  endpointCircleActive: { backgroundColor: colors.success },
  trackTrack: { flex: 1, height: 4, justifyContent: 'center' },
  trackBase: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: colors.divider },
  trackFill: { position: 'absolute', left: 0, height: 3, borderRadius: 2 },
  bikeWrap: { position: 'absolute' },
  bikeBadge: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface,
  },
  caption: { ...textStyles.caption, color: colors.textSecondary, textAlign: 'center', fontFamily: 'PlusJakartaSans_600SemiBold' },
});
