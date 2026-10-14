import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInDown, SlideOutDown, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { ArrowRight, ShoppingBag } from 'lucide-react-native';
import { router } from 'expo-router';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { spring } from '../../theme/motion';
import { formatINR } from '../ui/PriceBlock';
import { AnimatedNumber } from '../motion/AnimatedNumber';
import { useCartLines } from '../../hooks/useCartLines';
import { useCartFlyStore } from '../../store/cartFlyStore';

/** Section 8 — the bag reads as more "full" the more it holds: a light tier (1-2), a fuller tier (3-5), and a clearly-loaded tier (6+). Subtle scale + a soft ring, never a literal cartoon bag shape. */
function tierFor(count: number): 0 | 1 | 2 {
  if (count >= 6) return 2;
  if (count >= 3) return 1;
  return 0;
}
const TIER_SCALE = [1, 1.08, 1.16] as const;
const TIER_RING_OPACITY = [0, 0.22, 0.4] as const;

export function FloatingCartBar() {
  const { totalCount, itemTotal, amountToFreeDelivery, savings } = useCartLines();
  const pulseTrigger = useCartFlyStore((s) => s.pulseTrigger);
  const bagScale = useSharedValue(1);
  const tier = tierFor(totalCount);
  const tierScale = useSharedValue(TIER_SCALE[tier]);
  const ringOpacity = useSharedValue(TIER_RING_OPACITY[tier]);

  // Fires when the fly-to-cart animation lands (store/cartFlyStore.ts) —
  // a quick highlight bump so the bag visibly "receives" the item.
  useEffect(() => {
    if (pulseTrigger === 0) return;
    bagScale.value = withSequence(withTiming(1.3, { duration: 120 }), withTiming(1, { duration: 180 }));
  }, [pulseTrigger, bagScale]);

  useEffect(() => {
    tierScale.value = withSpring(TIER_SCALE[tier], spring.gentle);
    ringOpacity.value = withTiming(TIER_RING_OPACITY[tier], { duration: 260 });
  }, [tier, tierScale, ringOpacity]);

  const bagStyle = useAnimatedStyle(() => ({ transform: [{ scale: bagScale.value * tierScale.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringOpacity.value }));

  if (totalCount === 0) return null;

  return (
    <Animated.View entering={SlideInDown.springify().damping(18)} exiting={SlideOutDown.duration(200)}>
      <Pressable style={styles.bar} onPress={() => router.push('/cart')}>
        <View style={styles.bagWrap}>
          <Animated.View style={[styles.fullnessRing, ringStyle]} />
          <Animated.View style={bagStyle}>
            <ShoppingBag size={ICON_SIZE.md} color={colors.white} strokeWidth={ICON_STROKE} />
          </Animated.View>
          <View style={styles.countBadge}>
            <AnimatedNumber value={String(totalCount)} style={styles.countBadgeText} />
          </View>
        </View>
        <View style={styles.textBlock}>
          <Text style={styles.summary}>
            {totalCount} {totalCount === 1 ? 'item' : 'items'} • {formatINR(itemTotal)}
          </Text>
          <Text style={styles.subtext} numberOfLines={1}>
            {amountToFreeDelivery > 0
              ? `Add ${formatINR(amountToFreeDelivery)} more for FREE delivery`
              : savings > 0
                ? `You saved ${formatINR(savings)}`
                : 'Free delivery unlocked'}
          </Text>
        </View>
        <View style={styles.cta}>
          <Text style={styles.ctaText}>View Cart</Text>
          <ArrowRight size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    marginHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    ...shadows.floating,
  },
  bagWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center' },
  fullnessRing: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.gold,
  },
  countBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  countBadgeText: { fontSize: 10, fontFamily: 'PlusJakartaSans_700Bold', color: colors.primaryDarker },
  textBlock: { flex: 1 },
  summary: { ...textStyles.cardTitle, color: colors.white, fontSize: 14 },
  subtext: { ...textStyles.caption, color: colors.goldTint, fontSize: 11.5 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ctaText: { ...textStyles.button, color: colors.white, fontSize: 13 },
});
