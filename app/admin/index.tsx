import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { pushAdmin } from '../../services/adminNav';
import {
  ShoppingBag, IndianRupee, TrendingUp, Truck, CheckCircle2, XCircle, UserPlus,
  AlertTriangle, PackageX, Bike, Timer, Clock3, CircleCheck, Store as StoreIcon,
  PlusCircle, ClipboardList, Boxes, UserRoundPlus, Building2, ArrowRight,
} from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { StatCard } from '../../components/admin/StatCard';
import { StatusBadge } from '../../components/admin/StatusBadge';
import { Avatar } from '../../components/ui/Avatar';
import { AppImage } from '../../components/ui/AppImage';
import { Skeleton } from '../../components/ui/Skeleton';
import { AnimatedPressable } from '../../components/motion/AnimatedPressable';
import { formatINR } from '../../components/ui/PriceBlock';
import { adminRepository, type AdminDashboard, type AdminStorePerformance } from '../../services/repositories/adminRepository';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';
import { useAuthStore } from '../../store/authStore';

/** Real day-over-day % change — undefined (no trend shown) rather than a fabricated number when yesterday was zero. */
function pctChange(today: number, yesterday: number): number | undefined {
  if (yesterday === 0) return today > 0 ? undefined : 0;
  return ((today - yesterday) / yesterday) * 100;
}

function minutesLabel(v: number | null): string {
  if (v == null) return '—';
  return v < 60 ? `${v} min` : `${Math.floor(v / 60)}h ${Math.round(v % 60)}m`;
}

const PIPELINE_STAGES: { key: string; label: string; statuses: string[] }[] = [
  { key: 'new', label: 'New', statuses: ['placed'] },
  { key: 'confirmed', label: 'Confirmed', statuses: ['confirmed'] },
  { key: 'preparing', label: 'Preparing', statuses: ['preparing', 'picking', 'packing'] },
  { key: 'ready', label: 'Ready', statuses: ['packed'] },
  { key: 'rider', label: 'Rider Assigned', statuses: ['rider_assigned'] },
  { key: 'onway', label: 'On the Way', statuses: ['out_for_delivery', 'approaching'] },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered'] },
];

