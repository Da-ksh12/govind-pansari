import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { IndianRupee, Package, ShoppingBag, TrendingUp, UserPlus, XCircle } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { AdminShell } from '../../components/admin/AdminShell';
import { StatCard } from '../../components/admin/StatCard';
import { StatusBadge } from '../../components/admin/StatusBadge';
import { RevenueChart } from '../../components/admin/RevenueChart';
import { formatINR } from '../../components/ui/PriceBlock';
import { adminRepository, type AdminAnalytics } from '../../services/repositories/adminRepository';

const PERIODS = [
  { key: 7, label: '7 days' },
  { key: 30, label: '30 days' },
  { key: 90, label: '90 days' },
];

function Bar({ label, value, revenue, max }: { label: string; value: number; revenue: number; max: number }) {
  const pct = Math.max((revenue / max) * 100, revenue > 0 ? 2 : 0);
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
      <View style={styles.barTrackH}>
        <View style={[styles.barFillH, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.barValue}>{formatINR(revenue)}</Text>
    </View>
  );
}

export default function AdminAnalyticsScreen() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminRepository.getAnalytics(days).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [days]);

  useFocusEffect(load);

  const statusEntries = data ? Object.entries(data.statusBreakdown).sort((a, b) => b[1] - a[1]) : [];
  const maxProductRevenue = data ? Math.max(...data.topProducts.map((p) => p.revenue), 1) : 1;
  const maxCategoryRevenue = data ? Math.max(...data.categoryBreakdown.map((c) => c.revenue), 1) : 1;

  return (
    <AdminShell title="Analytics" subtitle="Real revenue, product and order trends">
      <View style={styles.toolbar}>
        <View style={styles.periodRow}>
          {PERIODS.map((p) => (
            <Pressable key={p.key} style={[styles.periodChip, days === p.key && styles.periodChipActive]} onPress={() => setDays(p.key)}>
              <Text style={[styles.periodChipText, days === p.key && styles.periodChipTextActive]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loading && !data ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !data ? (
        <Text style={styles.errorText}>Couldn't load analytics. Pull to refresh.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}>
          <View style={styles.statsRow}>
            <StatCard label="Revenue" value={formatINR(data.totals.revenue)} icon={IndianRupee} />
            <StatCard label="Orders" value={data.totals.orders} icon={ShoppingBag} />
            <StatCard label="Avg Order Value" value={formatINR(data.totals.averageOrderValue)} icon={TrendingUp} />
            <StatCard label="New Customers" value={data.totals.newCustomers} icon={UserPlus} />
            <StatCard label="Cancelled" value={data.totals.cancelledOrders} icon={XCircle} tone={data.totals.cancelledOrders > 0 ? 'error' : 'default'} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Revenue Over Time</Text>
            <RevenueChart data={data.revenueByDay} />
          </View>

          <View style={styles.grid}>
            <View style={[styles.card, styles.gridCol]}>
              <Text style={styles.cardTitle}>Top Products</Text>
              {data.topProducts.length === 0 ? (
                <Text style={styles.emptyText}>No sales in this period.</Text>
              ) : (
                data.topProducts.map((p) => (
                  <Bar key={p.product_id} label={p.name} value={p.quantity_sold} revenue={p.revenue} max={maxProductRevenue} />
                ))
              )}
            </View>

            <View style={[styles.card, styles.gridCol]}>
              <Text style={styles.cardTitle}>Revenue by Category</Text>
              {data.categoryBreakdown.length === 0 ? (
                <Text style={styles.emptyText}>No sales in this period.</Text>
              ) : (
                data.categoryBreakdown.map((c) => (
                  <Bar key={c.category_name} label={c.category_name} value={c.quantity_sold} revenue={c.revenue} max={maxCategoryRevenue} />
                ))
              )}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Orders by Status</Text>
            <View style={styles.statusWrap}>
              {statusEntries.map(([status, count]) => (
                <View key={status} style={styles.statusRow}>
                  <StatusBadge status={status} size="sm" />
                  <Text style={styles.statusCount}>{count}</Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  toolbar: { padding: spacing.lg, paddingBottom: 0, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  periodRow: { flexDirection: 'row', gap: spacing.sm },
  periodChip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  periodChipActive: { backgroundColor: colors.primary },
  periodChipText: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  periodChipTextActive: { color: colors.white },
  centerFill: { paddingVertical: spacing.xxxl, alignItems: 'center' },
  errorText: { ...textStyles.bodySmall, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.xxl },
  content: { padding: spacing.lg, gap: spacing.md, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  cardTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, marginBottom: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  gridCol: { flex: 1, minWidth: 320 },
  emptyText: { ...textStyles.caption, color: colors.textMuted },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  barLabel: { ...textStyles.caption, color: colors.textSecondary, width: 110 },
  barTrackH: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  barFillH: { height: '100%', backgroundColor: colors.primary, borderRadius: 4 },
  barValue: { ...textStyles.caption, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold', width: 76, textAlign: 'right' },
  statusWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusCount: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
});
