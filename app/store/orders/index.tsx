import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, ChevronRight, PackageSearch } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { SafeScreen } from '../../../components/layout/SafeScreen';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatINR } from '../../../components/ui/PriceBlock';
import { useStoreOpsStore } from '../../../store/storeOpsStore';
import { storeOpsRepository, type StoreOrderSummary } from '../../../services/repositories/storeOpsRepository';
import { formatOrderAge, orderUrgency } from '../../../services/timeAgo';
import { useRefetchOnForeground } from '../../../hooks/useRefetchOnForeground';
import type { OrderStatus } from '../../../types/models';

const FILTERS: { key: string; label: string; statuses: OrderStatus[] }[] = [
  { key: 'placed', label: 'New', statuses: ['placed'] },
  { key: 'processing', label: 'Processing', statuses: ['confirmed', 'preparing'] },
  { key: 'picking', label: 'Picking', statuses: ['picking'] },
  { key: 'packing', label: 'Packing', statuses: ['packing'] },
  { key: 'packed', label: 'Ready', statuses: ['packed'] },
  // 'On the Way' + 'Delivered' close a real gap: once a rider was
  // assigned, an order fell off every tab above and was unreachable
  // from this screen at all — the manager had no way to open a
  // delivered order to see its delivery proof photo (already built,
  // storeOpsRepository.getDeliveryProof / app/store/orders/[id].tsx),
  // just no path to get there.
  // storeOpsRepository.listOrders reads orders.status raw from the DB
  // (unlike the customer-facing STATUS_MAP translation elsewhere,
  // where this DB value displays as 'arriving') — 'approaching' is the
  // real value to filter on here, hence the cast past OrderStatus's
  // customer-facing spelling.
  { key: 'on_the_way', label: 'On the Way', statuses: ['rider_assigned', 'out_for_delivery', 'approaching' as OrderStatus] },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered'] },
];

const URGENCY_COLOR = { normal: colors.textMuted, attention: colors.warning, urgent: colors.error };

export default function StoreOrdersScreen() {
  const params = useLocalSearchParams<{ status?: string }>();
  const activeStoreId = useStoreOpsStore((s) => s.activeStoreId);
  const [filter, setFilter] = useState(params.status && FILTERS.some((f) => f.key === params.status) ? params.status : 'placed');
  const [orders, setOrders] = useState<StoreOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  const load = useCallback(() => {
    if (!activeStoreId) return;
    setLoading(true);
    setError(false);
    storeOpsRepository
      .listOrders(activeStoreId, activeFilter.statuses)
      .then(setOrders)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [activeStoreId, activeFilter]);

  useFocusEffect(load);

  // Section 51: the queue refreshes live as orders come in or change
  // stage, not only when the manager re-opens the screen.
  useEffect(() => {
    if (!activeStoreId) return;
    return storeOpsRepository.subscribeToStoreActivity(activeStoreId, load);
  }, [activeStoreId, load]);
  useRefetchOnForeground(load);

  const orderedOrders = useMemo(() => orders, [orders]);

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Orders</Text>
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = f.key === filter;
          return (
            <Pressable key={f.key} style={[styles.filterPill, active && styles.filterPillActive]} onPress={() => setFilter(f.key)}>
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="Couldn't load orders" subtitle="Check your connection and try again." ctaLabel="Retry" onPressCta={load} />
      ) : (
        <FlatList
          data={orderedOrders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => <OrderRow order={item} />}
          ListEmptyComponent={
            <EmptyState icon={PackageSearch} title={`No ${activeFilter.label.toLowerCase()} orders`} subtitle="New orders will show up here automatically." />
          }
        />
      )}
    </SafeScreen>
  );
}

function OrderRow({ order }: { order: StoreOrderSummary }) {
  const urgency = ['placed', 'confirmed', 'preparing', 'picking', 'packing'].includes(order.status) ? orderUrgency(order.placedAt) : 'normal';
  return (
    <Pressable
      style={styles.card}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see app/store/index.tsx
      onPress={() => router.push(`/store/orders/${order.id}` as any)}
    >
      <View style={styles.cardTop}>
        <Text style={styles.orderNumber}>#{order.orderNumber}</Text>
        <Text style={[styles.age, { color: URGENCY_COLOR[urgency] }]}>{formatOrderAge(order.placedAt)}</Text>
      </View>
      <Text style={styles.meta}>
        {order.itemCount} item{order.itemCount === 1 ? '' : 's'} • {formatINR(order.total)} • {order.paymentStatus.toUpperCase()}
      </Text>
      <Text style={styles.deliveryLine}>Delivering to: {order.deliveryCity || '—'}</Text>
      {order.hasException && (
        <View style={styles.exceptionRow}>
          <AlertTriangle size={13} color={colors.error} strokeWidth={ICON_STROKE} />
          <Text style={styles.exceptionText}>Needs attention</Text>
        </View>
      )}
      <View style={styles.cardBottom}>
        <Text style={styles.viewText}>VIEW ORDER</Text>
        <ChevronRight size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.base, paddingTop: spacing.md },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: colors.textPrimary },
  filterRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.base, paddingVertical: spacing.md, flexWrap: 'wrap' },
  filterPill: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { ...textStyles.bodySmall, color: colors.textPrimary },
  filterTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_600SemiBold' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.base, paddingBottom: 140, flexGrow: 1 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, ...shadows.sm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderNumber: { ...textStyles.cardTitle, color: colors.textPrimary },
  age: { ...textStyles.caption, fontFamily: 'PlusJakartaSans_700Bold' },
  meta: { ...textStyles.bodySmall, color: colors.textSecondary, marginTop: 4 },
  deliveryLine: { ...textStyles.caption, color: colors.textMuted, marginTop: 2 },
  exceptionRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  exceptionText: { ...textStyles.caption, color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  viewText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
});
