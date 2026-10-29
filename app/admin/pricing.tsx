import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Clock, MapPin, Pencil, Store as StoreIcon, Truck } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { EditField, EditSheet } from '../../components/admin/EditSheet';
import { StatusBadge } from '../../components/admin/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatINR } from '../../components/ui/PriceBlock';
import { useAdminStore } from '../../store/adminStore';
import { useUIStore } from '../../store/uiStore';
import { adminRepository, type AdminZoneRow } from '../../services/repositories/adminRepository';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';
import { validateZoneForm, type ZoneErrors } from '../../services/zoneEdit';

export default function AdminPricingScreen() {
  const [zones, setZones] = useState<AdminZoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminZoneRow | null>(null);
  const canManage = useAdminStore((s) => s.hasPermission('zones.manage'));
  const showToast = useUIStore((s) => s.showToast);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    adminRepository
      .getZones()
      .then(setZones)
      .catch((e) => {
        setZones([]);
        setLoadError(e instanceof Error ? e.message : "Couldn't load the delivery areas.");
      })
      .finally(() => setLoading(false));
  }, []);
  useFocusEffect(load);
  useRefetchOnForeground(load);

  const setActive = (zone: AdminZoneRow, next: boolean) => {
    const apply = async () => {
      setZones((prev) => prev.map((z) => (z.id === zone.id ? { ...z, isActive: next } : z)));
      try {
        await adminRepository.updateZone(zone.id, { isActive: next });
        showToast(next ? 'Delivery area switched on' : 'Delivery area switched off', 'success');
      } catch (e) {
        setZones((prev) => prev.map((z) => (z.id === zone.id ? { ...z, isActive: !next } : z)));
        showToast(e instanceof Error ? e.message : "Couldn't update the delivery area.", 'error');
      }
    };
    if (next) {
      apply();
      return;
    }
    Alert.alert(
      `Switch off "${zone.name}"?`,
      'Customers in this area will not be able to place orders until it is switched on again.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Switch off', style: 'destructive', onPress: apply }],
    );
  };

  return (
    <AdminShell title="Delivery & Pricing" subtitle="What customers pay for delivery in each area">
      <FlatList
        style={{ flex: 1 }}
        data={zones}
        keyExtractor={(z) => z.id}
        contentContainerStyle={styles.listContent}
        refreshing={loading}
        onRefresh={load}
        ListHeaderComponent={
          <Text style={styles.intro}>
            These are the numbers checkout charges. The cart shows the same ones. The delivery distance (how far from a store we deliver) is under Settings.
          </Text>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
          ) : (
            <EmptyState icon={Truck} title={loadError ? "Couldn't load delivery areas" : 'No delivery areas'} subtitle={loadError ?? 'Delivery areas are set up by the developer.'} ctaLabel={loadError ? 'Try Again' : undefined} onPressCta={loadError ? load : undefined} />
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.card, !item.isActive && styles.cardOff]}>
            <View style={styles.cardHeader}>
              <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.name} numberOfLines={2}>{item.name}</Text>
              <StatusBadge status={item.isActive ? 'active' : 'inactive'} size="sm" />
            </View>

            <View style={styles.numbers}>
              <Figure label="Delivery fee" value={item.deliveryFee === 0 ? 'Free' : formatINR(item.deliveryFee)} />
              <Figure label="Minimum order" value={formatINR(item.minimumOrderValue)} />
              <Figure label="Free delivery from" value={item.freeDeliveryThreshold === null ? 'Never' : formatINR(item.freeDeliveryThreshold)} />
              <Figure label="Delivery time" value={`${item.estimatedMinutes} min`} />
            </View>

            <View style={styles.storesRow}>
              <StoreIcon size={12} color={colors.textMuted} strokeWidth={ICON_STROKE} />
              <Text style={styles.stores} numberOfLines={2}>
                {item.stores.length === 0 ? 'No store serves this area' : item.stores.map((s) => `${s.name.replace('Govind Pansari — ', '')}${s.isActive ? '' : ' (inactive)'}`).join(' · ')}
              </Text>
            </View>

            {canManage && (
              <View style={styles.actions}>
                <Pressable style={styles.editBtn} onPress={() => setEditing(item)} accessibilityRole="button" accessibilityLabel={`Edit ${item.name}`}>
                  <Pencil size={ICON_SIZE.xs} color={colors.primary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.editBtnText}>Edit prices</Text>
                </Pressable>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Serving</Text>
                  <Switch value={item.isActive} onValueChange={(v) => setActive(item, v)} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
                </View>
              </View>
            )}
          </View>
        )}
      />

      {editing && (
        <ZoneEditor
          zone={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </AdminShell>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.numberCell}>
      <Text style={styles.numberValue}>{value}</Text>
      <Text style={styles.numberLabel}>{label}</Text>
    </View>
  );
}

