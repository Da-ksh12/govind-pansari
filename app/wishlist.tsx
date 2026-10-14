import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeft, Heart } from 'lucide-react-native';
import { colors, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { ProductCard } from '../components/product/ProductCard';
import { EmptyState } from '../components/ui/EmptyState';
import { useWishlistStore } from '../store/wishlistStore';
import { getCachedProduct } from '../services/supabase/productCache';

const WIDE_BREAKPOINT = 900;
const WIDE_CONTENT_MAX_WIDTH = 1100;

export default function WishlistScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const items = useWishlistStore((s) => s.items);
  const products = items.map((i) => getCachedProduct(i.productId)).filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>My Wishlist</Text>
      </View>

      {products.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="Save your favourites for later"
          subtitle="Tap the heart on any product to add it to your wishlist."
          ctaLabel="Explore Products"
          onPressCta={() => router.replace('/(tabs)')}
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.grid, isWide && styles.gridWide]} showsVerticalScrollIndicator={false}>
          {products.map((p) => (
            <ProductCard key={p.id} product={p} width={168} />
          ))}
        </ScrollView>
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: colors.textPrimary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, padding: spacing.base, paddingBottom: 140 },
  // Same wide-viewport centering fix as category/[slug].tsx — an
  // unconstrained flexWrap row renders left-packed on a wide screen
  // instead of centered.
  gridWide: { maxWidth: WIDE_CONTENT_MAX_WIDTH, alignSelf: 'center', width: '100%', justifyContent: 'flex-start' },
});
