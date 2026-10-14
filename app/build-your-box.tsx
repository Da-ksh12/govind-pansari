import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { ArrowLeft, Gift, PackageCheck } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SafeScreen } from '../components/layout/SafeScreen';
import { AppImage } from '../components/ui/AppImage';
import { AddToCartControl } from '../components/ui/AddToCartControl';
import { formatINR } from '../components/ui/PriceBlock';
import { useCartStore } from '../store/cartStore';
import { useAsync } from '../hooks/useAsync';
import { productRepository } from '../services/repositories/productRepository';
import { categoryImg } from '../data/images';
import type { Product } from '../types/models';

const BOX_CAPACITY_G = 2000;

export default function BuildYourBoxScreen() {
  const insets = useSafeAreaInsets();
  const items = useCartStore((s) => s.items);
  // Products eligible for the box are tagged 'diy-box' in the catalogue
  // (see supabase/seed) rather than a hardcoded id list — curated by
  // whoever manages the catalogue, not baked into the app.
  const { data: boxProducts } = useAsync<Product[]>(() => productRepository.listByTag('diy-box'), []);

  const { totalGrams, totalPrice, totalMrp, selectedCount } = useMemo(() => {
    let grams = 0;
    let price = 0;
    let mrp = 0;
    let count = 0;
    for (const product of boxProducts ?? []) {
      const variant = product.variants.find((v) => v.id === product.defaultVariantId);
      if (!variant) continue;
      const qty = items.find((i) => i.variantId === variant.id && !i.savedForLater)?.quantity ?? 0;
      if (qty === 0) continue;
      count += 1;
      const grams_ = variant.weightUnit === 'kg' ? variant.weightValue * 1000 : variant.weightValue;
      grams += grams_ * qty;
      price += variant.price * qty;
      mrp += variant.mrp * qty;
    }
    return { totalGrams: grams, totalPrice: price, totalMrp: mrp, selectedCount: count };
  }, [items, boxProducts]);

  const fillRatio = Math.min(1, totalGrams / BOX_CAPACITY_G);

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Build Your Own Box</Text>
          <Text style={styles.headerSubtitle}>Pick your favourites & create a perfect gift box</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.boxHero}>
          <Image source={{ uri: categoryImg('premium wooden gift box dry fruits open', 61) }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <View style={styles.boxHeroOverlay} />
          <View style={styles.capacityWrap}>
            <View style={styles.capacityHeaderRow}>
              <Text style={styles.capacityLabel}>Box Capacity</Text>
              <Text style={styles.capacityValue}>
                {totalGrams} g / {BOX_CAPACITY_G} g
              </Text>
            </View>
            <View style={styles.capacityTrack}>
              <View style={[styles.capacityFill, { width: `${fillRatio * 100}%` }]} />
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Choose Your Ingredients</Text>
        <View style={styles.ingredientList}>
          {(boxProducts ?? []).map((product) => {
            const variant = product.variants.find((v) => v.id === product.defaultVariantId)!;
            const qty = items.find((i) => i.variantId === variant.id && !i.savedForLater)?.quantity ?? 0;
            return (
              <Animated.View key={product.id} entering={FadeIn.duration(200)} style={[styles.ingredientRow, qty > 0 && styles.ingredientRowActive]}>
                <AppImage uri={product.images[0]} style={styles.ingredientImage} contentFit="cover" kind="product" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.ingredientName}>{product.name}</Text>
                  <Text style={styles.ingredientMeta}>
                    {variant.label} • {formatINR(variant.price)}
                  </Text>
                </View>
                <AddToCartControl productId={product.id} variantId={variant.id} imageUri={product.images[0]} />
              </Animated.View>
            );
          })}
        </View>

        {selectedCount > 0 && (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <PackageCheck size={ICON_SIZE.md} color={colors.success} strokeWidth={ICON_STROKE} />
              <Text style={styles.summaryText}>
                {selectedCount} ingredient{selectedCount > 1 ? 's' : ''} selected • {totalGrams} g total
              </Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryPriceRow}>
              <Text style={styles.summaryPriceLabel}>Box Total</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.summaryPrice}>{formatINR(totalPrice)}</Text>
                {totalMrp > totalPrice && <Text style={styles.summarySavings}>You save {formatINR(totalMrp - totalPrice)}</Text>}
              </View>
            </View>
          </View>
        )}

        <View style={{ height: 140 }} />
      </ScrollView>

      <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, spacing.base) }]}>
        <Pressable
          style={[styles.createBtn, { opacity: selectedCount > 0 ? 1 : 0.5 }]}
          disabled={selectedCount === 0}
          onPress={() => router.push('/cart')}
        >
          <Gift size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
          <Text style={styles.createBtnText}>Create My Box{selectedCount > 0 ? ` — ${formatINR(totalPrice)}` : ''}</Text>
        </Pressable>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 19, color: colors.textPrimary },
  headerSubtitle: { ...textStyles.caption, color: colors.textSecondary },
  content: { paddingHorizontal: spacing.base },
  boxHero: { height: 170, borderRadius: radius.lg, overflow: 'hidden', justifyContent: 'flex-end' },
  boxHeroOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(36,21,18,0.5)' },
  capacityWrap: { padding: spacing.base },
  capacityHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  capacityLabel: { ...textStyles.bodySmall, color: colors.white, fontFamily: 'PlusJakartaSans_600SemiBold' },
  capacityValue: { ...textStyles.bodySmall, color: colors.goldTint },
  capacityTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  capacityFill: { height: '100%', backgroundColor: colors.gold, borderRadius: 4 },
  sectionTitle: { ...textStyles.sectionTitle, fontSize: 16, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  ingredientList: { gap: spacing.sm },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1.5,
    borderColor: 'transparent',
    ...shadows.xs,
  },
  ingredientRowActive: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  ingredientImage: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  ingredientName: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  ingredientMeta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  summaryCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginTop: spacing.xl, ...shadows.sm },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summaryText: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  summaryDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  summaryPriceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryPriceLabel: { ...textStyles.cardTitle, color: colors.textPrimary },
  summaryPrice: { ...textStyles.priceLarge, color: colors.textPrimary },
  summarySavings: { ...textStyles.caption, color: colors.success },
  stickyBar: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.background, padding: spacing.base, borderTopWidth: 1, borderTopColor: colors.border },
  createBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, height: 54 },
  createBtnText: { ...textStyles.button, color: colors.white, fontSize: 15 },
});
