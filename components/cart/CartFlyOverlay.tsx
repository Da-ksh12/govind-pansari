import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { radius } from '../../theme';
import { useCartFlyStore } from '../../store/cartFlyStore';

const FLY_DURATION_MS = 650;
// Roughly where FloatingCartBar's bag icon sits once it mounts — an
// approximate landing point, not a live measurement (the bar doesn't
// exist yet before the very first item is added, so there's nothing
// to measure against on that first, most important, animation).
const TARGET_X = 46;
const TARGET_Y_FROM_BOTTOM = 130;

/**
 * Mounted once near the root (app/_layout.tsx). Renders the single
 * currently-flying product image (triggered via useCartFlyStore.fly())
 * arcing from wherever "Add" was tapped toward the cart, fading and
 * shrinking as it lands — then pulses the cart bag icon.
 */
export function CartFlyOverlay() {
  const flying = useCartFlyStore((s) => s.flying);
  const clear = useCartFlyStore((s) => s.clear);
  const pulse = useCartFlyStore((s) => s.pulse);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!flying) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: FLY_DURATION_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) {
        runOnJS(pulse)();
        runOnJS(clear)();
      }
    });
  }, [flying, progress, pulse, clear]);

  const targetY = height - insets.bottom - TARGET_Y_FROM_BOTTOM;

  const style = useAnimatedStyle(() => {
    if (!flying) return { opacity: 0 };
    const t = progress.value;
    const x = flying.startX + (TARGET_X - flying.startX) * t;
    const arcLift = -90 * Math.sin(Math.PI * t);
    const y = flying.startY + (targetY - flying.startY) * t + arcLift;
    const scale = 1 - 0.6 * t;
    const opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    return {
      transform: [{ translateX: x }, { translateY: y }, { scale }],
      opacity,
    };
  });

  if (!flying || !flying.uri) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.wrap, { width: flying.size, height: flying.size }, style]}>
      <Image source={{ uri: flying.uri }} style={styles.image} contentFit="cover" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, zIndex: 999, elevation: 999 },
  image: { width: '100%', height: '100%', borderRadius: radius.sm },
});
