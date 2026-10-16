import React, { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Clock, LayoutGrid, X } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { motionDuration } from '../../theme/motion';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { SearchBar } from '../../components/home/SearchBar';
import { ProductCard } from '../../components/product/ProductCard';
import { ProductRail } from '../../components/product/ProductRail';
import { AppImage } from '../../components/ui/AppImage';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { AnimatedPressable } from '../../components/motion/AnimatedPressable';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { productRepository } from '../../services/repositories/productRepository';
import { categoryRepository } from '../../services/repositories/categoryRepository';
import { useAsync } from '../../hooks/useAsync';
import { useRecentSearchesStore } from '../../store/recentSearchesStore';
import type { Category, Product } from '../../types/models';

const WIDE_BREAKPOINT = 900;
const SEARCH_DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const { q, autoFocus } = useLocalSearchParams<{ q?: string; autoFocus?: string }>();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const reducedMotion = useReducedMotion();
  const searchInputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState(q ?? '');
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  // null = "All". Filters the already-fetched, already-serviceability-
  // checked results client-side by category — a real subset of a real
  // search, not a second query or invented data.
  const [categoryFilterId, setCategoryFilterId] = useState<string | null>(null);
  const recent = useRecentSearchesStore((s) => s.terms);
  const addRecentSearch = useRecentSearchesStore((s) => s.add);
  const removeRecentSearch = useRecentSearchesStore((s) => s.remove);
  const clearRecentSearches = useRecentSearchesStore((s) => s.clear);
  const { data: categories } = useAsync<Category[]>(() => categoryRepository.listTopLevel(), []);
  // Real "Popular Right Now" — sourced from the same is_bestseller tag
  // the rest of the app uses, never an invented popularity ranking.
  const { data: popularProducts } = useAsync<Product[]>(() => productRepository.listBestsellers(), []);

  // A header search box on desktop (DesktopHeader) hands off here via a
  // `q` route param — pick it up if it changes while this screen is
  // already mounted (e.g. searching again from the header while on
  // this page).
  useEffect(() => {
    if (q && q !== query) setQuery(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // Root cause of "keyboard doesn't reliably open" (for the cases that
  // DO want it to open automatically): this screen used to rely solely
  // on TextInput's `autoFocus` prop, which fires at mount time — often
  // *during* the screen's own slide-in transition, before the native
  // input is actually attached/laid out in the window, so Android
  // silently drops the focus() call. useFocusEffect fires once this
  // screen is genuinely the active one, and
  // InteractionManager.runAfterInteractions defers the actual .focus()
  // call until any in-flight animation/gesture has finished — a real
  // React Native API built for exactly this ordering problem.
  //
  // This only runs for navigations that explicitly asked for it (the
  // `autoFocus=1` param, set by the Home search teaser and the category
  // page's search icon — real "I want to type now" gestures). A plain
  // tap on the bottom tab bar's Search icon carries no such param, so it
  // lands with no keyboard: auto-opening the keyboard the instant that
  // tab becomes active was the actual cause of a reported "search bar
  // jumps right after navigating" bug — the immediate keyboard pop
  // forces an abrupt Android window resize right as the screen appears.
  // The param is cleared via setParams right after consuming it, so
  // returning to an already-open Search tab (back button, re-tapping the
  // tab) never re-triggers it.
  useFocusEffect(
    useCallback(() => {
      if (isWide || autoFocus !== '1') return;
      const task = InteractionManager.runAfterInteractions(() => {
        searchInputRef.current?.focus();
        router.setParams({ autoFocus: undefined });
      });
      return () => task.cancel();
    }, [isWide, autoFocus]),
  );

  // Debounced live suggestions (section 9) — waits for typing to pause
  // instead of firing a search request on every keystroke.
  useEffect(() => {
    let cancelled = false;
    // A new search term starts unfiltered — a category filter chosen
    // for the previous query has no guaranteed relevance to this one.
    setCategoryFilterId(null);
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      setSearchError(false);
      return;
    }
    setSearching(true);
    setSearchError(false);
    const handle = setTimeout(() => {
      productRepository.search(query).then((r) => {
        if (!cancelled) {
          setResults(r);
          setSearching(false);
        }
      }).catch(() => {
        if (!cancelled) {
          setResults([]);
          setSearching(false);
          setSearchError(true);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, retryCount]);

  const commitSearch = (term: string) => {
    setQuery(term);
    addRecentSearch(term);
    // Tapping a recent-search chip or a "try this instead" suggestion
    // fills the field AND keeps it focused (spec: set query, focus
    // input, execute search) — the debounced-search effect below fires
    // off the query change on its own.
    searchInputRef.current?.focus();
  };

  const showingResults = query.trim().length > 0;
  const cardWidth = isWide ? 208 : 168;
  // A quick, capped stagger for grids/lists (section 6) — items settle in
  // one after another instead of popping in as a block; capped at 10 so a
  // long results grid doesn't make the tail end wait noticeably.
  const staggerIn = (i: number) => (reducedMotion ? undefined : FadeInDown.duration(motionDuration.fast).delay(Math.min(i, 10) * 35));

  // Only offer a category as a filter chip if the current results
  // actually contain something in it — never a dead filter that would
  // just empty the grid.
  const categoryFiltersForResults = (categories ?? []).filter((c) => results.some((p) => p.categoryId === c.id));
  const filteredResults = categoryFilterId ? results.filter((p) => p.categoryId === categoryFilterId) : results;

  // On wide viewports DesktopHeader already carries a persistent search
  // box (section 5) — this page's own input is only shown on mobile, to
  // avoid two search boxes stacked on top of each other on desktop.
  const searchRowContent = !isWide && (
    <View style={styles.searchRow}>
      <View style={{ flex: 1 }}>
        <SearchBar
          ref={searchInputRef}
          editable
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => commitSearch(query)}
        />
      </View>
    </View>
  );

  const recentSection = recent.length > 0 && (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionTitle, isWide && styles.sectionTitleWide]}>Recent Searches</Text>
        <Pressable onPress={clearRecentSearches}>
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      </View>
      <View style={styles.chipWrap}>
        {recent.map((term, i) => (
          <Animated.View key={term} entering={staggerIn(i)} style={styles.recentChip}>
            <AnimatedPressable style={styles.recentChipTap} pressScale={0.94} onPress={() => commitSearch(term)}>
              <Clock size={ICON_SIZE.xs} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
              <Text style={styles.recentChipText}>{term}</Text>
            </AnimatedPressable>
            <Pressable style={styles.recentChipRemove} onPress={() => removeRecentSearch(term)} hitSlop={8}>
              <X size={12} color={colors.textMuted} strokeWidth={ICON_STROKE} />
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </View>
  );

  const popularSection = popularProducts && popularProducts.length > 0 && (
    <View style={[styles.section, styles.railBleed]}>
      <ProductRail title="Popular Right Now" products={popularProducts} />
    </View>
  );

  return (
    <SafeScreen>
      {searchRowContent}

      <ScrollView contentContainerStyle={isWide ? styles.wideContent : styles.content} keyboardShouldPersistTaps="handled">
        <View style={isWide ? styles.wideInner : undefined}>
          {showingResults ? (
            <>
              <Animated.Text entering={reducedMotion ? undefined : FadeIn.duration(motionDuration.fast)} style={[styles.resultsCount, isWide && styles.resultsCountWide]}>
                {searching ? 'Searching…' : `${filteredResults.length} results for "${query}"`}
              </Animated.Text>
              {!searching && !searchError && results.length > 0 && categoryFiltersForResults.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipsRow}>
                  <Pressable onPress={() => setCategoryFilterId(null)} style={[styles.filterChip, categoryFilterId === null && styles.filterChipActive]}>
                    <Text style={[styles.filterChipText, categoryFilterId === null && styles.filterChipTextActive]}>All</Text>
                  </Pressable>
                  {categoryFiltersForResults.map((c) => {
                    const active = c.id === categoryFilterId;
                    return (
                      <Pressable key={c.id} onPress={() => setCategoryFilterId(c.id)} style={[styles.filterChip, active && styles.filterChipActive]}>
                        <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{c.name}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              {searching ? (
                <View style={styles.grid}>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} width={cardWidth} height={260} borderRadius={radius.md} />
                  ))}
                </View>
              ) : searchError ? (
                <EmptyState
                  title="Couldn't complete that search"
                  subtitle="Please check your connection and try again."
                  ctaLabel="Retry"
                  onPressCta={() => setRetryCount((c) => c + 1)}
                />
              ) : results.length === 0 ? (
                <EmptyState
                  title="We couldn't find that"
                  subtitle="Try searching for a different product or browse categories instead."
                  ctaLabel="Browse Categories"
                  onPressCta={() => router.push('/(tabs)/categories')}
                >
                  {popularProducts && popularProducts.length > 0 && (
                    <View style={styles.suggestWrap}>
                      <Text style={styles.suggestLabel}>Try one of these instead</Text>
                      <View style={styles.chipWrap}>
                        {popularProducts.slice(0, 6).map((p, i) => (
                          <Animated.View key={p.id} entering={staggerIn(i)}>
                            <AnimatedPressable style={styles.suggestChip} pressScale={0.94} onPress={() => commitSearch(p.name)}>
                              <Text style={styles.suggestChipText}>{p.name}</Text>
                            </AnimatedPressable>
                          </Animated.View>
                        ))}
                      </View>
                    </View>
                  )}
                </EmptyState>
              ) : filteredResults.length === 0 ? (
                <EmptyState
                  title="Nothing in this category"
                  subtitle={`None of the results for "${query}" are in this category.`}
                  ctaLabel="Show All Results"
                  onPressCta={() => setCategoryFilterId(null)}
                />
              ) : (
                <View style={styles.grid}>
                  {filteredResults.map((p, i) => (
                    <Animated.View key={p.id} entering={staggerIn(i)}>
                      <ProductCard product={p} width={cardWidth} />
                    </Animated.View>
                  ))}
                </View>
              )}
            </>
          ) : (
            <>
              {isWide && (
                <View style={styles.wideHero}>
                  <Text style={styles.wideHeroTitle}>Search Govind Pansari</Text>
                  <Text style={styles.wideHeroSubtitle}>Premium dry fruits, spices, sweets & gift hampers</Text>
                </View>
              )}

              {recentSection}
              {popularSection}

              <View style={styles.section}>
                <Text style={[styles.sectionTitle, isWide && styles.sectionTitleWide]}>Browse Categories</Text>
                {isWide ? (
                  <View style={styles.categoryGrid}>
                    {(categories ?? []).map((c, i) => (
                      <Animated.View key={c.id} entering={staggerIn(i)}>
                        <AnimatedPressable style={styles.categoryCard} onPress={() => router.push(`/category/${c.slug}`)}>
                          <AppImage uri={c.thumbnail} style={styles.categoryCardImage} contentFit="cover" fallbackIcon={LayoutGrid} />
                          <Text style={styles.categoryCardName}>{c.name}</Text>
                        </AnimatedPressable>
                      </Animated.View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.categoryList}>
                    {(categories ?? []).slice(0, 6).map((c, i) => (
                      <Animated.View key={c.id} entering={staggerIn(i)}>
                        <AnimatedPressable style={styles.categoryRow} onPress={() => router.push(`/category/${c.slug}`)}>
                          <AppImage uri={c.thumbnail} style={styles.categoryThumb} contentFit="cover" fallbackIcon={LayoutGrid} />
                          <Text style={styles.categoryName}>{c.name}</Text>
                        </AnimatedPressable>
                      </Animated.View>
                    ))}
                  </View>
                )}
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  searchRow: { paddingHorizontal: spacing.base, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  content: { paddingHorizontal: spacing.base, paddingBottom: 140 },
  wideContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.xxl, alignItems: 'center' },
  wideInner: { width: '100%', maxWidth: 1100 },
  wideHero: { alignItems: 'center', marginBottom: spacing.xl },
  wideHeroTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 32, color: colors.textPrimary, textAlign: 'center' },
  wideHeroSubtitle: { ...textStyles.body, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
  resultsCount: { ...textStyles.bodySmall, color: colors.textSecondary, marginVertical: spacing.md },
  resultsCountWide: { fontSize: 15, marginTop: 0 },
  filterChipsRow: { gap: spacing.sm, paddingBottom: spacing.md },
  filterChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
  },
  filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterChipText: { ...textStyles.bodySmall, color: colors.textPrimary },
  filterChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_600SemiBold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  section: { marginTop: spacing.lg },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { ...textStyles.sectionTitle, fontSize: 15, color: colors.textPrimary, marginBottom: spacing.sm },
  sectionTitleWide: { fontSize: 18, marginBottom: spacing.md },
  clearText: { ...textStyles.bodySmall, color: colors.primary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  recentChipTap: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: spacing.md, paddingRight: spacing.xs, paddingVertical: spacing.sm },
  recentChipText: { ...textStyles.bodySmall, color: colors.textPrimary },
  recentChipRemove: { paddingHorizontal: spacing.xs, paddingRight: spacing.sm, paddingVertical: spacing.sm },
  railBleed: { marginHorizontal: -spacing.base },
  suggestWrap: { alignItems: 'center', gap: spacing.sm },
  suggestLabel: { ...textStyles.caption, color: colors.textMuted },
  suggestChip: { backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  suggestChipText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  categoryList: { gap: spacing.sm },
  categoryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  categoryThumb: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  categoryName: { ...textStyles.body, color: colors.textPrimary },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  categoryCard: { width: 160, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  categoryCardImage: { width: '100%', height: 100, backgroundColor: colors.surfaceSunken },
  categoryCardName: { ...textStyles.cardTitle, color: colors.textPrimary, padding: spacing.sm },
});
