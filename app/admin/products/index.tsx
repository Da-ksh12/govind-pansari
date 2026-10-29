import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Boxes, ChevronRight, Package, Plus, Search, Tag } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { AdminShell } from '../../../components/admin/AdminShell';
import { StatCard } from '../../../components/admin/StatCard';
import { StatusBadge } from '../../../components/admin/StatusBadge';
import { AppImage } from '../../../components/ui/AppImage';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatINR } from '../../../components/ui/PriceBlock';
import { useAdminStore } from '../../../store/adminStore';
import { useUIStore } from '../../../store/uiStore';
import { adminRepository } from '../../../services/repositories/adminRepository';
import { useRefetchOnForeground } from '../../../hooks/useRefetchOnForeground';
import { useStableCallback } from '../../../hooks/useStableCallback';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';

const PAGE_SIZE = 30;

export default function AdminProductsScreen() {
  const [products, setProducts] = useState<any[]>([]);
  const [stats, setStats] = useState<{ total: number; active: number; categories: number } | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);

  // `silent`: a live refresh keeps the list on screen and leaves it as it was if the refresh fails.
  const load = useCallback(
    (silent = false) => {
      if (!silent) setLoading(true);
      Promise.all([
        adminRepository.getProducts({ search: search || undefined, limit: PAGE_SIZE }),
        adminRepository.getProductStats().catch(() => null),
      ])
        .then(([rows, s]) => {
          setProducts(rows);
          setHasMore(rows.length === PAGE_SIZE);
          if (s) setStats(s);
        })
        .catch(() => {
          if (!silent) setProducts([]);
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [search],
  );

  const loadMore = () => {
    if (!hasMore || loadingMore || loading || products.length === 0) return;
    setLoadingMore(true);
    adminRepository
      .getProducts({ search: search || undefined, cursor: products[products.length - 1].created_at, limit: PAGE_SIZE })
      .then((rows) => {
        setProducts((prev) => [...prev, ...rows]);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  useFocusEffect(load);
  // Stable across search-box keystrokes (search is one of `load`'s own
  // deps) so a realtime edit elsewhere doesn't tear down/reopen this
  // channel on every character typed — see useStableCallback.
  const stableLoad = useStableCallback(() => load(true));
  useEffect(() => adminRepository.subscribeToAdminCatalogue(stableLoad), [stableLoad]);
  useRefetchOnForeground(stableLoad);

  const toggleActive = async (product: any) => {
    const next = !product.is_active;
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, is_active: next } : p)));
    try {
      await adminRepository.setProductActive(product.id, next);
      showToast(next ? 'Product activated' : 'Product archived', 'success');
    } catch {
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, is_active: !next } : p)));
      showToast("Couldn't update the product.", 'error');
    }
  };

  // Stats and search are the first rows of the list (not a fixed block above it), so the whole screen scrolls and the list gets
  // all the remaining height. Passed as an element so the search box keeps focus while typing.
  const header = (
    <View style={styles.header}>
      {stats && (
        <View style={styles.statsRow}>
          <StatCard compact label="Total Products" value={stats.total} icon={Package} />
          <StatCard compact label="Active" value={stats.active} icon={Boxes} tone="success" />
          <StatCard compact label="Archived" value={stats.total - stats.active} icon={Boxes} />
          <StatCard compact label="Categories" value={stats.categories} icon={Tag} onPress={() => router.push('/admin/categories' as never)} />
        </View>
      )}
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Search size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          <TextInput style={styles.searchInput} placeholder="Search products by name or SKU" placeholderTextColor={colors.textMuted} value={searchInput} onChangeText={setSearchInput} returnKeyType="search" autoCorrect={false} accessibilityLabel="Search products" />
        </View>
        {hasPermission('products.create') && (
          <Pressable style={styles.addBtn} onPress={() => router.push('/admin/products/new' as never)} accessibilityRole="button">
            <Plus size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
            <Text style={styles.addBtnText}>Add Product</Text>
          </Pressable>
        )}
      </View>
    </View>
  );

  return (
    <AdminShell title="Products" subtitle="Manage your product catalogue">
      <FlatList
        style={styles.list}
        data={products}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshing={loading}
        onRefresh={load}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        ListEmptyComponent={!loading ? <EmptyState title="No products" subtitle="No products match this search." /> : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} /> : null}
        renderItem={({ item }) => {
          const variants = item.product_variants ?? [];
          const priceRange = variants.length > 0 ? `${formatINR(Math.min(...variants.map((v: any) => v.price)))} – ${formatINR(Math.max(...variants.map((v: any) => v.price)))}` : '—';
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => hasPermission('products.edit') && router.push(`/admin/products/${item.id}` as never)}
            >
              <AppImage uri={item.image} style={styles.thumb} contentFit="cover" fallbackIcon={Package} />
              <View style={{ flex: 1 }}>
                <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
                <View style={styles.metaRow}>
                  {item.categories?.name && (
                    <View style={styles.categoryChip}>
                      <Text style={styles.categoryChipText} numberOfLines={1}>{item.categories.name}</Text>
                    </View>
                  )}
                  <Text style={styles.meta} numberOfLines={1}>{variants.length} variant{variants.length === 1 ? '' : 's'}</Text>
                </View>
                <Text style={styles.priceRange} numberOfLines={1}>{priceRange}</Text>
              </View>
              <View style={styles.rowEnd}>
                <StatusBadge status={item.is_active ? 'active' : 'inactive'} size="sm" />
                {hasPermission('products.edit') && (
                  <Switch value={item.is_active} onValueChange={() => toggleActive(item)} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
                )}
                <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
              </View>
            </Pressable>
          );
        }}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, minHeight: 0 },
  header: { gap: spacing.sm, paddingBottom: spacing.xs },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44 },
  addBtnText: { ...textStyles.caption, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  searchInput: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary, outlineStyle: 'none' as never },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  thumb: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  thumbFallback: { alignItems: 'center', justifyContent: 'center' },
  productName: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 4 },
  categoryChip: { backgroundColor: colors.goldTint, borderRadius: radius.xs, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 1 },
  categoryChipText: { ...textStyles.caption, color: colors.goldDark, fontSize: 10.5 },
  meta: { ...textStyles.caption, color: colors.textSecondary },
  priceRange: { ...textStyles.cardTitle, fontSize: 13, color: colors.textPrimary, marginTop: 4 },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
