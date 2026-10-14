import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ChevronRight, PackageSearch } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatINR } from '../../components/ui/PriceBlock';
import { riderOpsRepository, type DeliveryHistoryItem } from '../../services/repositories/riderOpsRepository';

const STATUS_META: Record<string, { label: string; color: string }> = {
  completed: { label: 'Delivered', color: colors.success },
  failed: { label: 'Failed', color: colors.error },
  cancelled: { label: 'Cancelled', color: colors.textMuted },
};

export default function RiderHistoryScreen() {
  const [items, setItems] = useState<DeliveryHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    riderOpsRepository
      .listHistory()
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Delivery History</Text>
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <EmptyState title="Couldn't load your history" subtitle="Check your connection and try again." ctaLabel="Retry" onPressCta={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status] ?? { label: item.status, color: colors.textSecondary };
            const when = item.completedAt ?? item.failedAt ?? item.assignedAt;
            return (
              <Pressable style={styles.row} onPress={() => router.push(`/rider/delivery/${item.id}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderNumber}>#{item.orderNumber}</Text>
                  <Text style={styles.dateText}>{new Date(when).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.totalText}>{formatINR(item.total)}</Text>
                  <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                </View>
                <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
              </Pressable>
            );
          }}
          ListEmptyComponent={<EmptyState icon={PackageSearch} title="No deliveries yet" subtitle="Completed deliveries will show up here." />}
        />
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.base, paddingTop: spacing.md },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: colors.textPrimary },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.base, paddingBottom: 140, flexGrow: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, ...shadows.sm },
  orderNumber: { ...textStyles.cardTitle, color: colors.textPrimary },
  dateText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  totalText: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  statusText: { ...textStyles.caption, fontFamily: 'PlusJakartaSans_700Bold', marginTop: 2 },
});
