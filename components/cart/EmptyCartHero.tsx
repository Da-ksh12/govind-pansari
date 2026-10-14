import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { ShoppingBasket } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const ITEM_COLORS = [colors.gold, colors.primary, colors.sage];
// Each dot "drops" from a different point above the basket and settles
// at a different resting spot inside it — a small staggered choreography
// rather than three identical dots animating in lockstep.
const ITEMS = [
  { color: ITEM_COLORS[0], fromX: -34, fromY: -58, toX: -16, toY: -6, delay: 260, size: 13 },
  { color: ITEM_COLORS[1], fromX: 0, fromY: -70, toX: 4, toY: -14, delay: 380, size: 15 },
  { color: ITEM_COLORS[2], fromX: 32, fromY: -58, toX: 18, toY: -4, delay: 500, size: 12 },
];

function FallingItem({ color, fromX, fromY, toX, toY, delay, size, reducedMotion }: (typeof ITEMS)[number] & { reducedMotion: boolean }) {
  const progress = useSharedValue(reducedMotion ? 1 : 0);

  useEffect(() => {
    if (reducedMotion) return;
    progress.value = withDelay(delay, withSpring(1, { damping: 11, stiffness: 120, mass: 0.7 }));
  }, [reducedMotion, delay, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateX: fromX + (toX - fromX) * progress.value },
      { translateY: fromY + (toY - fromY) * progress.value },
      { scale: 0.4 + progress.value * 0.6 },
    ],
  }));

  return <Animated.View style={[styles.item, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }, style]} />;
}

/**
 * The branded empty-cart illustration (motion system, section 4) — a
 * basket with a few products settling into it, rather than a static
 * icon. Deliberately restrained: three dots, one spring each, done in
 * well under a second, then still. Reduced-motion shows the finished
 * "items already in the basket" state immediately, no animation run.
 */
export function EmptyCartHero() {
  const reducedMotion = useReducedMotion();
  const basketBounce = useSharedValue(reducedMotion ? 1 : 0.85);

  useEffect(() => {
    if (reducedMotion) return;
    basketBounce.value = withDelay(650, withSequence(withTiming(1.08, { duration: 220, easing: Easing.out(Easing.cubic) }), withSpring(1, { damping: 9, stiffness: 180 })));
  }, [reducedMotion, basketBounce]);

  const basketStyle = useAnimatedStyle(() => ({ transform: [{ scale: basketBounce.value }] }));

  return (
    <View style={styles.wrap}>
      <View style={styles.itemsLayer}>
        {ITEMS.map((item, i) => (
          <FallingItem key={i} {...item} reducedMotion={reducedMotion} />
        ))}
      </View>
      <Animated.View style={[styles.basketCircle, basketStyle]}>
        <ShoppingBasket size={40} color={colors.primary} strokeWidth={1.8} />
      </Animated.View>
    </View>
  );
}

export function EmptyCartCopy() {
  return (
    <View style={styles.copyWrap}>
      <Text style={styles.title}>Your basket is waiting</Text>
      <Text style={styles.subtitle}>Add something delicious from Govind Pansari.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 132, height: 132, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  itemsLayer: { position: 'absolute', width: 1, height: 1, alignItems: 'center', justifyContent: 'center' },
  item: { position: 'absolute' },
  basketCircle: {
    width: 112, height: 112, borderRadius: 56, backgroundColor: colors.goldTint,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.gold,
  },
  copyWrap: { alignItems: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.xl },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...textStyles.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
});