export default function AdminDashboardScreen() {
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [stores, setStores] = useState<AdminStorePerformance[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [liveDeliveries, setLiveDeliveries] = useState<any[]>([]);
  const [totalSkus, setTotalSkus] = useState<number | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [priorityItems, setPriorityItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const profile = useAuthStore((s) => s.profile);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      adminRepository.getDashboard(),
      adminRepository.getStorePerformance().catch(() => []),
      adminRepository.getRecentOrdersWithThumbnails(6).catch(() => []),
      adminRepository.getActiveDeliveries().catch(() => []),
      adminRepository.getInventoryStats().catch(() => null),
      adminRepository.getInventory({ lowStockOnly: true, limit: 4 }).catch(() => []),
    ])
      .then(([d, sp, ro, ld, stats, priority]) => {
        setDashboard(d);
        setStores(sp);
        setRecentOrders(ro);
        setLiveDeliveries(ld.slice(0, 5));
        setTotalSkus(stats?.totalSkus ?? null);
        setPriorityItems(priority);
      })
      .catch(() => setDashboard(null))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);
  useEffect(() => adminRepository.subscribeToAdminDashboard(load), [load]);
  useRefetchOnForeground(load);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = profile?.name?.split(' ')[0];

  const attentionItems = dashboard
    ? [
        dashboard.operations.pendingOrders > 0 && {
          tone: 'error' as const,
          text: `${dashboard.operations.pendingOrders} order${dashboard.operations.pendingOrders === 1 ? '' : 's'} waiting for processing`,
          cta: 'View Orders',
          onPress: () => pushAdmin('/admin/orders?status=placed'),
        },
        dashboard.inventory.lowStock > 0 && {
          tone: 'warning' as const,
          text: `${dashboard.inventory.lowStock} product${dashboard.inventory.lowStock === 1 ? '' : 's'} need restocking`,
          cta: 'Review Inventory',
          onPress: () => pushAdmin('/admin/inventory?lowStock=1'),
        },
        dashboard.today.activeDeliveries > 0 && {
          tone: 'info' as const,
          text: `${dashboard.today.activeDeliveries} ${dashboard.today.activeDeliveries === 1 ? 'delivery is' : 'deliveries are'} currently in progress`,
          cta: 'View Deliveries',
          onPress: () => pushAdmin('/admin/deliveries'),
        },
        dashboard.operations.unassignedDeliveries > 0 && {
          tone: 'error' as const,
          text: `${dashboard.operations.unassignedDeliveries} ready order${dashboard.operations.unassignedDeliveries === 1 ? '' : 's'} still needs a rider`,
          cta: 'Assign Rider',
          onPress: () => pushAdmin('/admin/deliveries'),
        },
      ].filter((x): x is Exclude<typeof x, false> => !!x)
    : [];

  return (
    <AdminShell title="Dashboard" subtitle="Govind Pansari Operations">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading && !!dashboard} onRefresh={load} tintColor={colors.primary} />}
      >
        {!dashboard && loading ? (
          <DashboardSkeleton />
        ) : !dashboard ? (
          <Text style={styles.errorText}>Couldn't load the dashboard. Pull to refresh.</Text>
        ) : (
          <>
            {/* ---------------------------------------------------- Header ---------------------------------------------------- */}
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.greeting}>{greeting}{firstName ? `, ${firstName}` : ''}</Text>
                <View style={styles.liveRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>{stores.length} store{stores.length === 1 ? '' : 's'} • Live</Text>
                </View>
              </View>
            </View>

            {/* ---------------------------------------------------- KPI grid ---------------------------------------------------- */}
            <View style={styles.grid}>
              <StatCard label="Today's Orders" value={dashboard.today.orders} icon={ShoppingBag} trend={pctChange(dashboard.today.orders, dashboard.yesterday.orders)} onPress={() => pushAdmin('/admin/orders')} />
              <StatCard label="Today's Revenue" value={formatINR(dashboard.today.revenue)} icon={IndianRupee} trend={pctChange(dashboard.today.revenue, dashboard.yesterday.revenue)} />
              <StatCard
                label="Active Orders"
                value={dashboard.operations.pendingOrders + dashboard.operations.ordersPreparing + dashboard.operations.ordersReady}
                icon={ClipboardList}
                tone={dashboard.operations.pendingOrders > 0 ? 'warning' : 'default'}
                onPress={() => pushAdmin('/admin/orders')}
              />
              <StatCard label="Deliveries In Progress" value={dashboard.today.activeDeliveries} icon={Truck} onPress={() => pushAdmin('/admin/deliveries')} />
              <StatCard label="Avg. Fulfilment Time" value={minutesLabel(dashboard.operations.avgFulfillmentMinutes)} icon={Clock3} />
              <StatCard label="Avg. Delivery Time" value={minutesLabel(dashboard.operations.avgDeliveryMinutes)} icon={Bike} />
              <StatCard label="Low Stock" value={dashboard.inventory.lowStock} icon={AlertTriangle} tone={dashboard.inventory.lowStock > 0 ? 'warning' : 'default'} onPress={() => pushAdmin('/admin/inventory?lowStock=1')} />
              <StatCard label="Out of Stock" value={dashboard.inventory.outOfStock} icon={PackageX} tone={dashboard.inventory.outOfStock > 0 ? 'error' : 'default'} onPress={() => pushAdmin('/admin/inventory?lowStock=1')} />
            </View>

            {/* ---------------------------------------------------- Needs attention ---------------------------------------------------- */}
            <SectionLabel text="Needs Your Attention" />
            {attentionItems.length === 0 ? (
              <View style={styles.allClearCard}>
                <CircleCheck size={ICON_SIZE.md} color={colors.success} strokeWidth={ICON_STROKE} />
                <Text style={styles.allClearText}>Everything is running normally</Text>
              </View>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {attentionItems.map((item, i) => (
                  <AnimatedPressable key={i} style={styles.attentionCard} pressScale={0.98} onPress={item.onPress}>
                    <View style={[styles.attentionDot, { backgroundColor: TONE_COLOR[item.tone] }]} />
                    <Text style={styles.attentionText}>{item.text}</Text>
                    <View style={styles.attentionCtaRow}>
                      <Text style={[styles.attentionCta, { color: TONE_COLOR[item.tone] }]}>{item.cta}</Text>
                      <ArrowRight size={13} color={TONE_COLOR[item.tone]} strokeWidth={2.5} />
                    </View>
                  </AnimatedPressable>
                ))}
              </View>
            )}

            {/* ---------------------------------------------------- Order pipeline ---------------------------------------------------- */}
            <SectionLabel text="Live Order Pipeline" />
            <View style={styles.pipelineCard}>
              {PIPELINE_STAGES.map((stage, i) => {
                const count = stage.statuses.reduce((sum, s) => sum + (dashboard.operations.todayByStatus?.[s] ?? 0), 0);
                return (
                  <React.Fragment key={stage.key}>
                    <Pressable style={styles.pipelineStage} onPress={() => pushAdmin(`/admin/orders?status=${stage.statuses[0]}`)}>
                      <Text style={[styles.pipelineValue, count > 0 && { color: colors.primary }]}>{count}</Text>
                      <Text style={styles.pipelineLabel}>{stage.label}</Text>
                    </Pressable>
                    {i < PIPELINE_STAGES.length - 1 && <View style={styles.pipelineArrow} />}
                  </React.Fragment>
                );
              })}
            </View>

            {/* ---------------------------------------------------- Recent orders ---------------------------------------------------- */}
            <View style={styles.sectionHeaderRow}>
              <SectionLabel text="Recent Orders" />
              <Pressable onPress={() => pushAdmin('/admin/orders')}><Text style={styles.viewAllLink}>View all</Text></Pressable>
            </View>
            {recentOrders.length === 0 ? (
              <Text style={styles.emptyHint}>No orders yet today.</Text>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {recentOrders.map((order: any) => {
                  const images: string[] = (order.order_items ?? []).map((it: any) => it.image_snapshot).filter(Boolean);
                  const uniqueImages = Array.from(new Set(images)).slice(0, 3);
                  const extra = (order.order_items?.length ?? 0) - uniqueImages.length;
                  const rider = order.delivery_assignments?.[0]?.riders?.profiles?.full_name ?? null;
                  return (
                    <AnimatedPressable key={order.id} style={styles.orderCard} pressScale={0.98} onPress={() => pushAdmin(`/admin/orders/${order.id}`)}>
                      <View style={styles.thumbStack}>
                        {uniqueImages.length === 0 ? (
                          <AppImage uri={null} style={styles.thumbStackImg} kind="product" />
                        ) : (
                          uniqueImages.map((img, i) => <AppImage key={i} uri={img} style={[styles.thumbStackImg, i > 0 && { marginLeft: -14 }]} kind="product" />)
                        )}
                        {extra > 0 && (
                          <View style={[styles.thumbExtra, { marginLeft: -14 }]}>
                            <Text style={styles.thumbExtraText}>+{extra}</Text>
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.orderNumber}>#{order.order_number}</Text>
                        <Text style={styles.orderMeta} numberOfLines={1}>
                          {order.profiles?.full_name ?? 'Customer'} • {order.order_items?.length ?? 0} items • {order.stores?.name ?? ''}
                        </Text>
                        {rider && <Text style={styles.orderRider}>Rider: {rider}</Text>}
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <Text style={styles.orderTotal}>{formatINR(order.total)}</Text>
                        <StatusBadge status={order.status} size="sm" />
                      </View>
                    </AnimatedPressable>
                  );
                })}
              </View>
            )}

            {/* ---------------------------------------------------- Store performance ---------------------------------------------------- */}
            {stores.length > 0 && (
              <>
                <SectionLabel text="Store Performance" />
                <View style={styles.storeRow}>
                  {stores.map((s) => (
                    <AnimatedPressable key={s.store_id} style={styles.storeCard} pressScale={0.98} onPress={() => pushAdmin('/admin/stores')}>
                      <View style={styles.storeCardHeader}>
                        <View style={styles.storeIconChip}>
                          <Building2 size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                        </View>
                        <Text style={styles.storeName} numberOfLines={1}>{s.store_name.replace('Govind Pansari — ', '')}</Text>
                      </View>
                      <View style={styles.storeStatsRow}>
                        <StoreStat label="Orders" value={String(s.today_orders)} />
                        <StoreStat label="Revenue" value={formatINR(s.today_revenue)} />
                        <StoreStat label="Active" value={String(s.active_orders)} />
                      </View>
                      <View style={styles.storeStatsRow}>
                        <StoreStat label="Fulfil" value={minutesLabel(s.avg_fulfillment_minutes)} />
                        <StoreStat label="Delivery" value={minutesLabel(s.avg_delivery_minutes)} />
                        <StoreStat label="Low Stock" value={String(s.low_stock)} warn={s.low_stock > 0} />
                      </View>
                    </AnimatedPressable>
                  ))}
                </View>
              </>
            )}

            {/* ---------------------------------------------------- Live deliveries ---------------------------------------------------- */}
            <View style={styles.sectionHeaderRow}>
              <SectionLabel text="Live Deliveries" />
              <Pressable onPress={() => pushAdmin('/admin/deliveries')}><Text style={styles.viewAllLink}>View all</Text></Pressable>
            </View>
            {liveDeliveries.length === 0 ? (
              <Text style={styles.emptyHint}>No riders currently out on delivery.</Text>
            ) : (
              <View style={{ gap: spacing.sm }}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {liveDeliveries.map((d: any) => (
                  <AnimatedPressable key={d.id} style={styles.deliveryCard} pressScale={0.98} onPress={() => pushAdmin(`/admin/orders/${d.order_id}`)}>
                    <Avatar uri={d.riders?.profiles?.avatar_url} name={d.riders?.profiles?.full_name ?? 'Rider'} size="md" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.orderNumber}>{d.riders?.profiles?.full_name ?? 'Unassigned'}</Text>
                      <Text style={styles.orderMeta}>#{d.orders?.order_number} • {d.stores?.name?.replace('Govind Pansari — ', '') ?? ''}</Text>
                    </View>
                    <StatusBadge status={d.status} size="sm" />
                  </AnimatedPressable>
                ))}
              </View>
            )}

            {/* ---------------------------------------------------- Inventory health ---------------------------------------------------- */}
            <SectionLabel text="Inventory Health" />
            <View style={styles.grid}>
              <StatCard label="Healthy" value={totalSkus != null ? Math.max(0, totalSkus - dashboard.inventory.lowStock - dashboard.inventory.outOfStock) : '—'} icon={Boxes} tone="success" />
              <StatCard label="Low Stock" value={dashboard.inventory.lowStock} icon={AlertTriangle} tone={dashboard.inventory.lowStock > 0 ? 'warning' : 'default'} onPress={() => pushAdmin('/admin/inventory?lowStock=1')} />
              <StatCard label="Out of Stock" value={dashboard.inventory.outOfStock} icon={PackageX} tone={dashboard.inventory.outOfStock > 0 ? 'error' : 'default'} onPress={() => pushAdmin('/admin/inventory?lowStock=1')} />
            </View>
            {priorityItems.length > 0 && (
              <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {priorityItems.map((item: any) => (
                  <AnimatedPressable key={item.id} style={styles.priorityRow} pressScale={0.98} onPress={() => pushAdmin('/admin/inventory?lowStock=1')}>
                    <AppImage uri={item.product_image} style={styles.priorityThumb} kind="product" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.orderNumber} numberOfLines={1}>{item.product_name}</Text>
                      <Text style={styles.orderMeta}>{item.store_name} • Available: {item.available_quantity}</Text>
                    </View>
                    <StatusBadge status={item.stock_status} size="sm" />
                  </AnimatedPressable>
                ))}
              </View>
            )}

            {/* ---------------------------------------------------- Quick actions ---------------------------------------------------- */}
            <SectionLabel text="Quick Actions" />
            <View style={styles.quickGrid}>
              <QuickAction icon={PlusCircle} label="Add Product" onPress={() => pushAdmin('/admin/products/new')} />
              <QuickAction icon={ClipboardList} label="View Orders" onPress={() => pushAdmin('/admin/orders')} />
              <QuickAction icon={Boxes} label="Manage Inventory" onPress={() => pushAdmin('/admin/inventory')} />
              <QuickAction icon={Truck} label="View Deliveries" onPress={() => pushAdmin('/admin/deliveries')} />
              <QuickAction icon={UserRoundPlus} label="Manage Riders" onPress={() => pushAdmin('/admin/riders')} />
              <QuickAction icon={StoreIcon} label="Manage Stores" onPress={() => pushAdmin('/admin/stores')} />
            </View>
          </>
        )}
      </ScrollView>
    </AdminShell>
  );
}

