import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { router } from 'expo-router';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { AppImage } from '../ui/AppImage';
import { ProductBadgePill } from '../ui/Badge';
import { PriceBlock } from '../ui/PriceBlock';
import { Rating } from '../ui/Rating';
import { AddToCartControl } from '../ui/AddToCartControl';
import { AnimatedWishlistHeart } from '../motion/AnimatedWishlistHeart';
import { useWishlistStore } from '../../store/wishlistStore';
import type { Product } from '../../types/models';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface ProductCardProps {
  product: Product;
  width?: number;
}

export function ProductCard({ product, width = 168 }: ProductCardProps) {
  const variant = product.variants.find((v) => v.id === product.defaultVariantId) ?? product.variants[0];
  const isWishlisted = useWishlistStore((s) => s.isWishlisted(product.id));
  const toggleWishlist = useWishlistStore((s) => s.toggle);

  const scale = useSharedValue(1);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => router.push(`/product/${product.slug}`);
  const handleWishlist = () => toggleWishlist(product.id);

  const outOfStock = variant?.stockStatus === 'out_of_stock';

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={() => (scale.value = withSpring(0.97, { damping: 18, stiffness: 260 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 18, stiffness: 260 }))}
      style={[styles.card, { width }, cardStyle]}
    >
      <View style={styles.imageWrap}>
        <AppImage uri={product.images[0]} style={styles.image} contentFit="cover" kind="product" borderRadius={0} />
        {product.badges[0] && (
          <View style={styles.badgeSlot}>
            <ProductBadgePill kind={product.badges[0]} />
          </View>
        )}
        <View style={styles.heartSlot}>
          <AnimatedWishlistHeart active={isWishlisted} onToggle={handleWishlist} size={28} iconSize={14} />
        </View>
        {outOfStock && (
          <View style={styles.oosOverlay}>
            <Text style={styles.oosText}>Out of Stock</Text>
          </View>
        )}
      </View>

      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.name}>
          {product.name}
        </Text>
        <Text numberOfLines={1} style={styles.descriptor}>
          {product.descriptor}
        </Text>
        <View style={styles.metaRow}>
          <Rating value={product.rating} count={product.reviewCount} />
          <Text style={styles.weight}>{variant?.label}</Text>
        </View>
        <View style={styles.priceSlot}>
          <PriceBlock price={variant?.price ?? 0} mrp={variant?.mrp} />
        </View>
        <View style={styles.addSlot}>
          <AddToCartControl productId={product.id} variantId={variant?.id ?? ''} disabled={outOfStock} imageUri={product.images[0]} />
        </View>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadows.sm,
  },
  imageWrap: {
    width: '100%',
    position: 'relative',
  },
  image: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: colors.surfaceSunken,
  },
  badgeSlot: { position: 'absolute', top: spacing.sm, left: spacing.sm },
  heartSlot: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  oosOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlaySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oosText: {
    ...textStyles.caption,
    color: colors.white,
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.xs,
  },
  body: { padding: spacing.sm, gap: 4 },
  name: { ...textStyles.cardTitle, color: colors.textPrimary },
  descriptor: { ...textStyles.caption, color: colors.textSecondary, fontSize: 11.5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  weight: { ...textStyles.caption, color: colors.textSecondary },
  // Reserves the same vertical space whether or not this specific
  // product has a discount (PriceBlock wraps to a 2nd line only when
  // showing a strike-through MRP + "% OFF") — without this, cards with
  // no discount are shorter than their neighbours in the same rail, so
  // the Add button below ends up at a different height card to card.
  priceSlot: { minHeight: 44, justifyContent: 'center' },
  addSlot: { marginTop: spacing.xs },
});
