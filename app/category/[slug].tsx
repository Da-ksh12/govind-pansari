import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Check, Search, ShoppingBag, SlidersHorizontal } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { AppImage } from '../../components/ui/AppImage';
import { ProductCard } from '../../components/product/ProductCard';
import { TrustBadgeRow } from '../../components/ui/TrustBadgeRow';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProductGridSkeleton } from '../../components/skeletons/ProductGridSkeleton';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { useAsync } from '../../hooks/useAsync';
import { categoryRepository } from '../../services/repositories/categoryRepository';
import { productRepository } from '../../services/repositories/productRepository';
import { useCartLines } from '../../hooks/useCartLines';
import type { Product } from '../../types/models';

const TABS = ['Bestsellers', 'Premium', 'New', 'All'] as const;
const WIDE_BREAKPOINT = 900;
const WIDE_CONTENT_MAX_WIDTH = 1100;

type SortOption = 'default' | 'price_low' | 'price_high' | 'name';

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'default', label: 'Recommended' },
  { key: 'price_low', label: 'Price: Low to High' },
  { key: 'price_high', label: 'Price: High to Low' },
  { key: 'name', label: 'Name (A-Z)' },
];

function defaultVariant(p: Product) {
  return p.variants.find((v) => v.id === p.defaultVariantId) ?? p.variants[0];
}

