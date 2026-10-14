import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { colors } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const SIZES = { small: { dot: 5, gap: 4 }, large: { dot: 7, gap: 6 } };

function Dot({ delay, size, color, reducedMotion }: { delay: number; size: number; color: string; reducedMotion: boolean }) {
  const t = useSharedValue(0);
  useEffect(() => {
    if (reducedMotion) return;
    t.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 420, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 420, easing: Easing.inOut(Easing.sin) })), -1, false),
    );
  }, [reducedMotion, delay, t]);
  const style = useAnimatedStyle(() => ({
    opacity: reducedMotion ? 0.6 : 0.35 + t.value * 0.65,
    transform: [{ scale: reducedMotion ? 1 : 0.75 + t.value * 0.25 }],
  }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/**
 * The branded stand-in for a bare `ActivityIndicator` at the customer
 * flow's key "we're working on it" moments (motion system, section 10)
 * — three dots in a gentle traveling pulse rather than a spinning ring,
 * so waiting still feels like the rest of the app rather than a generic
 * loading widget. Pairs with the existing status copy at each call site
 * ("Getting your location…", "Checking delivery time…", etc.) — this
 * only swaps the visual, the messages were already in place and stay.
 */
export function BrandedLoader({ size = 'small', color = colors.primary }: { size?: 'small' | 'large'; color?: string }) {
  const reducedMotion = useReducedMotion();
  const { dot, gap } = SIZES[size];
  return (
    <View style={[styles.row, { gap }]}>
      {[0, 140, 280].map((delay) => (
        <Dot key={delay} delay={delay} size={dot} color={color} reducedMotion={reducedMotion} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
