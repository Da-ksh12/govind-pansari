import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AlertTriangle, Bell, Package, ShieldAlert, Truck } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { EmptyState } from '../../components/ui/EmptyState';
import { AppImage } from '../../components/ui/AppImage';
import { useNotificationsStore } from '../../store/notificationsStore';
import { navigateForNotification } from '../../services/notifications/navigateForNotification';
import { adminRepository } from '../../services/repositories/adminRepository';
import type { AppNotificationRow, NotificationEventType } from '../../services/repositories/notificationRepository';
import type { NotificationType } from '../../types/models';

type Category = 'all' | 'alerts' | 'orders' | 'delivery';
const CATEGORY_TABS: { key: Category; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'orders', label: 'Orders' },
  { key: 'delivery', label: 'Delivery' },
];

function isAlert(eventType: NotificationEventType): boolean {
  return eventType.startsWith('admin_');
}

function matchesCategory(item: AppNotificationRow, category: Category): boolean {
  if (category === 'all') return true;
  if (category === 'alerts') return isAlert(item.eventType);
  if (category === 'delivery') return item.type === 'delivery';
  return item.type === 'order' || item.type === 'payment' || item.type === 'product';
}

const TYPE_ICON: Record<NotificationType, typeof Bell> = {
  order: Package,
  delivery: Truck,
  offer: Bell,
  payment: Bell,
  product: Bell,
  promotional: Bell,
  system: ShieldAlert,
};

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Today / Yesterday / Earlier grouping (redesign section 31) — real dates, computed from each row's own createdAt. */
function groupByDate(items: AppNotificationRow[]) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart.getTime() - 86_400_000);
  const today: AppNotificationRow[] = [];
  const yesterday: AppNotificationRow[] = [];
  const earlier: AppNotificationRow[] = [];
  for (const item of items) {
    const at = new Date(item.createdAt).getTime();
    if (at >= todayStart.getTime()) today.push(item);
    else if (at >= yesterdayStart.getTime()) yesterday.push(item);
    else earlier.push(item);
  }
  return [
    ...(today.length ? [{ title: 'Today', data: today }] : []),
    ...(yesterday.length ? [{ title: 'Yesterday', data: yesterday }] : []),
    ...(earlier.length ? [{ title: 'Earlier', data: earlier }] : []),
  ];
}

export default function AdminNotificationsScreen() {
  const items = useNotificationsStore((s) => s.items);
  const loading = useNotificationsStore((s) => s.loading);
  const loadingMore = useNotificationsStore((s) => s.loadingMore);
  const refresh = useNotificationsStore((s) => s.refresh);
  const loadMore = useNotificationsStore((s) => s.loadMore);
  const markRead = useNotificationsStore((s) => s.markRead);
  const markAllRead = useNotificationsStore((s) => s.markAllRead);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const [category, setCategory] = useState<Category>('all');
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>({});

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const filtered = useMemo(() => items.filter((n) => matchesCategory(n, category)), [items, category]);
  const sections = useMemo(() => groupByDate(filtered), [filtered]);

  // Batch-resolves a real product thumbnail per order-linked
  // notification (redesign section 29-30) — one query for every
  // not-yet-resolved order id currently on screen, never one query per
  // row, so this scales with pages loaded, not with time spent scrolling.
  useEffect(() => {
    const ids = Array.from(new Set(filtered.map((n) => n.data?.orderId).filter((id): id is string => !!id && !(id in thumbnails))));
    if (ids.length === 0) return;
    adminRepository.getOrderThumbnails(ids).then((map) => setThumbnails((prev) => ({ ...prev, ...map }))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const handlePress = (item: AppNotificationRow) => {
    if (!item.readAt) markRead(item.id);
    const target = navigateForNotification(item.eventType, item.data);
    if (target) router.push(target as never);
  };

  return (
    <AdminShell title="Notifications" subtitle="Operational alerts and updates for your account">
      <View style={styles.toolbar}>
        <View style={styles.tabRow}>
          {CATEGORY_TABS.map((tab) => (
            <Pressable key={tab.key} style={[styles.tab, category === tab.key && styles.tabActive]} onPress={() => setCategory(tab.key)}>
              <Text style={[styles.tabText, category === tab.key && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
        {unreadCount > 0 && (
          <Pressable onPress={() => markAllRead()} hitSlop={8}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </Pressable>
        )}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        onEndReachedThreshold={0.4}
        onEndReached={() => loadMore()}
        refreshing={loading}
        onRefresh={refresh}
        ListEmptyComponent={!loading ? <EmptyState icon={Bell} title="You're all caught up" subtitle="Operational alerts and updates will show up here." /> : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} /> : null}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        renderItem={({ item }) => {
          const Icon = isAlert(item.eventType) ? AlertTriangle : TYPE_ICON[item.type];
          const unread = !item.readAt;
          const alert = isAlert(item.eventType);
          const thumb = item.data?.orderId ? thumbnails[item.data.orderId] : null;
          return (
            <Pressable style={({ pressed }) => [styles.row, unread && styles.rowUnread, pressed && styles.rowPressed]} onPress={() => handlePress(item)}>
              {thumb ? (
                <AppImage uri={thumb} style={styles.thumbImage} fallbackIcon={Package} />
              ) : (
                <View style={[styles.iconChip, unread && styles.iconChipUnread, alert && styles.iconChipAlert]}>
                  <Icon size={ICON_SIZE.sm} color={alert ? colors.error : unread ? colors.primary : colors.textSecondary} strokeWidth={ICON_STROKE} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, unread && styles.titleUnread]}>{item.title}</Text>
                <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
                <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
              </View>
              {unread && <View style={styles.unreadDot} />}
            </Pressable>
          );
        }}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md,
    padding: spacing.lg, maxWidth: 900, width: '100%', alignSelf: 'center',
  },
  tabRow: { flexDirection: 'row', gap: spacing.sm },
  tab: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  tabActive: { backgroundColor: colors.primary },
  tabText: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  tabTextActive: { color: colors.white },
  markAllText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  listContent: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm, maxWidth: 900, width: '100%', alignSelf: 'center' },
  sectionHeader: {
    ...textStyles.cardTitle, fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6,
    marginTop: spacing.md, marginBottom: spacing.xs,
  },
  thumbImage: { width: 40, height: 40, borderRadius: radius.sm },
  row: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  rowUnread: { borderColor: colors.borderStrong },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  iconChip: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  iconChipUnread: { backgroundColor: colors.primaryTint },
  iconChipAlert: { backgroundColor: colors.errorTint },
  title: { ...textStyles.cardTitle, fontSize: 13.5, color: colors.textSecondary },
  titleUnread: { color: colors.textPrimary },
  body: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  time: { ...textStyles.caption, color: colors.textMuted, marginTop: 4, fontSize: 10.5 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 4 },
});