function ZoneEditor({ zone, onClose, onSaved }: { zone: AdminZoneRow; onClose: () => void; onSaved: () => void }) {
  const showToast = useUIStore((s) => s.showToast);
  const [name, setName] = useState(zone.name);
  const [deliveryFee, setDeliveryFee] = useState(String(zone.deliveryFee));
  const [minimumOrderValue, setMinimumOrderValue] = useState(String(zone.minimumOrderValue));
  const [freeDeliveryThreshold, setFreeDeliveryThreshold] = useState(zone.freeDeliveryThreshold === null ? '' : String(zone.freeDeliveryThreshold));
  const [estimatedMinutes, setEstimatedMinutes] = useState(String(zone.estimatedMinutes));
  const [errors, setErrors] = useState<ZoneErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const { errors: found, patch } = validateZoneForm(
      { name, deliveryFee, minimumOrderValue, freeDeliveryThreshold, estimatedMinutes },
      { name: zone.name, deliveryFee: zone.deliveryFee, minimumOrderValue: zone.minimumOrderValue, freeDeliveryThreshold: zone.freeDeliveryThreshold, estimatedMinutes: zone.estimatedMinutes },
    );
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;
    if (Object.keys(patch).length === 0) {
      showToast('Nothing was changed.', 'info');
      onClose();
      return;
    }
    setSaving(true);
    try {
      await adminRepository.updateZone(zone.id, patch);
      showToast('Prices updated. New orders use them straight away.', 'success');
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditSheet title="Edit delivery prices" onClose={onClose} onSave={save} saving={saving} error={formError}>
      <EditField label="Area name" value={name} onChangeText={setName} error={errors.name} maxLength={80} />
      <EditField label="Delivery fee (₹)" value={deliveryFee} onChangeText={setDeliveryFee} error={errors.deliveryFee} keyboardType="decimal-pad" hint="0 means delivery is always free here." />
      <EditField label="Minimum order (₹)" value={minimumOrderValue} onChangeText={setMinimumOrderValue} error={errors.minimumOrderValue} keyboardType="decimal-pad" hint="Customers cannot check out below this." />
      <EditField label="Free delivery from (₹)" value={freeDeliveryThreshold} onChangeText={setFreeDeliveryThreshold} error={errors.freeDeliveryThreshold} keyboardType="decimal-pad" hint="Leave empty for no free delivery. Must be at least the minimum order." />
      <EditField label="Delivery time (minutes)" value={estimatedMinutes} onChangeText={setEstimatedMinutes} error={errors.estimatedMinutes} keyboardType="number-pad" maxLength={3} hint="Shown to customers as the estimate." />
      <View style={styles.noteRow}>
        <Clock size={12} color={colors.textMuted} strokeWidth={ICON_STROKE} />
        <Text style={styles.note}>A change applies to new checkouts immediately. Orders already placed keep the price they were placed at.</Text>
      </View>
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: spacing.lg, gap: spacing.md, maxWidth: 900, width: '100%', alignSelf: 'center' },
  intro: { ...textStyles.caption, color: colors.textSecondary, lineHeight: 17, marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: spacing.md, ...shadows.xs },
  cardOff: { opacity: 0.7 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, flex: 1 },
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  numberCell: { minWidth: '45%', flexGrow: 1, backgroundColor: colors.surfaceSunken, borderRadius: radius.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  numberValue: { ...textStyles.cardTitle, fontSize: 15, color: colors.textPrimary },
  numberLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  storesRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  stores: { ...textStyles.caption, color: colors.textMuted, flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, minHeight: 40, borderRadius: radius.pill, backgroundColor: colors.primaryTint },
  editBtnText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  switchLabel: { ...textStyles.caption, color: colors.textSecondary },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: spacing.sm },
  note: { ...textStyles.caption, color: colors.textMuted, flex: 1, lineHeight: 17 },
});
