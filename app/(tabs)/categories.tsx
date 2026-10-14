import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Check, ChevronRight, LayoutGrid, Search, SlidersHorizontal, WifiOff, X } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { AppImage } from '../../components/ui/AppImage';
import { EmptyState } from '../../components/ui/EmptyState';
import { TrustBadgeRow } from '../../components/ui/TrustBadgeRow';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { AnimatedPressable } from '../../components/motion/AnimatedPressable';
import { useAsync } from '../../hooks/useAsync';
import { categoryRepository } from '../../services/repositories/categoryRepository';
import { categoryImg } from '../../data/images';
import type { Category } from '../../types/models';

const QUICK_FILTERS = ['All Categories', 'Dry Fruits', 'Spices', 'Gift Hampers', 'Tea'];
const WIDE_BREAKPOINT = 900;
const WIDE_CONTENT_MAX_WIDTH = 1100;

type SortOption = 'default' | 'name' | 'itemCount';

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'default', label: 'Recommended' },
  { key: 'name', label: 'Name (A-Z)' },
  { key: 'itemCount', label: 'Most Products' },
];

export default function CategoriesScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All Categories');
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [onlyWithProducts, setOnlyWithProducts] = useState(false);
  const [draftSortBy, setDraftSortBy] = useState<SortOption>('default');
  const [draftOnlyWithProducts, setDraftOnlyWithProducts] = useState(false);
  const { data: categories, loading, error, reload } = useAsync<Category[]>(() => categoryRepository.list(), []);

  const activeFilterCount = (sortBy !== 'default' ? 1 : 0) + (onlyWithProducts ? 1 : 0);

  const openFilterSheet = () => {
    setDraftSortBy(sortBy);
    setDraftOnlyWithProducts(onlyWithProducts);
    setFilterSheetOpen(true);
  };

  const applyFilterSheet = () => {
    setSortBy(draftSortBy);
    setOnlyWithProducts(draftOnlyWithProducts);
    setFilterSheetOpen(false);
  };

  const resetFilterSheet = () => {
    setDraftSortBy('default');
    setDraftOnlyWithProducts(false);
  };

  const filtered = useMemo(() => {
    let list = categories ?? [];
    const dryFruits = list.find((c) => c.slug === 'dry-fruits');
    if (activeFilter === 'Dry Fruits') list = list.filter((c) => c.slug === 'dry-fruits' || (dryFruits && c.parentId === dryFruits.id));
    else if (activeFilter === 'Spices') list = list.filter((c) => c.slug === 'spices-masalas');
    else if (activeFilter === 'Gift Hampers') list = list.filter((c) => c.slug === 'gift-hampers');
    else if (activeFilter === 'Tea') list = list.filter((c) => c.slug === 'tea');
    if (query.trim()) list = list.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()));
    if (onlyWithProducts) list = list.filter((c) => c.itemCount > 0);
    if (sortBy === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'itemCount') list = [...list].sort((a, b) => b.itemCount - a.itemCount);
    return list;
  }, [categories, activeFilter, query, sortBy, onlyWithProducts]);

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={[styles.content, isWide && styles.contentWide]} showsVerticalScrollIndicator={false}>
        <View style={isWide && styles.wideInner}>
        <Text style={styles.title}>Categories</Text>
        <Text style={styles.subtitle}>Explore our wide range of premium products</Text>

        <View style={styles.searchRow}>
          <View style={styles.searchBox}>
            <Search size={ICON_SIZE.md} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search for almonds, cashews, raisins..."
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.primary}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => {
                const q = query.trim();
                if (q) router.push(`/(tabs)/search?q=${encodeURIComponent(q)}`);
              }}
              returnKeyType="search"
              textAlignVertical="center"
              multiline={false}
              numberOfLines={1}
            />
            {!!query && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <X size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
              </Pressable>
            )}
          </View>
          <Pressable
            style={[styles.filterButton, activeFilterCount > 0 && styles.filterButtonActive]}
            onPress={openFilterSheet}
          >
            <SlidersHorizontal size={ICON_SIZE.sm} color={activeFilterCount > 0 ? colors.white : colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={[styles.filterButtonText, activeFilterCount > 0 && styles.filterButtonTextActive]}>
              {activeFilterCount > 0 ? `Filter • ${activeFilterCount}` : 'Filter'}
            </Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {QUICK_FILTERS.map((f) => {
            const active = f === activeFilter;
            return (
              <Pressable key={f} onPress={() => setActiveFilter(f)} style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Shop by Category</Text>
          {!loading && !error && <Text style={styles.countText}>{filtered.length} Categories</Text>}
        </View>

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : error ? (
          <EmptyState
            icon={WifiOff}
            title="Couldn't load categories"
            subtitle={error.message || 'Please check your connection and try again.'}
            ctaLabel="Retry"
            onPressCta={reload}
          />
        ) : filtered.length === 0 ? (
          <EmptyState icon={LayoutGrid} title="No categories found" subtitle="Try a different search or filter." />
        ) : (
        <View style={styles.grid}>
          {filtered.map((cat) => (
            <AnimatedPressable key={cat.id} style={styles.gridCard} pressScale={0.95} onPress={() => router.push(`/category/${cat.slug}`)}>
              <AppImage uri={cat.thumbnail} style={styles.gridImage} contentFit="cover" fallbackIcon={LayoutGrid} />
              <View style={styles.gridFooter}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.gridName}>{cat.name}</Text>
                  <Text style={styles.gridCount}>{cat.itemCount} Products</Text>
                </View>
                <View style={styles.gridArrow}>
                  <ChevronRight size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                </View>
              </View>
            </AnimatedPressable>
          ))}
        </View>
        )}

        <Pressable style={styles.hamperBanner} onPress={() => router.push('/category/gift-hampers')}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hamperTitle}>Premium Gift Hampers</Text>
            <Text style={styles.hamperSubtitle}>Curated with love & premium ingredients</Text>
            <View style={styles.hamperCta}>
              <Text style={styles.hamperCtaText}>Explore Hampers</Text>
              <ChevronRight size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
            </View>
          </View>
          <Image source={{ uri: categoryImg('gift hamper luxury box', 51) }} style={styles.hamperImage} contentFit="cover" />
        </Pressable>

        <View style={{ height: spacing.lg }} />
        <TrustBadgeRow />
        <View style={{ height: 130 }} />
        </View>
      </ScrollView>

      <BottomSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        title="Filter Categories"
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
          <Pressable style={styles.sheetOptionRow} onPress={() => setDraftOnlyWithProducts((v) => !v)}>
            <Text style={styles.sheetOptionText}>Only show categories with products</Text>
            <View style={[styles.checkbox, draftOnlyWithProducts && styles.checkboxActive]}>
              {draftOnlyWithProducts && <Check size={12} color={colors.white} strokeWidth={ICON_STROKE} />}
            </View>
          </Pressable>
        </View>
      </BottomSheet>
    </SafeScreen>
  );
}

