import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, Boxes, IndianRupee, Package, PackageX, Search, Store as StoreIcon } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles, tabularNums } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { StatCard } from '../../components/admin/StatCard';
import { StatusBadge } from '../../components/admin/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { AppImage } from '../../components/ui/AppImage';
import { formatINR, formatCompactINR } from '../../components/ui/PriceBlock';
import { useAdminStore } from '../../store/adminStore';
import { useUIStore } from '../../store/uiStore';
import { adminRepository, type AdminInventoryRow } from '../../services/repositories/adminRepository';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';
import { useStableCallback } from '../../hooks/useStableCallback';

const MOVEMENT_TYPES = ['purchase', 'restock', 'damage', 'return', 'transfer', 'adjustment'] as const;

interface StoreOption { id: string; name: string }

export default function AdminInventoryScreen() {
  const params = useLocalSearchParams<{ lowStock?: string }>();
  const [rows, setRows] = useState<AdminInventoryRow[]>([]);
  const [stats, setStats] = useState<{ totalSkus: number; lowStock: number; outOfStock: number; totalValue: number } | null>(null);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(params.lowStock === '1');
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<AdminInventoryRow | null>(null);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);
  const canAdjust = hasPermission('inventory.adjust') || hasPermission('inventory.manage');

  useEffect(() => {
    adminRepository.getStores().then((s) => setStores(s as StoreOption[])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      adminRepository.getInventory({ storeId: storeId ?? undefined, search: search || undefined, lowStockOnly, limit: 40 }),
      adminRepository.getInventoryStats(storeId ?? undefined).catch(() => null),
    ])
      .then(([rowData, statData]) => {
        setRows(rowData);
        if (statData) setStats(statData);
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [search, lowStockOnly, storeId]);

  useFocusEffect(load);
  // Stable across search/filter changes — see useStableCallback.
  const stableLoad = useStableCallback(load);
  useEffect(() => adminRepository.subscribeToAdminInventory(stableLoad), [stableLoad]);
  useRefetchOnForeground(load);

  return (
    <AdminShell title="Inventory" subtitle="Track and adjust stock across every store">
      {stats && (
        <View style={styles.statsRow}>
          <StatCard label="Total SKUs" value={stats.totalSkus} icon={Boxes} />
          <StatCard label="Low Stock" value={stats.lowStock} icon={AlertTriangle} tone={stats.lowStock > 0 ? 'warning' : 'default'} onPress={() => setLowStockOnly(true)} />
          <StatCard label="Out of Stock" value={stats.outOfStock} icon={PackageX} tone={stats.outOfStock > 0 ? 'error' : 'default'} onPress={() => setLowStockOnly(true)} />
          {/* Compact (₹14.45 Cr style) so one long figure never forces
              this card wider than its neighbours — the exact value is
              still a tap away, never only available in compact form. */}
          <StatCard
            label="Stock Value"
            value={formatCompactINR(stats.totalValue)}
            icon={IndianRupee}
            onPress={() => Alert.alert('Exact Stock Value', formatINR(stats.totalValue))}
          />
        </View>
      )}

      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Search size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          <TextInput style={styles.searchInput} placeholder="Search by product name or SKU" placeholderTextColor={colors.textMuted} value={search} onChangeText={setSearch} onSubmitEditing={load} returnKeyType="search" />
        </View>
        {/* Horizontally scrollable, not wrapping — with 3+ real stores
            plus "All Stores" this used to wrap onto 2+ lines on a phone
            width, which is what was pushing the header/filter region to
            take up most of the screen before the inventory list ever
            got a chance to render. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storeRow}>
          <StoreIcon size={ICON_SIZE.xs} color={colors.textMuted} strokeWidth={ICON_STROKE} style={styles.storeRowIcon} />
          <Pressable style={[styles.filterChip, !storeId && styles.filterChipActive]} onPress={() => setStoreId(null)}>
            <Text style={[styles.filterChipText, !storeId && styles.filterChipTextActive]}>All Stores</Text>
          </Pressable>
          {stores.map((s) => (
            <Pressable key={s.id} style={[styles.filterChip, storeId === s.id && styles.filterChipActive]} onPress={() => setStoreId(s.id)}>
              <Text style={[styles.filterChipText, storeId === s.id && styles.filterChipTextActive]} numberOfLines={1}>{s.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable style={[styles.filterChip, styles.lowStockChip, lowStockOnly && styles.lowStockChipActive]} onPress={() => setLowStockOnly((v) => !v)}>
          <AlertTriangle size={ICON_SIZE.xs} color={lowStockOnly ? colors.white : colors.textSecondary} strokeWidth={ICON_STROKE} />
          <Text style={[styles.filterChipText, lowStockOnly && styles.filterChipTextActive]}>Low / out of stock only</Text>
        </Pressable>
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.listContent}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={!loading ? <EmptyState icon={PackageX} title="No inventory rows" subtitle="No inventory matches this filter." /> : null}
        renderItem={({ item }) => {
          const healthPct = item.quantity > 0 ? Math.max(0, Math.min(100, Math.round((item.available_quantity / item.quantity) * 100))) : 0;
          const healthColor = item.stock_status === 'out_of_stock' ? colors.error : item.stock_status === 'low_stock' ? colors.warning : colors.success;
          return (
            <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={() => canAdjust && setTarget(item)}>
              <AppImage uri={item.product_image} style={styles.thumb} fallbackIcon={Package} />
              <View style={{ flex: 1.4 }}>
                <Text style={styles.productName} numberOfLines={1}>{item.product_name}</Text>
                <Text style={styles.meta}>{item.weight_value}{item.weight_unit} • {item.sku} • {item.store_name}</Text>
                <View style={styles.healthTrack}>
                  <View style={[styles.healthFill, { width: `${healthPct}%`, backgroundColor: healthColor }]} />
                </View>
              </View>
              <View style={{ flex: 0.9, alignItems: 'flex-end' }}>
                <Text style={styles.qty}>{item.available_quantity} available</Text>
                <Text style={styles.meta}>{item.quantity} total • {item.reserved_quantity} reserved</Text>
              </View>
              <StatusBadge status={item.stock_status} size="sm" />
            </Pressable>
          );
        }}
      />

      {target && <AdjustModal row={target} onClose={() => setTarget(null)} onDone={() => { setTarget(null); load(); }} showToast={showToast} />}
    </AdminShell>
  );
}

function AdjustModal({ row, onClose, onDone, showToast }: { row: AdminInventoryRow; onClose: () => void; onDone: () => void; showToast: (m: string, v: 'success' | 'error' | 'info') => void }) {
  const [change, setChange] = useState('');
  const [movementType, setMovementType] = useState<(typeof MOVEMENT_TYPES)[number]>('restock');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const delta = parseInt(change, 10);
    if (Number.isNaN(delta)) {
      showToast('Please enter a valid whole number.', 'error');
      return;
    }
    if (delta === 0) {
      showToast('Enter a non-zero quantity change.', 'error');
      return;
    }
    setSaving(true);
    try {
      await adminRepository.adjustInventory(row.store_id, row.variant_id, delta, movementType, reason || undefined);
      showToast('Inventory updated.', 'success');
      onDone();
    } catch {
      showToast('Unable to update inventory. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.modalOverlay} keyboardShouldPersistTaps="handled">
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <AppImage uri={row.product_image} style={styles.modalThumb} fallbackIcon={Package} />
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{row.product_name}</Text>
                <Text style={styles.modalSubtitle}>{row.store_name} • current stock {row.quantity}</Text>
              </View>
            </View>

            <Text style={styles.fieldLabel}>Movement type</Text>
            <View style={styles.movementRow}>
              {MOVEMENT_TYPES.map((t) => (
                <Pressable key={t} style={[styles.movementChip, movementType === t && styles.movementChipActive]} onPress={() => setMovementType(t)}>
                  <Text style={[styles.movementChipText, movementType === t && styles.movementChipTextActive]}>{t}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Quantity change (use a negative number to reduce)</Text>
            <TextInput style={styles.modalInput} keyboardType="numeric" value={change} onChangeText={setChange} placeholder="e.g. 50 or -5" placeholderTextColor={colors.textMuted} />

            <Text style={styles.fieldLabel}>Reason (optional)</Text>
            <TextInput style={styles.modalInput} value={reason} onChangeText={setReason} placeholder="e.g. Weekly restock from supplier" placeholderTextColor={colors.textMuted} />

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onClose}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSaveBtn} onPress={submit} disabled={saving || !change}>
                <Text style={styles.modalSaveText}>{saving ? 'Saving…' : 'Save Adjustment'}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg, paddingBottom: 0, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  toolbar: { padding: spacing.lg, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44, maxWidth: 480 },
  searchInput: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary, outlineStyle: 'none' as never },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: spacing.lg },
  storeRowIcon: { marginRight: 2 },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  filterChipActive: { backgroundColor: colors.primary },
  filterChipText: { ...textStyles.caption, color: colors.textSecondary },
  filterChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  lowStockChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  lowStockChipActive: { backgroundColor: colors.warning },
  listContent: { padding: spacing.lg, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  thumb: { width: 52, height: 52, borderRadius: radius.sm },
  productName: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  meta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2, ...tabularNums },
  qty: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold', ...tabularNums },
  healthTrack: { height: 3, borderRadius: 2, backgroundColor: colors.divider, marginTop: spacing.sm, overflow: 'hidden' },
  healthFill: { height: '100%', borderRadius: 2 },
  modalOverlay: { flexGrow: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 440, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...shadows.lg },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  modalThumb: { width: 48, height: 48, borderRadius: radius.sm },
  modalTitle: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary },
  modalSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  fieldLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: spacing.sm, marginBottom: 4 },
  movementRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  movementChip: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  movementChipActive: { backgroundColor: colors.primary },
  movementChipText: { ...textStyles.caption, color: colors.textSecondary, fontSize: 11, textTransform: 'capitalize' },
  movementChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  modalInput: { backgroundColor: colors.surfaceSunken, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 42, ...textStyles.bodySmall, color: colors.textPrimary },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { ...textStyles.button, color: colors.textPrimary, fontSize: 14 },
  modalSaveBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  modalSaveText: { ...textStyles.button, color: colors.white, fontSize: 14 },
});
