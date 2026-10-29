import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { PackageSearch, WifiOff } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { OrderCard } from '../../components/order/OrderCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { useOrdersStore } from '../../store/ordersStore';
import type { Order } from '../../types/models';

const STATUS_TABS = ['All', 'Active', 'Delivered', 'Cancelled'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const TIME_FILTERS = ['Today', 'This Week', 'This Month', 'Previous Month'] as const;
type TimeFilter = (typeof TIME_FILTERS)[number];

const ACTIVE_STATUSES = new Set(['placed', 'confirmed', 'preparing', 'packed', 'rider_assigned', 'out_for_delivery', 'arriving']);

function matchesStatus(order: Order, tab: StatusTab): boolean {
  if (tab === 'All') return true;
  if (tab === 'Active') return ACTIVE_STATUSES.has(order.status);
  if (tab === 'Cancelled') return order.status === 'cancelled';
  return order.status === 'delivered';
}

function matchesTime(order: Order, filter: TimeFilter | null): boolean {
  if (!filter) return true;
  const d = new Date(order.placedAt);
  const now = new Date();
  if (filter === 'Today') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }
  if (filter === 'This Week') {
    const startOfWeek = new Date(now);
    const dayIndex = (now.getDay() + 6) % 7; // Monday = 0
    startOfWeek.setDate(now.getDate() - dayIndex);
    startOfWeek.setHours(0, 0, 0, 0);
    return d >= startOfWeek && d <= now;
  }
  if (filter === 'This Month') {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  // Previous Month
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return d.getFullYear() === prev.getFullYear() && d.getMonth() === prev.getMonth();
}

export default function OrdersScreen() {
  const [statusTab, setStatusTab] = useState<StatusTab>('All');
  const [timeFilter, setTimeFilter] = useState<TimeFilter | null>(null);
  const orders = useOrdersStore((s) => s.orders);
  const loading = useOrdersStore((s) => s.loading);
  const loaded = useOrdersStore((s) => s.loaded);
  const error = useOrdersStore((s) => s.error);
  const loadOrders = useOrdersStore((s) => s.loadOrders);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders]),
  );

  const filtered = useMemo(
    () => orders.filter((o) => matchesStatus(o, statusTab) && matchesTime(o, timeFilter)),
    [orders, statusTab, timeFilter],
  );

  const toggleTimeFilter = (f: TimeFilter) => setTimeFilter((current) => (current === f ? null : f));

  const emptyTitle = timeFilter
    ? `No ${statusTab === 'All' ? '' : statusTab.toLowerCase() + ' '}orders ${timeFilter === 'Today' ? 'today' : timeFilter.toLowerCase()}`
    : statusTab === 'Active'
      ? 'No active orders'
      : statusTab === 'Delivered'
        ? 'No delivered orders yet'
        : statusTab === 'Cancelled'
          ? 'No cancelled orders'
          : 'No orders yet';
  const emptySubtitle = statusTab === 'All' && !timeFilter ? 'Your delicious journey starts here.' : undefined;

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Text style={styles.title}>My Orders</Text>
        <View style={styles.tabRow}>
          {STATUS_TABS.map((t) => {
            const active = t === statusTab;
            return (
              <Pressable key={t} style={[styles.tab, active && styles.tabActive]} onPress={() => setStatusTab(t)}>
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timeRow}>
          {TIME_FILTERS.map((f) => {
            const active = f === timeFilter;
            return (
              <Pressable key={f} style={[styles.timeChip, active && styles.timeChipActive]} onPress={() => toggleTimeFilter(f)}>
                <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>{f}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading && !loaded ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error && !loaded ? (
        <EmptyState
          icon={WifiOff}
          title="Couldn't load your orders"
          subtitle="Check your connection and try again."
          ctaLabel="Retry"
          onPressCta={loadOrders}
        />
      ) : (
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => <OrderCard order={item} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListEmptyComponent={
          <EmptyState
            icon={PackageSearch}
            title={emptyTitle}
            subtitle={emptySubtitle}
            ctaLabel={statusTab === 'All' && !timeFilter ? 'Start Shopping' : undefined}
            onPressCta={() => router.push('/(tabs)')}
          />
        }
      />
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: spacing.base, paddingTop: spacing.md },
  title: { ...textStyles.screenTitle, color: colors.textPrimary },
  tabRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  tab: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { ...textStyles.bodySmall, color: colors.textPrimary },
  tabTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_600SemiBold' },
  timeRow: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm, paddingVertical: 2 },
  timeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  timeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  timeChipText: { ...textStyles.caption, color: colors.textSecondary },
  timeChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  listContent: { padding: spacing.base, paddingBottom: 140, flexGrow: 1 },
});
