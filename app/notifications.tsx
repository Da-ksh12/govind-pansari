import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, Bell } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { EmptyState } from '../components/ui/EmptyState';
import { NotificationCard } from '../components/notifications/NotificationCard';
import { useNotificationsStore } from '../store/notificationsStore';
import { navigateForNotification } from '../services/notifications/navigateForNotification';
import { orderRepository } from '../services/repositories/orderRepository';
import type { AppNotificationRow } from '../services/repositories/notificationRepository';
import type { NotificationType } from '../types/models';

type Category = 'all' | 'orders' | 'delivery' | 'offers';
const CATEGORY_TABS: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'orders', label: 'Orders' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'offers', label: 'Offers' },
];
function matchesCategory(type: NotificationType, category: Category): boolean {
  if (category === 'all') return true;
  if (category === 'orders') return type === 'order' || type === 'payment' || type === 'product' || type === 'system';
  if (category === 'delivery') return type === 'delivery';
  return type === 'offer' || type === 'promotional';
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationsScreen() {
  const items = useNotificationsStore((s) => s.items);
  const loading = useNotificationsStore((s) => s.loading);
  const loadingMore = useNotificationsStore((s) => s.loadingMore);
  const refresh = useNotificationsStore((s) => s.refresh);
  const loadMore = useNotificationsStore((s) => s.loadMore);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const [category, setCategory] = useState<Category>('all');
  // Real order product thumbnails, batched per unique orderId as new
  // notifications load — never a placeholder image (see NotificationCard).
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  useEffect(() => {
    const missing = Array.from(
      new Set(items.map((n) => n.data.orderId).filter((id): id is string => !!id && !(id in thumbnails))),
    );
    if (missing.length === 0) return;
    orderRepository.getOrderThumbnails(missing).then((map) => {
      if (Object.keys(map).length > 0) setThumbnails((prev) => ({ ...prev, ...map }));
    });
  }, [items, thumbnails]);

  const filtered = useMemo(() => items.filter((n) => matchesCategory(n.type, category)), [items, category]);

  const handlePress = (item: AppNotificationRow) => {
    if (!item.readAt) markRead(item.id);
    const target = navigateForNotification(item.eventType, item.data);
    if (target) router.push(target as never);
  };

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        {unreadCount > 0 && (
          <Pressable onPress={() => markAllRead()} hitSlop={8}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.tabRow}>
        {CATEGORY_TABS.map((tab) => (
          <Pressable key={tab.key} style={[styles.tab, category === tab.key && styles.tabActive]} onPress={() => setCategory(tab.key)}>
            <Text style={[styles.tabText, category === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        onEndReachedThreshold={0.4}
        onEndReached={() => loadMore()}
        refreshing={loading}
        onRefresh={refresh}
        ListEmptyComponent={
          !loading ? <EmptyState icon={Bell} title="No new updates" subtitle="Updates about your orders and deliveries will show up here." /> : null
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.primary} /> : null}
        renderItem={({ item }) => (
          <NotificationCard
            type={item.type}
            title={item.title}
            body={item.body}
            timeAgo={timeAgo(item.createdAt)}
            unread={!item.readAt}
            imageUrl={item.data.orderId ? thumbnails[item.data.orderId] : undefined}
            onPress={() => handlePress(item)}
          />
        )}
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: colors.textPrimary },
  markAllText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  tabRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.base, paddingBottom: spacing.md },
  tab: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  tabActive: { backgroundColor: colors.primary },
  tabText: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  tabTextActive: { color: colors.white },
  listContent: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxl, flexGrow: 1 },
});