const GRID_GAP = spacing.md;

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.base, paddingTop: spacing.md },
  // Same fix, same bug class, as app/category/[slug].tsx — no maxWidth
  // constraint meant the 48%-width grid cards grew unboundedly large
  // on a wide viewport instead of the page just centering as a block.
  contentWide: { alignItems: 'center' },
  wideInner: { width: '100%', maxWidth: 1100 },
  centerFill: { paddingVertical: spacing.xxl, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.textPrimary },
  subtitle: { ...textStyles.body, color: colors.textSecondary, marginTop: 2 },
  searchRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    height: 46,
    overflow: 'hidden',
  },
  searchInput: { flex: 1, height: '100%', ...textStyles.bodySmall, color: colors.textPrimary, padding: 0, margin: 0, includeFontPadding: false },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  filterButtonText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  filterButtonActive: { backgroundColor: colors.primary },
  filterButtonTextActive: { color: colors.white },
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
  chipsRow: { gap: spacing.sm, paddingVertical: spacing.lg },
  chip: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...textStyles.bodySmall, color: colors.textPrimary },
  chipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_600SemiBold' },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  sectionTitle: { ...textStyles.sectionTitle, color: colors.textPrimary },
  countText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gridCard: {
    width: '48%',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadows.sm,
  },
  gridImage: { width: '100%', aspectRatio: 1.3, backgroundColor: colors.surfaceSunken },
  gridFooter: { flexDirection: 'row', alignItems: 'center', padding: spacing.sm, gap: spacing.xs },
  gridName: { ...textStyles.cardTitle, color: colors.textPrimary, fontSize: 14 },
  gridCount: { ...textStyles.caption, color: colors.textSecondary },
  gridArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hamperBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.goldTint,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginTop: spacing.xl,
    minHeight: 120,
  },
  hamperTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 19, color: colors.primaryDarker, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  hamperSubtitle: { ...textStyles.bodySmall, color: colors.textSecondary, paddingHorizontal: spacing.lg, marginTop: 2 },
  hamperCta: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primary, alignSelf: 'flex-start', marginHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill },
  hamperCtaText: { ...textStyles.button, color: colors.white, fontSize: 12.5 },
  hamperImage: { width: 110, height: 120 },
});