const TONE_COLOR = { error: colors.error, warning: colors.warning, info: colors.info } as const;

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>;
}

function StoreStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.storeStatValue, warn && { color: colors.warning }]}>{value}</Text>
      <Text style={styles.storeStatLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ icon: Icon, label, onPress }: { icon: typeof PlusCircle; label: string; onPress: () => void }) {
  return (
    <AnimatedPressable style={styles.quickAction} pressScale={0.94} onPress={onPress}>
      <View style={styles.quickActionIcon}>
        <Icon size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
      </View>
      <Text style={styles.quickActionLabel} numberOfLines={2}>{label}</Text>
    </AnimatedPressable>
  );
}

function DashboardSkeleton() {
  return (
    <View style={{ gap: spacing.lg }}>
      <Skeleton width="55%" height={26} />
      <View style={styles.grid}>
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} width={160} height={104} borderRadius={radius.lg} />)}
      </View>
      <Skeleton width="100%" height={90} borderRadius={radius.lg} />
      <Skeleton width="100%" height={140} borderRadius={radius.lg} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.xl, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  errorText: { ...textStyles.bodySmall, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.xxl },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  greeting: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: colors.textPrimary },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  liveText: { ...textStyles.bodySmall, color: colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sectionLabel: { ...textStyles.cardTitle, fontSize: 13, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewAllLink: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold', marginTop: spacing.lg },
  emptyHint: { ...textStyles.bodySmall, color: colors.textMuted, paddingVertical: spacing.sm },

  allClearCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.successTint,
    borderRadius: radius.lg, padding: spacing.base,
  },
  allClearText: { ...textStyles.cardTitle, fontSize: 14, color: colors.success },
  attentionCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.base, ...shadows.xs,
  },
  attentionDot: { width: 8, height: 8, borderRadius: 4 },
  attentionText: { ...textStyles.bodySmall, color: colors.textPrimary, flex: 1 },
  attentionCtaRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  attentionCta: { ...textStyles.caption, fontFamily: 'PlusJakartaSans_700Bold' },

  pipelineCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadows.xs,
  },
  pipelineStage: { flex: 1, alignItems: 'center', paddingVertical: spacing.xs },
  pipelineValue: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 19, color: colors.textMuted },
  pipelineLabel: { ...textStyles.caption, fontSize: 10, color: colors.textSecondary, marginTop: 3, textAlign: 'center' },
  pipelineArrow: { width: 10, height: 1, backgroundColor: colors.divider },

  orderCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadows.xs,
  },
  thumbStack: { flexDirection: 'row', alignItems: 'center' },
  thumbStackImg: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.surface },
  thumbExtra: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.surface, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  thumbExtraText: { ...textStyles.caption, fontSize: 10.5, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_700Bold' },
  orderNumber: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  orderMeta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  orderRider: { ...textStyles.caption, color: colors.primary, marginTop: 2 },
  orderTotal: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },

  storeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  storeCard: {
    flexGrow: 1, flexBasis: 260, minWidth: 260, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.base, ...shadows.xs, gap: spacing.sm,
  },
  storeCardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  storeIconChip: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  storeName: { ...textStyles.cardTitle, fontSize: 15, color: colors.textPrimary, flex: 1 },
  storeStatsRow: { flexDirection: 'row', gap: spacing.sm },
  storeStatValue: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  storeStatLabel: { ...textStyles.caption, fontSize: 10.5, color: colors.textMuted, marginTop: 1 },

  deliveryCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, padding: spacing.md, ...shadows.xs,
  },

  priorityRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, padding: spacing.sm,
  },
  priorityThumb: { width: 36, height: 36, borderRadius: radius.xs },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quickAction: {
    flexGrow: 1, flexBasis: 100, minWidth: 100, alignItems: 'center', gap: spacing.xs, backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.base, ...shadows.xs,
  },
  quickActionIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  quickActionLabel: { ...textStyles.caption, color: colors.textPrimary, textAlign: 'center', fontFamily: 'PlusJakartaSans_600SemiBold' },
});
