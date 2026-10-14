import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { List, Map as MapIcon, Package, Search, Truck } from 'lucide-react-native';
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
import { adminRepository, type AdminRiderLocation } from '../../services/repositories/adminRepository';
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

export default function AdminDeliveriesScreen() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [riderLocations, setRiderLocations] = useState<AdminRiderLocation[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const canSeeMap = hasPermission('riders.view');

  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]!;

  const load = useCallback(() => {
    setLoading(true);
    adminRepository
      .getDeliveries({ statuses: activeFilter.statuses, search: search.trim() || undefined })
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [activeFilter, search]);

  const loadMap = useCallback(() => {
    if (!canSeeMap) return;
    setMapLoading(true);
    adminRepository.getActiveRiderLocations().then(setRiderLocations).catch(() => setRiderLocations([])).finally(() => setMapLoading(false));
  }, [canSeeMap]);

  useFocusEffect(load);

  // Stable across search keystrokes — see useStableCallback.
  const stableLoad = useStableCallback(load);
  useEffect(() => adminRepository.subscribeToAdminDeliveries(stableLoad), [stableLoad]);
  useRefetchOnForeground(load);

  useEffect(() => {
    if (view !== 'map') return;
    loadMap();
    return adminRepository.subscribeToAdminRiders(loadMap);
  }, [view, loadMap]);

  const selectedRider = riderLocations.find((r) => r.rider_id === selectedRiderId) ?? null;
  const { width } = useWindowDimensions();
  const narrow = width < 700;

  return (
    <AdminShell title="Deliveries" subtitle="Every delivery, live dispatch or fleet map">
      <View style={styles.toolbar}>
        <View style={styles.toolbarTopRow}>
          <View style={styles.searchBox}>
            <Search size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
            <TextInput style={styles.searchInput} placeholder="Search order #" placeholderTextColor={colors.textMuted} value={search} onChangeText={setSearch} onSubmitEditing={load} returnKeyType="search" />
          </View>
          {canSeeMap && (
            <View style={styles.viewToggle}>
              <Pressable style={[styles.viewToggleBtn, view === 'list' && styles.viewToggleBtnActive]} onPress={() => setView('list')}>
                <List size={ICON_SIZE.xs} color={view === 'list' ? colors.white : colors.textSecondary} strokeWidth={ICON_STROKE} />
                <Text style={[styles.viewToggleText, view === 'list' && styles.viewToggleTextActive]}>List</Text>
              </Pressable>
              <Pressable style={[styles.viewToggleBtn, view === 'map' && styles.viewToggleBtnActive]} onPress={() => setView('map')}>
                <MapIcon size={ICON_SIZE.xs} color={view === 'map' ? colors.white : colors.textSecondary} strokeWidth={ICON_STROKE} />
                <Text style={[styles.viewToggleText, view === 'map' && styles.viewToggleTextActive]}>Fleet Map</Text>
              </Pressable>
            </View>
          )}
        </View>
        {view === 'list' && (
          <View style={styles.filterRow}>
            {FILTERS.map((f) => {
              const active = f.key === filter;
              return (
                <Pressable key={f.key} style={[styles.filterChip, active && styles.filterChipActive]} onPress={() => setFilter(f.key)}>
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {view === 'list' ? (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.listContent}
          refreshing={loading}
          onRefresh={load}
          ListEmptyComponent={!loading ? <EmptyState icon={Truck} title="No deliveries" subtitle="No deliveries match this filter." /> : null}
          renderItem={({ item }) => {
            const age = ageMinutes(item.assigned_at);
            const delayed = age > 45 && !['completed', 'failed', 'cancelled', 'declined', 'expired'].includes(item.status);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const images: string[] = (item.orders?.order_items ?? []).map((it: any) => it.image_snapshot).filter(Boolean);
            const uniqueImages = Array.from(new Set(images)).slice(0, 2);
            return (
              <Pressable style={[styles.row, delayed && styles.rowDelayed]} onPress={() => pushAdmin(`/admin/deliveries/${item.id}`)}>
                <View style={styles.thumbStack}>
                  {uniqueImages.length === 0 ? (
                    <AppImage uri={null} style={styles.thumbStackImg} fallbackIcon={Package} />
                  ) : (
                    uniqueImages.map((img, i) => <AppImage key={i} uri={img} style={[styles.thumbStackImg, i > 0 && { marginLeft: -12 }]} fallbackIcon={Package} />)
                  )}
                </View>
                <View style={{ flex: 1.1 }}>
                  <Text style={styles.orderNumber}>#{item.orders?.order_number}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{item.orders?.profiles?.full_name ?? 'Customer'} • {item.stores?.name?.replace('Govind Pansari — ', '')}</Text>
                </View>
                <View style={styles.riderCell}>
                  <Avatar uri={item.riders?.profiles?.avatar_url} name={item.riders?.profiles?.full_name ?? 'Rider'} size="sm" />
                  <Text style={styles.meta} numberOfLines={1}>{item.riders?.profiles?.full_name ?? 'Unassigned'}</Text>
                </View>
                <Text style={styles.amount}>{formatINR(item.orders?.total ?? 0)}</Text>
                <StatusBadge status={item.status} size="sm" />
                <Text style={[styles.age, delayed && styles.ageDelayed]}>{age}m</Text>
              </Pressable>
            );
          }}
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
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  toolbar: { padding: spacing.lg, paddingBottom: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center', gap: spacing.sm },
  toolbarTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  searchBox: { flex: 1, minWidth: 200, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 42 },
  searchInput: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary, outlineStyle: 'none' as never },
  viewToggle: { flexDirection: 'row', gap: 4, backgroundColor: colors.surfaceSunken, borderRadius: radius.pill, padding: 3 },
  viewToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill },
  viewToggleBtnActive: { backgroundColor: colors.primary },
  viewToggleText: { ...textStyles.caption, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  viewToggleTextActive: { color: colors.white },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  filterChipActive: { backgroundColor: colors.primary },
  filterChipText: { ...textStyles.caption, color: colors.textSecondary },
  filterChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  listContent: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  rowDelayed: { borderColor: colors.error },
  thumbStack: { flexDirection: 'row' },
  thumbStackImg: { width: 36, height: 36, borderRadius: radius.xs, borderWidth: 2, borderColor: colors.surface },
  riderCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  orderNumber: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  meta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  amount: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold', minWidth: 60, textAlign: 'right' },
  age: { ...textStyles.caption, color: colors.textSecondary, minWidth: 32, textAlign: 'right' },
  ageDelayed: { color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
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