export default function CategoryDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const [tab, setTab] = useState<(typeof TABS)[number]>('All');
  const { totalCount } = useCartLines();
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [draftSortBy, setDraftSortBy] = useState<SortOption>('default');
  const [draftOnlyInStock, setDraftOnlyInStock] = useState(false);

  const activeFilterCount = (sortBy !== 'default' ? 1 : 0) + (onlyInStock ? 1 : 0);

  const openFilterSheet = () => {
    setDraftSortBy(sortBy);
    setDraftOnlyInStock(onlyInStock);
    setFilterSheetOpen(true);
  };

  const applyFilterSheet = () => {
    setSortBy(draftSortBy);
    setOnlyInStock(draftOnlyInStock);
    setFilterSheetOpen(false);
  };

  const resetFilterSheet = () => {
    setDraftSortBy('default');
    setDraftOnlyInStock(false);
  };

  const { data, loading, error, reload } = useAsync(async () => {
    const category = await categoryRepository.getBySlug(slug);
    if (!category) return null;
    const products = await productRepository.listByCategory(category.id);
    return { category, products };
  }, [slug]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.products;
    if (tab === 'Bestsellers') list = list.filter((p) => p.badges.includes('bestseller'));
    else if (tab === 'Premium') list = list.filter((p) => p.badges.includes('premium'));
    else if (tab === 'New') list = list.filter((p) => p.badges.includes('new'));
    if (onlyInStock) list = list.filter((p) => defaultVariant(p)?.stockStatus !== 'out_of_stock');
    if (sortBy === 'price_low') list = [...list].sort((a, b) => (defaultVariant(a)?.price ?? 0) - (defaultVariant(b)?.price ?? 0));
    else if (sortBy === 'price_high') list = [...list].sort((a, b) => (defaultVariant(b)?.price ?? 0) - (defaultVariant(a)?.price ?? 0));
    else if (sortBy === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [data, tab, sortBy, onlyInStock]);

  if (!data) {
    if (loading) return <SafeScreen><ProductGridSkeleton withHero /></SafeScreen>;
    return (
      <SafeScreen>
        <EmptyState
          title={error ? "Couldn't load this category" : 'Category not found'}
          subtitle={error ? 'Check your connection and try again.' : "This category doesn't exist."}
          ctaLabel={error ? 'Retry' : undefined}
          onPressCta={error ? reload : undefined}
        />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={isWide && styles.scrollContentWide}>
        <View style={[styles.heroWrap, isWide && styles.heroWrapWide]}>
          <AppImage uri={data.category.heroImage} style={styles.heroImage} contentFit="cover" fallbackIcon={ShoppingBag} borderRadius={0} />
          <View style={styles.heroTopBar}>
            <Pressable style={styles.circleButton} onPress={() => router.back()}>
              <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Pressable style={styles.circleButton} onPress={() => router.push('/(tabs)/search')}>
                <Search size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
              </Pressable>
              <Pressable style={styles.circleButton} onPress={() => router.push('/cart')}>
                <ShoppingBag size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
                {totalCount > 0 && (
                  <View style={styles.cartBadge}>
                    <Text style={styles.cartBadgeText}>{totalCount}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>
        </View>

        <View style={isWide && styles.wideInner}>
          <View style={[styles.content, isWide && styles.contentWide]}>
            <Text style={styles.title}>{data.category.name}</Text>
            {data.category.description && <Text style={styles.subtitle}>{data.category.description}</Text>}

            <TrustBadgeRow />

            <View style={styles.tabsRow}>
              {TABS.map((t) => {
                const active = t === tab;
                return (
                  <Pressable key={t} style={[styles.tab, active && styles.tabActive]} onPress={() => setTab(t)}>
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>{t}</Text>
                  </Pressable>
                );
              })}
              <Pressable style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]} onPress={openFilterSheet}>
                <SlidersHorizontal size={ICON_SIZE.sm} color={activeFilterCount > 0 ? colors.white : colors.primary} strokeWidth={ICON_STROKE} />
                {activeFilterCount > 0 && <Text style={styles.filterBtnBadgeText}>{activeFilterCount}</Text>}
              </Pressable>
            </View>

            <Text style={styles.countText}>{filtered.length} items found</Text>

            {filtered.length === 0 ? (
              <EmptyState title="No products match" subtitle="Try a different tab or clear your filters." ctaLabel={activeFilterCount > 0 ? 'Clear Filters' : undefined} onPressCta={activeFilterCount > 0 ? () => { setSortBy('default'); setOnlyInStock(false); } : undefined} />
            ) : (
              <View style={[styles.grid, isWide && styles.gridWide]}>
                {filtered.map((p) => (
                  <ProductCard key={p.id} product={p} width={168} />
                ))}
              </View>
            )}
          </View>
        </View>

        <View style={{ height: 140 }} />
      </ScrollView>

      <BottomSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filter & Sort"
        footer={
          <>
            <Pressable style={styles.resetBtn} onPress={resetFilterSheet}>
              <Text style={styles.resetBtnText}>Reset</Text>
            </Pressable>
            <Pressable style={styles.applyBtn} onPress={applyFilterSheet}>
              <Text style={styles.applyBtnText}>Apply</Text>
            </Pressable>
          </>
        }
      >
        <View>
          <Text style={styles.sheetSectionTitle}>Sort By</Text>
          {SORT_OPTIONS.map((opt) => (
            <Pressable key={opt.key} style={styles.sheetOptionRow} onPress={() => setDraftSortBy(opt.key)}>
              <Text style={styles.sheetOptionText}>{opt.label}</Text>
              <View style={[styles.radio, draftSortBy === opt.key && styles.radioActive]}>
                {draftSortBy === opt.key && <Check size={12} color={colors.white} strokeWidth={ICON_STROKE} />}
              </View>
            </Pressable>
          ))}
        </View>
        <View>
          <Text style={styles.sheetSectionTitle}>Availability</Text>
          <Pressable style={styles.sheetOptionRow} onPress={() => setDraftOnlyInStock((v) => !v)}>
            <Text style={styles.sheetOptionText}>In stock only</Text>
            <View style={[styles.checkbox, draftOnlyInStock && styles.checkboxActive]}>
              {draftOnlyInStock && <Check size={12} color={colors.white} strokeWidth={ICON_STROKE} />}
            </View>
          </Pressable>
        </View>
      </BottomSheet>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  // On a wide viewport, everything below the hero was rendering
  // unconstrained-width and left-packed (no maxWidth, no centering) —
  // the exact same pattern Home (app/(tabs)/index.tsx) already solves
  // with isWide/wideInner/WIDE_CONTENT_MAX_WIDTH, replicated here.
  scrollContentWide: { alignItems: 'center' },
  heroWrap: { position: 'relative' },
  heroWrapWide: { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH, alignSelf: 'center' },
  wideInner: { width: '100%', maxWidth: WIDE_CONTENT_MAX_WIDTH },
  contentWide: { paddingHorizontal: spacing.xl },
  gridWide: { justifyContent: 'flex-start' },
  heroImage: { width: '100%', height: 190, backgroundColor: colors.surfaceSunken },
  heroTopBar: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.base,
    right: spacing.base,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  circleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadge: { position: 'absolute', top: -3, right: -3, backgroundColor: colors.primary, borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  cartBadgeText: { fontSize: 9, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  content: { paddingHorizontal: spacing.base, paddingTop: spacing.lg },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.textPrimary },
  subtitle: { ...textStyles.body, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  tabsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
  tab: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { ...textStyles.bodySmall, color: colors.textPrimary },
  tabTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_600SemiBold' },
  filterBtn: { marginLeft: 'auto', width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterBtnBadgeText: { position: 'absolute', top: -2, right: -2, fontSize: 9, color: colors.white, backgroundColor: colors.terracotta, borderRadius: 7, minWidth: 14, height: 14, textAlign: 'center', lineHeight: 14, overflow: 'hidden' },
  countText: { ...textStyles.bodySmall, color: colors.textSecondary, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  sheetSectionTitle: { ...textStyles.cardTitle, fontSize: 13, color: colors.textSecondary, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.4 },
  sheetOptionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  sheetOptionText: { ...textStyles.body, color: colors.textPrimary, flex: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  radioActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  resetBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  resetBtnText: { ...textStyles.button, color: colors.textPrimary, fontSize: 14 },
  applyBtn: { flex: 1.5, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  applyBtnText: { ...textStyles.button, color: colors.white, fontSize: 14 },
});
