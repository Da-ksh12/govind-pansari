import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../components/layout/SafeBottomSpacer';
import { ProductRail } from '../components/product/ProductRail';
import { useAsync } from '../hooks/useAsync';
import { productRepository } from '../services/repositories/productRepository';
import { categoryImg } from '../data/images';

const WIDE_BREAKPOINT = 900;
const WIDE_CONTENT_MAX_WIDTH = 1100;

const GIFT_CATEGORIES = [
  { label: 'Wedding', keyword: 'wedding gift hamper' },
  { label: 'Diwali', keyword: 'diwali gift hamper' },
  { label: 'Festivals', keyword: 'festival gift hamper' },
  { label: 'Corporate', keyword: 'corporate gift hamper' },
  { label: 'Birthday', keyword: 'birthday gift hamper' },
  { label: 'Custom Box', keyword: 'custom gift box' },
];

export default function GiftingScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const { data: hampers } = useAsync(() => productRepository.listGiftHampers(), []);

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Gifting</Text>
          <Text style={styles.headerSubtitle}>A premium catalogue for every occasion</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={isWide && styles.scrollContentWide}>
        <View style={isWide && styles.wideInner}>
          <View style={styles.grid}>
            {GIFT_CATEGORIES.map((c) => (
              <Pressable key={c.label} style={styles.card} onPress={() => router.push('/category/gift-hampers')}>
                <Image source={{ uri: categoryImg(c.keyword, c.label.length) }} style={StyleSheet.absoluteFill} contentFit="cover" />
                <View style={styles.cardOverlay} />
                <Text style={styles.cardLabel}>{c.label}</Text>
              </Pressable>
            ))}
          </View>

          <View style={{ marginTop: spacing.xl }}>
            <ProductRail title="Signature Hampers" products={hampers ?? []} />
          </View>

          <Pressable style={styles.customBanner} onPress={() => router.push('/build-your-box')}>
            <View style={{ flex: 1 }}>
              <Text style={styles.customTitle}>Can't find the perfect fit?</Text>
              <Text style={styles.customSubtitle}>Build a custom dry fruit box tailored to your occasion.</Text>
            </View>
            <View style={styles.customCta}>
              <Text style={styles.customCtaText}>Build Now</Text>
            </View>
          </Pressable>

          <SafeBottomSpacer />
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  headerSubtitle: { ...textStyles.caption, color: colors.textSecondary },
  // Same wide-viewport centering fix as category/[slug].tsx — the whole
  // scroll content (grid + hampers rail + custom-box banner) rendered
  // unconstrained-width and left-packed on a wide screen otherwise.
  scrollContentWide: { alignItems: 'center' },
  wideInner: { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingHorizontal: spacing.base },
  card: { width: '47%', height: 110, borderRadius: radius.md, overflow: 'hidden', justifyContent: 'flex-end', padding: spacing.sm },
  cardOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(36,21,18,0.4)' },
  cardLabel: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 16, color: colors.white },
  customBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryDarker,
    borderRadius: radius.md,
    padding: spacing.base,
    marginHorizontal: spacing.base,
    marginTop: spacing.xl,
  },
  customTitle: { ...textStyles.cardTitle, color: colors.white, fontSize: 15 },
  customSubtitle: { ...textStyles.caption, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  customCta: { backgroundColor: colors.gold, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  customCtaText: { ...textStyles.button, color: colors.primaryDarker, fontSize: 12.5 },
});
