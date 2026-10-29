import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import BottomSheet from '@gorhom/bottom-sheet';
import { Search } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { EmptyState } from '../../components/ui/EmptyState';
import { AppBottomSheet } from '../../components/ui/AppBottomSheet';
import { useStoreOpsStore } from '../../store/storeOpsStore';
import { useStableCallback } from '../../hooks/useStableCallback';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';
import {
  storeOpsRepository,
  type InventoryAdjustmentReason,
  type StoreInventoryRow,
} from '../../services/repositories/storeOpsRepository';

const REASONS: { key: InventoryAdjustmentReason; label: string }[] = [
  { key: 'stock_count', label: 'Stock count' },
  { key: 'damaged', label: 'Damaged' },
  { key: 'expired', label: 'Expired' },
  { key: 'lost', label: 'Lost' },
  { key: 'found', label: 'Found' },
  { key: 'manual_correction', label: 'Manual correction' },
];

export default function StoreInventoryScreen() {
  const activeStoreId = useStoreOpsStore((s) => s.activeStoreId);
  const [rows, setRows] = useState<StoreInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<StoreInventoryRow | null>(null);
  const [newQty, setNewQty] = useState('');
  const [reason, setReason] = useState<InventoryAdjustmentReason>('stock_count');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const sheetRef = useRef<BottomSheet>(null);

  const load = useCallback(() => {
    if (!activeStoreId) return;
    setLoading(true);
    setError(false);
    storeOpsRepository
      .listInventory(activeStoreId, query)
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [activeStoreId, query]);

  useFocusEffect(load);

  // Live: stock at this store changes while the screen is open (a picker takes items, a restock lands, another manager
  // adjusts). Refreshes the rows in place — no spinner, and a failed refresh keeps what is on screen.
  const refreshQuietly = useStableCallback(() => {
    if (!activeStoreId) return;
    storeOpsRepository.listInventory(activeStoreId, query).then(setRows).catch(() => {});
  });
  useEffect(() => (activeStoreId ? storeOpsRepository.subscribeToStoreInventory(activeStoreId, refreshQuietly) : undefined), [activeStoreId, refreshQuietly]);
  useRefetchOnForeground(refreshQuietly);

  const openAdjust = (row: StoreInventoryRow) => {
    setSelected(row);
    setNewQty(String(row.onHand));
    setReason('stock_count');
    setSaveError(null);
    sheetRef.current?.expand();
  };

  const handleSave = async () => {
    if (!selected || !activeStoreId) return;
    const parsed = Number(newQty);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setSaveError('Enter a valid, non-negative quantity.');
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      await storeOpsRepository.recordAdjustment(activeStoreId, selected.variantId, Math.round(parsed), reason);
      sheetRef.current?.close();
      load();
    } catch (e) {
      // Errors here are typically the "below reserved quantity" guard — surfaced inline instead of a fresh alert dialog to keep the sheet open for correction.
      setSaveError(e instanceof Error ? e.message : 'Unable to record this adjustment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Inventory</Text>
      </View>

      <View style={styles.searchRow}>
        <Search size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search product or SKU"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={load}
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <EmptyState title="Couldn't load inventory" subtitle="Check your connection and try again." ctaLabel="Retry" onPressCta={load} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.inventoryId}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          renderItem={({ item }) => <InventoryRow row={item} onPress={() => openAdjust(item)} />}
          ListEmptyComponent={<EmptyState icon={Search} title="No matching products" />}
        />
      )}

      <AppBottomSheet ref={sheetRef} title={selected?.productName} snapPoints={['65%']}>
        {selected && (
          <View>
            <Text style={styles.sheetVariant}>{selected.variantLabel} • {selected.sku}</Text>
            <View style={styles.currentRow}>
              <CurrentStat label="On Hand" value={selected.onHand} />
              <CurrentStat label="Reserved" value={selected.reserved} />
              <CurrentStat label="Available" value={selected.available} />
            </View>

            <Text style={styles.fieldLabel}>New On-Hand Quantity</Text>
            <TextInput
              style={styles.qtyInput}
              value={newQty}
              onChangeText={(v) => { setNewQty(v); setSaveError(null); }}
              keyboardType="number-pad"
            />
            {saveError && <Text style={styles.saveErrorText}>{saveError}</Text>}

            <Text style={styles.fieldLabel}>Reason</Text>
            <View style={styles.reasonGrid}>
              {REASONS.map((r) => (
                <Pressable key={r.key} style={[styles.reasonChip, reason === r.key && styles.reasonChipActive]} onPress={() => setReason(r.key)}>
                  <Text style={[styles.reasonChipText, reason === r.key && styles.reasonChipTextActive]}>{r.label}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable style={styles.saveBtn} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveBtnText}>Record Adjustment</Text>}
            </Pressable>
          </View>
        )}
      </AppBottomSheet>
    </SafeScreen>
  );
}

