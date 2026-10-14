import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { colors, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { ProductCard } from '../../components/product/ProductCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProductGridSkeleton } from '../../components/skeletons/ProductGridSkeleton';
import { useAsync } from '../../hooks/useAsync';
import { productRepository } from '../../services/repositories/productRepository';
import { categoryRepository } from '../../services/repositories/categoryRepository';

const WIDE_BREAKPOINT = 900;
const WIDE_CONTENT_MAX_WIDTH = 1100;

export default function NeedDetailScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const { data, loading, error, reload } = useAsync(async () => {
    const [needTags, products] = await Promise.all([categoryRepository.listNeedTags(), productRepository.listByTag(slug)]);
    const need = needTags.find((n) => n.slug === slug);
    return { need, products };
  }, [slug]);

  if (!data) {
    if (loading) return <SafeScreen><ProductGridSkeleton /></SafeScreen>;
    return (
      <SafeScreen>
        <EmptyState title="Couldn't load this collection" subtitle="Check your connection and try again." ctaLabel="Retry" onPressCta={reload} />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>{data.need?.label ?? 'Products'}</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.grid, isWide && styles.gridWide]} showsVerticalScrollIndicator={false}>
        {data.products.length === 0 ? (
          <EmptyState title="No products yet" subtitle="Check back soon for this collection." />
        ) : (
          data.products.map((p) => <ProductCard key={p.id} product={p} width={168} />)
        )}
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, padding: spacing.base, paddingBottom: 140 },
  // Same wide-viewport centering fix as category/[slug].tsx.
  gridWide: { maxWidth: WIDE_CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%', justifyContent: 'flex-start' },
});
