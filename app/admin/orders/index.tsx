import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Search, X } from 'lucide-react-native';
import { ORDER_FILTERS, filterKeyFromParams, queryForFilter } from '../../../services/orderFilters';
import { colors, radius, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { AdminShell } from '../../../components/admin/AdminShell';
import { FilterChipRow } from '../../../components/admin/FilterChipRow';
import { OrderCard } from '../../../components/admin/OrderCard';
import { EmptyState } from '../../../components/ui/EmptyState';
import { pushAdmin } from '../../../services/adminNav';
import { adminRepository, type AdminOrderRow } from '../../../services/repositories/adminRepository';
import type { OrderPreview } from '../../../services/adminOrderView';
import { useRefetchOnForeground } from '../../../hooks/useRefetchOnForeground';
import { useStableCallback } from '../../../hooks/useStableCallback';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';

const PAGE_SIZE = 20;
const CONTENT_MAX_WIDTH = 1200;
const COLUMN_GAP = spacing.md;
const FILTER_OPTIONS = ORDER_FILTERS.map((f) => ({ key: f.key, label: f.label }));

export default function AdminOrdersScreen() {
  const params = useLocalSearchParams<{ status?: string; stage?: string; view?: string }>();
  const { width } = useWindowDimensions();
  // One card per row on a phone, two on a tablet / small window, three on a wide desktop window.
  const columns = width >= 1100 ? 3 : width >= 700 ? 2 : 1;
  const contentWidth = Math.min(width, CONTENT_MAX_WIDTH) - spacing.lg * 2;
  const cardWidth = columns === 1 ? undefined : (contentWidth - COLUMN_GAP * (columns - 1)) / columns;

  const [filterKey, setFilterKey] = useState<string>(filterKeyFromParams(params));
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  // undefined = not fetched yet (card shows "Loading items…"); null = could not be read (card says so, never a made-up picture).
  const [previews, setPreviews] = useState<Record<string, OrderPreview | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const activeFilter = ORDER_FILTERS.find((f) => f.key === filterKey) ?? ORDER_FILTERS[0]!;

  // `silent` is a live refresh (a realtime event, a reconnect, back to the foreground): it keeps the list on screen while
  // the fresh copy loads, and a failure leaves the list as it was instead of replacing it with an error.
  const load = useCallback(
    (silent = false) => {
      if (!silent) {
        setLoading(true);
        setLoadError(null);
      }
      adminRepository
        .getOrders({ ...queryForFilter(activeFilter), search: search || undefined, limit: PAGE_SIZE })
        .then((rows) => {
          setOrders(rows);
          setHasMore(rows.length === PAGE_SIZE);
          setLoadError(null);
        })
        .catch((e) => {
          if (silent) return;
          // A failed query must read as a failure, not as "No orders".
          // eslint-disable-next-line no-console
          console.warn('[admin orders] load failed:', e instanceof Error ? e.message : e);
          setOrders([]);
          setLoadError("Couldn't load orders. Check your connection and try again.");
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [activeFilter, search],
  );

  useFocusEffect(load);
  useEffect(() => {
    if (params.status || params.stage || params.view) setFilterKey(filterKeyFromParams(params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.status, params.stage, params.view]);

  // Stable across search/status-filter changes — see useStableCallback.
  const stableLoad = useStableCallback(() => load(true));
  useEffect(() => adminRepository.subscribeToAdminOrders(stableLoad), [stableLoad]);
  useRefetchOnForeground(stableLoad);

  // The product photo and main item of each card come from the order's real lines, fetched for the orders on screen.
  useEffect(() => {
    const missing = orders.filter((o) => !(o.id in previews)).map((o) => o.id);
    if (missing.length === 0) return;
    let cancelled = false;
    adminRepository
      .getOrderPreviews(missing)
      .then((found) => !cancelled && setPreviews((prev) => ({ ...prev, ...Object.fromEntries(missing.map((id) => [id, found[id] ?? null])) })))
      .catch(() => !cancelled && setPreviews((prev) => ({ ...prev, ...Object.fromEntries(missing.map((id) => [id, null])) })));
    return () => {
      cancelled = true;
    };
    // `previews` is read only to skip orders that are already fetched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);

  const loadMore = () => {
    if (!hasMore || loadingMore || orders.length === 0) return;
    setLoadingMore(true);
    adminRepository
      .getOrders({ ...queryForFilter(activeFilter), search: search || undefined, cursor: orders[orders.length - 1].placed_at, limit: PAGE_SIZE })
      .then((rows) => {
        setOrders((prev) => [...prev, ...rows.filter((r) => !prev.some((p) => p.id === r.id))]);
        setHasMore(rows.length === PAGE_SIZE);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn('[admin orders] loading more failed:', e instanceof Error ? e.message : e);
        setHasMore(false);
        setLoadError("Couldn't load more orders. Pull to refresh and try again.");
      })
      .finally(() => setLoadingMore(false));
  };

  // Search and filters are the FIRST items of the list, not a fixed block above it: on a phone they used to take most of the
  // screen and leave the cards a sliver to scroll in. (Passed as an element, not a component, so the search box keeps focus.)
  const header = (
    <View style={styles.header}>
      <View style={styles.searchBox}>
        <Search size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search order #, customer name or phone"
          placeholderTextColor={colors.textMuted}
          value={searchInput}
          onChangeText={setSearchInput}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search orders"
        />
        {!!searchInput && (
          <Pressable onPress={() => setSearchInput('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <X size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          </Pressable>
        )}
      </View>
      <FilterChipRow options={FILTER_OPTIONS} selected={filterKey} onSelect={setFilterKey} />
      {!loading && orders.length > 0 && (
        <Text style={styles.resultLine}>
          {orders.length}
          {hasMore ? '+' : ''} order{orders.length === 1 && !hasMore ? '' : 's'}
          {search ? ` matching "${search}"` : ''}
        </Text>
      )}
    </View>
  );

  return (
    <AdminShell title="Orders" subtitle="Manage and track all customer orders">
      <FlatList
        key={columns}
        style={styles.list}
        data={orders}
        keyExtractor={(o) => o.id}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.columnWrap : undefined}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        refreshing={loading}
        onRefresh={load}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          !loading ? (
            loadError ? (
              <EmptyState title="Couldn't load orders" subtitle={loadError} ctaLabel="Try Again" onPressCta={() => load()} />
            ) : (
              <EmptyState title="No orders" subtitle={search ? `No orders match "${search}".` : 'No orders match this filter.'} />
            )
          ) : null
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} /> : null}
        renderItem={({ item }) => (
          <View style={cardWidth ? { width: cardWidth } : undefined}>
            <OrderCard order={item} preview={previews[item.id]} onPress={() => pushAdmin(`/admin/orders/${item.id}`)} />
          </View>
        )}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, minHeight: 0 },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: COLUMN_GAP, maxWidth: CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' },
  columnWrap: { gap: COLUMN_GAP },
  header: { gap: spacing.sm, paddingBottom: spacing.xs },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 46, maxWidth: 520 },
  searchInput: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary, outlineStyle: 'none' as never },
  resultLine: { ...textStyles.caption, color: colors.textMuted },
});
