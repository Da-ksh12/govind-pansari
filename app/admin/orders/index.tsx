import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ChevronRight, Search } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { AdminShell } from '../../../components/admin/AdminShell';
import { StatusBadge } from '../../../components/admin/StatusBadge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatINR } from '../../../components/ui/PriceBlock';
import { pushAdmin } from '../../../services/adminNav';
import { adminRepository, type AdminOrderRow } from '../../../services/repositories/adminRepository';
import { useRefetchOnForeground } from '../../../hooks/useRefetchOnForeground';
import { useStableCallback } from '../../../hooks/useStableCallback';
import type { OrderStatus } from '../../../types/models';

const STATUS_FILTERS: { key: OrderStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All Orders' },
  { key: 'placed', label: 'New' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'packed', label: 'Ready' },
  { key: 'rider_assigned', label: 'Rider Assigned' },
  { key: 'out_for_delivery', label: 'On the Way' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

export default function AdminOrdersScreen() {
  const params = useLocalSearchParams<{ status?: string }>();
  const [status, setStatus] = useState<string>(params.status ?? 'all');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminRepository
      .getOrders({ status: status === 'all' ? undefined : status, search: search || undefined, limit: 20 })
      .then((rows) => {
        setOrders(rows);
        setHasMore(rows.length === 20);
      })
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  }, [status, search]);

  useFocusEffect(load);
  useEffect(() => {
    if (params.status) setStatus(params.status);
  }, [params.status]);

  // Stable across search/status-filter changes — see useStableCallback.
  const stableLoad = useStableCallback(load);
  useEffect(() => adminRepository.subscribeToAdminOrders(stableLoad), [stableLoad]);
  useRefetchOnForeground(load);

  const loadMore = () => {
    if (!hasMore || loadingMore || orders.length === 0) return;
    setLoadingMore(true);
    adminRepository
      .getOrders({ status: status === 'all' ? undefined : status, search: search || undefined, cursor: orders[orders.length - 1].placed_at, limit: 20 })
      .then((rows) => {
        setOrders((prev) => [...prev, ...rows]);
        setHasMore(rows.length === 20);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  return (
    <AdminShell title="Orders" subtitle="Manage and track all customer orders">
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Search size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search order #, customer name or phone"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={load}
            returnKeyType="search"
          />
        </View>
        <View style={styles.filterRow}>
          {STATUS_FILTERS.map((f) => (
            <Pressable key={f.key} style={[styles.filterChip, status === f.key && styles.filterChipActive]} onPress={() => setStatus(f.key)}>
              <Text style={[styles.filterChipText, status === f.key && styles.filterChipTextActive]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.listContent}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={!loading ? <EmptyState title="No orders" subtitle="No orders match this filter." /> : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} /> : null}
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={() => pushAdmin(`/admin/orders/${item.id}`)}>
            <View style={{ flex: 1.4 }}>
              <Text style={styles.orderNumber}>#{item.order_number}</Text>
              <Text style={styles.meta}>{item.customer_name} • {item.customer_phone}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.meta}>{item.store_name}</Text>
              {item.rider_name && <Text style={styles.meta}>Rider: {item.rider_name}</Text>}
            </View>
            <View style={{ flex: 0.8, alignItems: 'flex-end' }}>
              <Text style={styles.total}>{formatINR(item.total)}</Text>
              <Text style={styles.itemCount}>{item.item_count} items</Text>
            </View>
            <StatusBadge status={item.status} />
            <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          </Pressable>
        )}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  toolbar: { padding: spacing.lg, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSunken, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44, maxWidth: 480 },
  searchInput: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary, outlineStyle: 'none' as never },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  filterChipActive: { backgroundColor: colors.primary },
  filterChipText: { ...textStyles.caption, color: colors.textSecondary, fontSize: 12, fontFamily: 'PlusJakartaSans_600SemiBold' },
  filterChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  listContent: { padding: spacing.lg, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  orderNumber: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  meta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  total: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  itemCount: { ...textStyles.caption, color: colors.textMuted, marginTop: 2 },
});
