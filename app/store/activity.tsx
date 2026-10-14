import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Clock, Package, ShoppingBag, Truck } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { EmptyState } from '../../components/ui/EmptyState';
import { useStoreOpsStore } from '../../store/storeOpsStore';
import { storeOpsRepository, type StoreActivityItem } from '../../services/repositories/storeOpsRepository';

const KIND_ICON = { order: ShoppingBag, delivery: Truck, inventory: Package };

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

export default function StoreActivityScreen() {
  const activeStoreId = useStoreOpsStore((s) => s.activeStoreId);
  const [items, setItems] = useState<StoreActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(() => {
    if (!activeStoreId) return;
    setLoading(true);
    storeOpsRepository.getActivity(activeStoreId, undefined, 30).then((rows) => {
      setItems(rows);
      setHasMore(rows.length === 30);
    }).catch(() => setItems([])).finally(() => setLoading(false));
  }, [activeStoreId]);

  useFocusEffect(load);

  const loadMore = () => {
    if (!activeStoreId || !hasMore || loadingMore || items.length === 0) return;
    setLoadingMore(true);
    storeOpsRepository.getActivity(activeStoreId, items[items.length - 1].at, 30).then((rows) => {
      setItems((prev) => [...prev, ...rows]);
      setHasMore(rows.length === 30);
    }).catch(() => {}).finally(() => setLoadingMore(false));
  };

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.title}>Store Activity</Text>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, i) => `${item.at}-${i}`}
          contentContainerStyle={styles.listContent}
          onEndReachedThreshold={0.4}
          onEndReached={loadMore}
          refreshing={loading}
          onRefresh={load}
          ListEmptyComponent={<EmptyState icon={Clock} title="No activity yet" subtitle="Order and inventory activity for your store will show up here." />}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} /> : null}
          renderItem={({ item }) => {
            const Icon = KIND_ICON[item.kind];
            return (
              <View style={styles.row}>
                <View style={styles.iconCircle}>
                  <Icon size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>
                    {item.label.replace(/_/g, ' ')}
                    {item.orderNumber ? <Text style={styles.orderNumber}> · #{item.orderNumber}</Text> : null}
                  </Text>
                  <Text style={styles.time}>{timeLabel(item.at)}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.base, gap: spacing.sm, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, ...shadows.xs },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  label: { ...textStyles.bodySmall, color: colors.textPrimary, textTransform: 'capitalize' },
  orderNumber: { color: colors.textSecondary, textTransform: 'none' },
  time: { ...textStyles.caption, color: colors.textMuted, marginTop: 2 },
});
