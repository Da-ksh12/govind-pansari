import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, shadows } from '../../theme';
import { motionDuration } from '../../theme/motion';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { GPDeliveryCharacter } from '../brand/GPDeliveryCharacter';

const CHARACTER_SIZE = 44;
const HALO = 58;

interface RiderMapMarkerProps {
  /** Degrees, 0 = north. Already smoothed upstream (useSmoothedHeading) — rendered directly, no second easing layer on top. */
  heading: number;
  /** Last ping is older than the stale window: dimmed, still, last known position only — never extrapolated. */
  stale?: boolean;
  /** Real order status reached the customer's area (orders.status = 'arriving'): a gold pulse instead of motion. */
  arrived?: boolean;
}

/**
 * The live rider on the tracking map. Built on the original GP delivery
 * character (components/brand/GPDeliveryCharacter), so the same artwork
 * can be reused elsewhere.
 *
 * Motion is tied to real state, never invented:
 *  - rotates to the rider's actual bearing (upstream-smoothed heading)
 *  - a small bob and a trailing glow only while the ping is fresh, the
 *    order is not yet arrived, and the user hasn't asked for reduced motion
 *  - stale pings freeze the rider in place, dimmed — no fake movement
 *  - arrived shows a calm gold pulse ring around the rider
 * Reduced motion removes every loop; the state is still shown statically.
 */
export function RiderMapMarker({ heading, stale = false, arrived = false }: RiderMapMarkerProps) {
  const reducedMotion = useReducedMotion();
  const moving = !stale && !arrived && !reducedMotion;

  const bob = useSharedValue(0);
  const trail = useSharedValue(0.35);
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!moving) {
      bob.value = withTiming(0, { duration: motionDuration.fast });
      trail.value = withTiming(0.35, { duration: motionDuration.fast });
      return;
    }
    bob.value = withRepeat(
      withSequence(
        withTiming(-1.5, { duration: 420, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 420, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    trail.value = withRepeat(
      withSequence(
        withTiming(0.85, { duration: 650, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.35, { duration: 650, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, [moving, bob, trail]);

  useEffect(() => {
    if (!arrived || stale || reducedMotion) {
      pulse.value = 0;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.out(Easing.quad) }), -1, false);
  }, [arrived, stale, reducedMotion, pulse]);

  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
  const trailStyle = useAnimatedStyle(() => ({ opacity: trail.value }));
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.7 }],
    opacity: 0.55 * (1 - pulse.value),
  }));

  const staticPulse = arrived && !stale && reducedMotion;

  return (
    <View style={styles.container}>
      {arrived && !stale && (
        <Animated.View
          pointerEvents="none"
          style={[styles.pulseRing, staticPulse ? styles.pulseRingStatic : pulseStyle]}
        />
      )}

      <View style={[styles.halo, stale && styles.haloStale, arrived && !stale && styles.haloArrived]}>
        {/* rotated to the rider's bearing; the trail sits at the rear (bottom) so it always trails behind the scooter */}
        <View style={[styles.rotor, { transform: [{ rotate: `${heading}deg` }] }]}>
          {moving && <Animated.View pointerEvents="none" style={[styles.trail, trailStyle]} />}
          <Animated.View style={[styles.characterWrap, stale && styles.characterStale, bobStyle]}>
            <GPDeliveryCharacter size={CHARACTER_SIZE} />
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: HALO + 20,
    height: HALO + 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.md,
  },
  haloStale: {
    borderColor: colors.textMuted,
    backgroundColor: colors.surfaceSunken,
  },
  haloArrived: {
    borderColor: colors.gold,
    borderWidth: 3,
  },
  rotor: {
    width: CHARACTER_SIZE,
    height: CHARACTER_SIZE * (100 / 96) + 10,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  characterWrap: {
    width: CHARACTER_SIZE,
  },
  characterStale: {
    opacity: 0.5,
  },
  trail: {
    position: 'absolute',
    bottom: -2,
    width: 12,
    height: 16,
    borderRadius: 6,
    backgroundColor: colors.gold,
  },
  pulseRing: {
    position: 'absolute',
    width: HALO,
    height: HALO,
    borderRadius: HALO / 2,
    borderWidth: 2,
    borderColor: colors.gold,
  },
  pulseRingStatic: {
    opacity: 0.35,
    transform: [{ scale: 1.25 }],
  },
});
