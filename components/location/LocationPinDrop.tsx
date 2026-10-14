import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { MapPin } from 'lucide-react-native';
import { colors } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';

/**
 * The pin that drops onto the location-resolution map preview once a
 * store-serviceability check comes back (motion system, section 7) —
 * gives "we found you" a visible moment instead of the result card just
 * appearing. Purely decorative over a static illustrative map image, so
 * it never claims a real geographic position and exposes nothing about
 * store-selection logic underneath it. One drop, one ripple, then still.
 */
export function LocationPinDrop() {
  const reducedMotion = useReducedMotion();
  const dropY = useSharedValue(reducedMotion ? 0 : -70);
  const pinScale = useSharedValue(reducedMotion ? 1 : 0.7);
  const rippleScale = useSharedValue(0);
  const rippleOpacity = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) return;
    dropY.value = withDelay(200, withSequence(withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) }), withSpring(0, { damping: 5, stiffness: 220 })));
    pinScale.value = withDelay(200, withSpring(1, { damping: 7, stiffness: 200 }));
    rippleScale.value = withDelay(560, withTiming(2.4, { duration: 700, easing: Easing.out(Easing.cubic) }));
    rippleOpacity.value = withDelay(560, withSequence(withTiming(0.35, { duration: 60 }), withTiming(0, { duration: 640 })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dropY.value }, { scale: pinScale.value }] }));
  const rippleStyle = useAnimatedStyle(() => ({ opacity: rippleOpacity.value, transform: [{ scale: rippleScale.value }] }));

  return (
    <View style={styles.wrap} pointerEvents="none">
      {/* Both anchored to the same point — the pin's tip, not its
          icon-box center, is what should land on the ripple. */}
      <Animated.View style={[styles.ripple, rippleStyle]} />
      <Animated.View style={[styles.pinAnchor, pinStyle]}>
        <MapPin size={40} color={colors.primary} strokeWidth={2} fill={colors.gold} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  // Tip of a 40px MapPin glyph sits ~4px above the box's bottom edge —
  // offset so that point, not the icon box's center, lands on the anchor.
  pinAnchor: { position: 'absolute', top: '50%', left: '50%', marginLeft: -20, marginTop: -36 },
  ripple: { position: 'absolute', top: '50%', left: '50%', width: 20, height: 20, borderRadius: 10, marginLeft: -10, marginTop: -10, backgroundColor: colors.primary },
});
