import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Heart } from 'lucide-react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, radius } from '../../theme';
import { ICON_STROKE } from '../../theme/icons';

interface AnimatedWishlistHeartProps {
  active: boolean;
  onToggle: () => void;
  size?: number;
  iconSize?: number;
  /** When the caller already provides a styled button (border, background), skip this component's own white circle chip — animation still applies. */
  bare?: boolean;
  iconColorActive?: string;
  iconColorInactive?: string;
}

function BurstDot({ angle, play }: { angle: number; play: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    if (play === 0) return;
    progress.value = 0;
    progress.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);
  const rad = (angle * Math.PI) / 180;
  const style = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      opacity: 1 - t,
      transform: [{ translateX: Math.cos(rad) * 16 * t }, { translateY: Math.sin(rad) * 16 * t }, { scale: 1 - t * 0.4 }],
    };
  });
  return <Animated.View style={[styles.burstDot, style]} />;
}

/**
 * Section 16 — tap: scale up, fill, a quick heartbeat, settle, with a
 * very small burst of dots (not confetti) reinforcing the moment
 * without becoming cartoonish. Reused everywhere a wishlist heart
 * appears instead of each screen re-implementing the toggle animation.
 */
export function AnimatedWishlistHeart({
  active,
  onToggle,
  size = 32,
  iconSize = 16,
  bare = false,
  iconColorActive = colors.primary,
  iconColorInactive = colors.textSecondary,
}: AnimatedWishlistHeartProps) {
  const scale = useSharedValue(1);

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const turningOn = !active;
    onToggle();
    if (turningOn) {
      scale.value = withSequence(
        withTiming(1.35, { duration: 140, easing: Easing.out(Easing.cubic) }),
        withTiming(0.92, { duration: 90 }),
        withTiming(1.1, { duration: 90 }),
        withTiming(1, { duration: 120 }),
      );
    } else {
      scale.value = withSequence(withTiming(0.85, { duration: 100 }), withTiming(1, { duration: 140 }));
    }
  };

  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable onPress={handlePress} hitSlop={8} style={bare ? undefined : [styles.slot, { width: size, height: size, borderRadius: size / 2 }]}>
      <View style={styles.burstLayer} pointerEvents="none">
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <BurstDot key={angle} angle={angle} play={active ? 1 : 0} />
        ))}
      </View>
      <Animated.View style={heartStyle}>
        <Heart size={iconSize} color={active ? iconColorActive : iconColorInactive} fill={active ? iconColorActive : 'transparent'} strokeWidth={ICON_STROKE} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  slot: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  burstLayer: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  burstDot: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: colors.gold },
});
