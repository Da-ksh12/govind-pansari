import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { List, Map as MapIcon, Package, Search, Truck, UserPlus } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { StatusBadge } from '../../components/admin/StatusBadge';
import { FleetMap } from '../../components/admin/FleetMap';
import { Avatar } from '../../components/ui/Avatar';
import { AppImage } from '../../components/ui/AppImage';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatINR } from '../../components/ui/PriceBlock';
import { pushAdmin } from '../../services/adminNav';
import { useAdminStore } from '../../store/adminStore';
import { adminRepository, type AdminOrderRow, type AdminRiderLocation } from '../../services/repositories/adminRepository';
import { AssignRiderModal } from '../../components/admin/AssignRiderModal';
import { FilterChipRow } from '../../components/admin/FilterChipRow';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';
import { useStableCallback } from '../../hooks/useStableCallback';

function ageMinutes(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
}

const FILTERS: { key: string; label: string; statuses?: string[] }[] = [
  { key: 'all', label: 'All' },
  { key: 'assigned', label: 'Assigned', statuses: ['assigned'] },
  { key: 'accepted', label: 'Accepted', statuses: ['accepted'] },
  { key: 'at_store', label: 'At Store', statuses: ['at_store'] },
  { key: 'picked_up', label: 'Picked Up', statuses: ['picked_up'] },
  { key: 'in_transit', label: 'On the Way', statuses: ['in_transit'] },
  { key: 'completed', label: 'Delivered', statuses: ['completed'] },
  { key: 'failed', label: 'Failed', statuses: ['failed', 'declined', 'expired'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
];

type DeliveriesView = 'list' | 'map' | 'needs-rider';

export default function AdminDeliveriesScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const canSeeMap = hasPermission('riders.view');
  const canAssign = hasPermission('deliveries.assign');
  const [view, setView] = useState<DeliveriesView>(params.tab === 'needs-rider' && canAssign ? 'needs-rider' : 'list');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [riderLocations, setRiderLocations] = useState<AdminRiderLocation[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const [needsRider, setNeedsRider] = useState<AdminOrderRow[]>([]);
  const [needsRiderLoading, setNeedsRiderLoading] = useState(false);
  const [needsRiderError, setNeedsRiderError] = useState<string | null>(null);
  const [assignOrder, setAssignOrder] = useState<AdminOrderRow | null>(null);

  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;

  // `silent` is a live refresh (a realtime event, a reconnect, back to the foreground): it keeps the list on screen and a
  // failed refresh leaves it as it was. A first load or a retry is not silent and still reports a failure as a failure.
  const load = useCallback(
    (silent = false) => {
      if (!silent) {
        setLoading(true);
        setLoadError(null);
      }
      adminRepository
        .getDeliveries({ statuses: activeFilter.statuses, search: search.trim() || undefined })
        .then((r) => {
          setRows(r);
          setLoadError(null);
        })
        .catch((e) => {
          if (silent) return;
          // A failed query must read as a failure. It used to be turned into an
          // empty list, which is how a PostgREST embed error looked like
          // "No deliveries match this filter" while the dashboard showed three.
          // eslint-disable-next-line no-console
          console.warn('[admin deliveries] load failed:', e instanceof Error ? e.message : e);
          setRows([]);
          setLoadError("Couldn't load deliveries. Check your connection and try again.");
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [activeFilter, search],
  );

  const loadNeedsRider = useCallback(
    (silent = false) => {
      if (!canAssign) return;
      if (!silent) {
        setNeedsRiderLoading(true);
        setNeedsRiderError(null);
      }
      adminRepository
        .getOrdersNeedingRider()
        .then((r) => {
          setNeedsRider(r);
          setNeedsRiderError(null);
        })
        .catch((e) => {
          if (silent) return;
          // eslint-disable-next-line no-console
          console.warn('[admin deliveries] ready orders failed to load:', e instanceof Error ? e.message : e);
          setNeedsRider([]);
          setNeedsRiderError("Couldn't load the ready orders. Check your connection and try again.");
        })
        .finally(() => {
          if (!silent) setNeedsRiderLoading(false);
        });
    },
    [canAssign],
  );

  useEffect(() => {
    if (params.tab === 'needs-rider' && canAssign) setView('needs-rider');
  }, [params.tab, canAssign]);

  // Ready orders change whenever an order is packed, assigned or cancelled —
  // refetch on the same realtime signal the Orders list uses.
  const stableLoadNeedsRider = useStableCallback(() => loadNeedsRider(true));
  useEffect(() => {
    if (view !== 'needs-rider') return;
    loadNeedsRider();
    return adminRepository.subscribeToAdminOrders(stableLoadNeedsRider);
  }, [view, loadNeedsRider, stableLoadNeedsRider]);

  const loadMap = useCallback(
    (silent = false) => {
      if (!canSeeMap) return;
      if (!silent) setMapLoading(true);
      adminRepository
        .getActiveRiderLocations()
        .then(setRiderLocations)
        .catch(() => {
          if (!silent) setRiderLocations([]);
        })
        .finally(() => {
          if (!silent) setMapLoading(false);
        });
    },
    [canSeeMap],
  );

  useFocusEffect(load);

  // Stable across search keystrokes — see useStableCallback.
  const stableLoad = useStableCallback(() => load(true));
  useEffect(() => adminRepository.subscribeToAdminDeliveries(stableLoad), [stableLoad]);
  useRefetchOnForeground(stableLoad);

  const stableLoadMap = useStableCallback(() => loadMap(true));
  useEffect(() => {
    if (view !== 'map') return;
    loadMap();
    return adminRepository.subscribeToAdminRiders(stableLoadMap);
  }, [view, loadMap, stableLoadMap]);

  const selectedRider = riderLocations.find((r) => r.rider_id === selectedRiderId) ?? null;
  const { width } = useWindowDimensions();
  const narrow = width < 700;

  // Search, view switch and filters are the FIRST rows of the list views (not a fixed block above them), so the list gets all
  // the remaining height. Only the map keeps them in a fixed bar, because a map is not a scrolling list.
  const toolbar = (
    <View style={styles.toolbar}>
      <View style={styles.toolbarTopRow}>
        <View style={styles.searchBox}>
          <Search size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          <TextInput style={styles.searchInput} placeholder="Search order #" placeholderTextColor={colors.textMuted} value={search} onChangeText={setSearch} onSubmitEditing={() => load()} returnKeyType="search" />
        </View>
        {(canSeeMap || canAssign) && (
          <View style={styles.viewToggle}>
            <Pressable style={[styles.viewToggleBtn, view === 'list' && styles.viewToggleBtnActive]} onPress={() => setView('list')}>
              <List size={ICON_SIZE.xs} color={view === 'list' ? colors.white : colors.textSecondary} strokeWidth={ICON_STROKE} />
              <Text style={[styles.viewToggleText, view === 'list' && styles.viewToggleTextActive]}>List</Text>
            </Pressable>
            {canAssign && (
              <Pressable style={[styles.viewToggleBtn, view === 'needs-rider' && styles.viewToggleBtnActive]} onPress={() => setView('needs-rider')}>
                <UserPlus size={ICON_SIZE.xs} color={view === 'needs-rider' ? colors.white : colors.textSecondary} strokeWidth={ICON_STROKE} />
                <Text style={[styles.viewToggleText, view === 'needs-rider' && styles.viewToggleTextActive]}>Needs Rider</Text>
              </Pressable>
            )}
            {canSeeMap && (
              <Pressable style={[styles.viewToggleBtn, view === 'map' && styles.viewToggleBtnActive]} onPress={() => setView('map')}>
                <MapIcon size={ICON_SIZE.xs} color={view === 'map' ? colors.white : colors.textSecondary} strokeWidth={ICON_STROKE} />
                <Text style={[styles.viewToggleText, view === 'map' && styles.viewToggleTextActive]}>Fleet Map</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
      {view === 'list' && <FilterChipRow options={FILTERS.map((f) => ({ key: f.key, label: f.label }))} selected={filter} onSelect={setFilter} />}
    </View>
  );

  return (
    <AdminShell title="Deliveries" subtitle="Every delivery, live dispatch or fleet map">
      {view === 'map' && <View style={styles.mapToolbarWrap}>{toolbar}</View>}

      {view === 'needs-rider' ? (
        <FlatList
          style={styles.list}
          data={needsRider}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.listContent}
          refreshing={needsRiderLoading}
          onRefresh={loadNeedsRider}
          ListHeaderComponent={
            <>
              {toolbar}
              {needsRider.length > 0 && (
                <Text style={styles.needsRiderHint}>
                  {needsRider.length} ready order{needsRider.length === 1 ? '' : 's'} waiting for a rider. The red time is how long the order has been open.
                </Text>
              )}
            </>
          }
          ListEmptyComponent={
            !needsRiderLoading ? (
              needsRiderError ? (
                <EmptyState icon={Package} title="Couldn't load ready orders" subtitle={needsRiderError} ctaLabel="Try Again" onPressCta={() => loadNeedsRider()} />
              ) : (
                <EmptyState icon={Package} title="No orders are waiting for a rider" subtitle="Orders appear here once a store marks them ready for pickup." />
              )
            ) : null
          }
          renderItem={({ item }) => <NeedsRiderCard item={item} narrow={narrow} onAssign={() => setAssignOrder(item)} />}
        />
      ) : view === 'list' ? (
        <FlatList
          style={styles.list}
          data={rows}
          ListHeaderComponent={toolbar}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.listContent}
          refreshing={loading}
          onRefresh={load}
          ListEmptyComponent={
            !loading ? (
              loadError ? (
                <EmptyState icon={Truck} title="Couldn't load deliveries" subtitle={loadError} ctaLabel="Try Again" onPressCta={() => load()} />
              ) : (
                <EmptyState icon={Truck} title="No deliveries" subtitle="No deliveries match this filter." />
              )
            ) : null
          }
          renderItem={({ item }) => <DeliveryCard item={item} narrow={narrow} />}
        />
      ) : (
        <View style={[styles.mapArea, narrow && styles.mapAreaNarrow]}>
          <View style={styles.mapContainer}>
            {!mapLoading && riderLocations.length === 0 ? (
              <EmptyState icon={Truck} title="No riders with a known position" subtitle="Riders appear here once they've shared a live location." />
            ) : (
              <FleetMap riders={riderLocations} selectedId={selectedRiderId} onSelectRider={setSelectedRiderId} />
            )}
          </View>
          {selectedRider && (
            <View style={[styles.selectedCard, narrow && styles.selectedCardNarrow]}>
              <Text style={styles.selectedName}>{selectedRider.full_name}</Text>
              <Text style={styles.meta}>{selectedRider.vehicle_type} • {selectedRider.phone}</Text>
              <View style={{ marginTop: spacing.xs }}>
                <StatusBadge status={selectedRider.is_available ? 'online' : 'offline'} size="sm" />
              </View>
              {selectedRider.active_order_number && (
                <Pressable style={styles.selectedOrderLink} onPress={() => router.push(`/admin/orders/${selectedRider.active_order_id}` as never)}>
                  <Text style={styles.selectedOrderLinkText}>On order #{selectedRider.active_order_number} ({selectedRider.active_store_name}) →</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}

      <AssignRiderModal
        order={assignOrder}
        onClose={() => setAssignOrder(null)}
        onChanged={() => {
          loadNeedsRider();
          load();
        }}
      />
    </AdminShell>
  );
}

// On a wide screen a delivery is one row. On a phone six things in one row left the order number a few pixels wide (it wrapped one
// fragment per line) and ran the rider's name into the price — so there it is a two-line card: what and who on top, who and how much below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DeliveryCard({ item, narrow }: { item: any; narrow: boolean }) {
  const age = ageMinutes(item.assigned_at);
  const delayed = age > 45 && !['completed', 'failed', 'cancelled', 'declined', 'expired'].includes(item.status);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const images: string[] = (item.orders?.order_items ?? []).map((it: any) => it.image_snapshot).filter(Boolean);
  const uniqueImages = Array.from(new Set(images)).slice(0, 2);
  const riderName: string = item.riders?.profiles?.full_name ?? 'Unassigned';

  const thumbs = (
    <View style={styles.thumbStack}>
      {uniqueImages.length === 0 ? (
        <AppImage uri={null} style={styles.thumbStackImg} fallbackIcon={Package} />
      ) : (
        uniqueImages.map((img, i) => <AppImage key={i} uri={img} style={[styles.thumbStackImg, i > 0 && { marginLeft: -12 }]} fallbackIcon={Package} />)
      )}
    </View>
  );
  const orderBlock = (
    <View style={styles.orderBlock}>
      <Text style={styles.orderNumber} numberOfLines={1}>#{item.orders?.order_number}</Text>
      <Text style={styles.meta} numberOfLines={1}>{item.orders?.profiles?.full_name ?? 'Customer'} • {item.stores?.name?.replace('Govind Pansari — ', '')}</Text>
    </View>
  );
  const rider = (
    <View style={styles.riderCell}>
      <Avatar uri={item.riders?.profiles?.avatar_url} name={item.riders?.profiles?.full_name ?? 'Rider'} size="sm" />
      <Text style={[styles.meta, styles.riderName]} numberOfLines={1}>{riderName}</Text>
    </View>
  );
  const amount = <Text style={styles.amount}>{formatINR(item.orders?.total ?? 0)}</Text>;
  const ageText = <Text style={[styles.age, delayed && styles.ageDelayed]}>{age}m</Text>;
  const open = () => pushAdmin(`/admin/deliveries/${item.id}`);

  if (narrow) {
    return (
      <Pressable style={[styles.card, delayed && styles.rowDelayed]} onPress={open}>
        <View style={styles.cardTop}>
          {thumbs}
          {orderBlock}
          <View style={styles.noShrink}><StatusBadge status={item.status} size="sm" /></View>
        </View>
        <View style={styles.cardBottom}>
          {rider}
          {amount}
          {ageText}
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable style={[styles.row, delayed && styles.rowDelayed]} onPress={open}>
      {thumbs}
      {orderBlock}
      {rider}
      {amount}
      <StatusBadge status={item.status} size="sm" />
      {ageText}
    </Pressable>
  );
}

function NeedsRiderCard({ item, narrow, onAssign }: { item: AdminOrderRow; narrow: boolean; onAssign: () => void }) {
  const age = ageMinutes(item.placed_at);
  const orderBlock = (
    <View style={styles.orderBlock}>
      <Text style={styles.orderNumber} numberOfLines={1}>#{item.order_number}</Text>
      <Text style={styles.meta} numberOfLines={1}>{item.customer_name} • {item.store_name.replace('Govind Pansari — ', '')}</Text>
    </View>
  );
  const ageText = <Text style={[styles.age, age > 45 && styles.ageDelayed]}>{age}m</Text>;
  const assign = (
    <Pressable style={styles.assignBtn} onPress={onAssign} accessibilityLabel={`Assign a rider to order ${item.order_number}`}>
      <UserPlus size={ICON_SIZE.xs} color={colors.white} strokeWidth={ICON_STROKE} />
      <Text style={styles.assignBtnText}>Assign</Text>
    </Pressable>
  );

  if (narrow) {
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          {orderBlock}
          {ageText}
        </View>
        <View style={styles.cardBottom}>
          <Text style={[styles.amount, styles.amountLeft]}>{formatINR(item.total)}</Text>
          {assign}
        </View>
      </View>
    );
  }
  return (
    <View style={styles.row}>
      {orderBlock}
      <Text style={styles.amount}>{formatINR(item.total)}</Text>
      {ageText}
      {assign}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, minHeight: 0 },
  toolbar: { gap: spacing.sm, paddingBottom: spacing.xs },
  mapToolbarWrap: { padding: spacing.lg, paddingBottom: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  toolbarTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  searchBox: { flex: 1, minWidth: 200, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 42 },
  searchInput: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary, outlineStyle: 'none' as never },
  viewToggle: { flexDirection: 'row', gap: 4, backgroundColor: colors.surfaceSunken, borderRadius: radius.pill, padding: 3 },
  viewToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill },
  viewToggleBtnActive: { backgroundColor: colors.primary },
  viewToggleText: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  viewToggleTextActive: { color: colors.white },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  filterChipActive: { backgroundColor: colors.primary },
  filterChipText: { ...textStyles.caption, color: colors.textSecondary },
  filterChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  card: {
    gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  rowDelayed: { borderColor: colors.error },
  thumbStack: { flexDirection: 'row', flexShrink: 0 },
  thumbStackImg: { width: 36, height: 36, borderRadius: radius.xs, borderWidth: 2, borderColor: colors.surface },
  // minWidth 0 lets a flex child shrink below its text's natural width — without it a long name pushes its neighbours out.
  orderBlock: { flex: 1.1, minWidth: 0 },
  noShrink: { flexShrink: 0 },
  riderCell: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  riderName: { flexShrink: 1, marginTop: 0 },
  amountLeft: { flex: 1, textAlign: 'left' },
  orderNumber: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  meta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  amount: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold', minWidth: 60, textAlign: 'right' },
  age: { ...textStyles.caption, color: colors.textSecondary, minWidth: 32, textAlign: 'right' },
  ageDelayed: { color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
  needsRiderHint: { ...textStyles.caption, color: colors.textSecondary, marginBottom: spacing.xs },
  assignBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 9 },
  assignBtnText: { ...textStyles.caption, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  mapArea: { flex: 1, flexDirection: 'row', padding: spacing.lg, paddingTop: 0, gap: spacing.md, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  mapAreaNarrow: { flexDirection: 'column' },
  mapContainer: { flex: 1, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  selectedCard: {
    width: 260, alignSelf: 'flex-start', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  selectedCardNarrow: { width: '100%', alignSelf: 'stretch' },
  selectedName: { ...textStyles.cardTitle, fontSize: 15, color: colors.textPrimary },
  selectedOrderLink: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  selectedOrderLinkText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
});