function InventoryRow({ row, onPress }: { row: StoreInventoryRow; onPress: () => void }) {
  const status = row.available <= 0 ? 'out' : row.available <= row.reorderLevel ? 'low' : 'ok';
  const statusMeta = { out: { label: 'OUT OF STOCK', color: colors.error, bg: colors.errorTint }, low: { label: 'LOW STOCK', color: colors.warning, bg: colors.warningTint }, ok: { label: 'IN STOCK', color: colors.success, bg: colors.successTint } }[status];
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{row.productName}</Text>
        <Text style={styles.rowVariant}>{row.variantLabel} • {row.sku}</Text>
        <Text style={styles.rowNumbers}>
          On Hand: {row.onHand}  ·  Reserved: {row.reserved}  ·  Available: {row.available}
        </Text>
      </View>
      <View style={[styles.statusBadge, { backgroundColor: statusMeta.bg }]}>
        <Text style={[styles.statusBadgeText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
      </View>
    </Pressable>
  );
}

function CurrentStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.currentStat}>
      <Text style={styles.currentStatValue}>{value}</Text>
      <Text style={styles.currentStatLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.base, paddingTop: spacing.md },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: colors.textPrimary },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, marginHorizontal: spacing.base, marginTop: spacing.md, paddingHorizontal: spacing.md, height: 46, borderWidth: 1, borderColor: colors.border },
  searchInput: { flex: 1, ...textStyles.body, color: colors.textPrimary },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: spacing.base, paddingBottom: 140, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, ...shadows.sm },
  rowName: { ...textStyles.cardTitle, color: colors.textPrimary },
  rowVariant: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  rowNumbers: { ...textStyles.caption, color: colors.textMuted, marginTop: 4 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill },
  statusBadgeText: { fontSize: 9.5, fontFamily: 'PlusJakartaSans_700Bold' },
  sheetVariant: { ...textStyles.bodySmall, color: colors.textSecondary, marginBottom: spacing.md },
  saveErrorText: { ...textStyles.caption, color: colors.error, marginTop: spacing.xs },
  currentRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  currentStat: { flex: 1, backgroundColor: colors.surfaceSunken, borderRadius: radius.sm, padding: spacing.sm, alignItems: 'center' },
  currentStatValue: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  currentStatLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  fieldLabel: { ...textStyles.caption, color: colors.textSecondary, marginBottom: 6, fontFamily: 'PlusJakartaSans_600SemiBold' },
  qtyInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.base, height: 48, ...textStyles.body, color: colors.textPrimary, marginBottom: spacing.md },
  reasonGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  reasonChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  reasonChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  reasonChipText: { ...textStyles.caption, color: colors.textPrimary },
  reasonChipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  saveBtn: { backgroundColor: colors.primary, borderRadius: radius.md, height: 52, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { ...textStyles.button, color: colors.white, fontSize: 15 },
});
