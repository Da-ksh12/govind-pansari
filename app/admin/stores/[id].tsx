import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, ArrowLeft, Clock, MapPin, Package, PackageX, Pencil, Phone, Store as StoreIcon, Truck, Users } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { AdminShell } from '../../../components/admin/AdminShell';
import { StatCard } from '../../../components/admin/StatCard';
import { StatusBadge } from '../../../components/admin/StatusBadge';
import { Avatar } from '../../../components/ui/Avatar';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatINR } from '../../../components/ui/PriceBlock';
import { pushAdmin } from '../../../services/adminNav';
import { useAdminStore } from '../../../store/adminStore';
import { useUIStore } from '../../../store/uiStore';
import { adminRepository, type AdminStorePerformance } from '../../../services/repositories/adminRepository';
import { EditField, EditSheet } from '../../../components/admin/EditSheet';
import { clockLabel, parseClockTime as parseClock, validateStoreForm, type StoreFormErrors } from '../../../services/storeEdit';

function minutesLabel(v: number | null): string {
  if (v == null) return '—';
  return v < 60 ? `${v} min` : `${Math.floor(v / 60)}h ${Math.round(v % 60)}m`;
}

export default function AdminStoreProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [store, setStore] = useState<any | null>(null);
  const [performance, setPerformance] = useState<AdminStorePerformance | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [staff, setStaff] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);
  const canManage = hasPermission('stores.manage');

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([adminRepository.getStore(id), adminRepository.getStorePerformance().catch(() => []), adminRepository.getStoreStaff(id).catch(() => [])])
      .then(([s, perf, st]) => {
        setStore(s);
        setPerformance(perf.find((p) => p.store_id === id) ?? null);
        setStaff(st);
      })
      .catch(() => setStore(null))
      .finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(load);

  const toggleAccepting = async () => {
    if (!store) return;
    const next = !store.is_accepting_orders;
    setStore((prev: any) => ({ ...prev, is_accepting_orders: next }));
    try {
      await adminRepository.updateStore(store.id, { is_accepting_orders: next });
    } catch {
      setStore((prev: any) => ({ ...prev, is_accepting_orders: !next }));
      showToast("Couldn't update the store.", 'error');
    }
  };

  if (loading && !store) {
    return (
      <AdminShell title="Store">
        <View style={styles.centerFill}><ActivityIndicator color={colors.primary} /></View>
      </AdminShell>
    );
  }
  if (!store) {
    return (
      <AdminShell title="Store">
        <EmptyState title="Couldn't load this store" subtitle="It may have been removed, or something went wrong." ctaLabel="Retry" onPressCta={load} />
      </AdminShell>
    );
  }

  return (
    <AdminShell title={store.name}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.backRow} onPress={() => router.back()}>
          <ArrowLeft size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back to Stores</Text>
        </Pressable>

        <View style={styles.headerCard}>
          <View style={styles.storeIconChip}>
            <StoreIcon size={ICON_SIZE.lg} color={colors.primary} strokeWidth={ICON_STROKE} />
          </View>
          <Text style={styles.storeName}>{store.name}</Text>
          <View style={{ marginTop: spacing.xs }}>
            <StatusBadge status={store.is_active ? 'active' : 'inactive'} />
          </View>
          <View style={styles.infoRow}>
            <MapPin size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
            <Text style={styles.mutedText}>{store.address_line}, {store.city}</Text>
          </View>
          {store.phone && (
            <View style={styles.infoRow}>
              <Phone size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
              <Text style={styles.mutedText}>{store.phone}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Clock size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
            <Text style={styles.mutedText}>{clockLabel(store.opening_time)} – {clockLabel(store.closing_time)}</Text>
          </View>
          {store.status_reason && <Text style={styles.statusReason}>{store.status_reason}</Text>}
          {canManage && (
            <Pressable style={styles.editBtn} onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel="Edit store details">
              <Pencil size={ICON_SIZE.xs} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.editBtnText}>Edit details</Text>
            </Pressable>
          )}
          {canManage && (
            <View style={styles.acceptingRow}>
              <Text style={styles.plainText}>Accepting new orders</Text>
              <Switch value={store.is_accepting_orders} onValueChange={toggleAccepting} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
            </View>
          )}
        </View>

        <Text style={styles.sectionLabel}>Today</Text>
        <View style={styles.grid}>
          <StatCard label="Orders" value={performance?.today_orders ?? 0} icon={Package} onPress={() => pushAdmin('/admin/orders')} />
          <StatCard label="Revenue" value={formatINR(performance?.today_revenue ?? 0)} icon={StoreIcon} />
          <StatCard label="Active Orders" value={performance?.active_orders ?? 0} icon={Package} />
          <StatCard label="Active Deliveries" value={performance?.active_deliveries ?? 0} icon={Truck} onPress={() => pushAdmin('/admin/deliveries')} />
          <StatCard label="Avg. Fulfilment" value={minutesLabel(performance?.avg_fulfillment_minutes ?? null)} icon={Clock} />
          <StatCard label="Avg. Delivery" value={minutesLabel(performance?.avg_delivery_minutes ?? null)} icon={Truck} />
        </View>

        <Text style={styles.sectionLabel}>Inventory Health</Text>
        <View style={styles.grid}>
          <StatCard label="Low Stock" value={performance?.low_stock ?? 0} icon={AlertTriangle} tone={(performance?.low_stock ?? 0) > 0 ? 'warning' : 'default'} onPress={() => pushAdmin('/admin/inventory?lowStock=1')} />
          <StatCard label="Out of Stock" value={performance?.out_of_stock ?? 0} icon={PackageX} tone={(performance?.out_of_stock ?? 0) > 0 ? 'error' : 'default'} onPress={() => pushAdmin('/admin/inventory?lowStock=1')} />
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>Staff Assigned</Text>
          <Users size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
        </View>
        {staff.length === 0 ? (
          <Text style={styles.mutedText}>No staff assigned to this store yet.</Text>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {staff.map((s: any) => (
              <View key={s.id} style={styles.staffRow}>
                <Avatar uri={s.profiles?.avatar_url} name={s.profiles?.full_name ?? '?'} size="sm" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.plainText}>{s.profiles?.full_name}</Text>
                  <Text style={styles.mutedText}>{s.profiles?.phone}</Text>
                </View>
                <Text style={styles.roleText}>{s.role.replace(/_/g, ' ')}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {editing && (
        <StoreEditor
          store={store}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}
    </AdminShell>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StoreEditor({ store, onClose, onSaved }: { store: any; onClose: () => void; onSaved: () => void }) {
  const showToast = useUIStore((s) => s.showToast);
  const [name, setName] = useState<string>(store.name ?? '');
  const [phone, setPhone] = useState<string>(store.phone ?? '');
  const [addressLine, setAddressLine] = useState<string>(store.address_line ?? '');
  const [city, setCity] = useState<string>(store.city ?? '');
  const [opening, setOpening] = useState<string>((store.opening_time ?? '').slice(0, 5));
  const [closing, setClosing] = useState<string>((store.closing_time ?? '').slice(0, 5));
  const [errors, setErrors] = useState<StoreFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const { errors: found, patch } = validateStoreForm({ name, phone, addressLine, city, opening, closing }, store);
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
      await adminRepository.updateStore(store.id, patch);
      showToast('Store updated.', 'success');
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save the store. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Show how the typed times are understood ("= 9:00 PM"), so "21:00" and "9 pm" are never a guess.
  const timeHint = (text: string) => {
    const label = clockLabel(parseClock(text));
    return label ? `= ${label}` : undefined;
  };

  return (
    <EditSheet title="Edit store details" onClose={onClose} onSave={save} saving={saving} error={formError}>
      <EditField label="Store name" value={name} onChangeText={setName} error={errors.name} maxLength={80} />
      <EditField label="Phone" value={phone} onChangeText={setPhone} error={errors.phone} keyboardType="phone-pad" hint="Shown to customers and riders." />
      <EditField label="Address" value={addressLine} onChangeText={setAddressLine} error={errors.addressLine} maxLength={120} />
      <EditField label="City" value={city} onChangeText={setCity} error={errors.city} maxLength={40} />
      <EditField label="Opens at" value={opening} onChangeText={setOpening} error={errors.opening} hint={timeHint(opening)} autoCapitalize="none" autoCorrect={false} placeholder="09:00" />
      <EditField
        label="Closes at"
        value={closing}
        onChangeText={setClosing}
        error={errors.closing}
        hint={timeHint(closing) ? `${timeHint(closing)} · Customers can order only between these times (India time).` : undefined}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="21:00"
      />
    </EditSheet>
  );
}

const styles = StyleSheet.create({
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, paddingHorizontal: spacing.md, minHeight: 40, borderRadius: radius.pill, backgroundColor: colors.primaryTint },
  editBtnText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, maxWidth: 900, width: '100%', alignSelf: 'center', gap: spacing.sm },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  backText: { ...textStyles.caption, color: colors.textSecondary },
  headerCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, ...shadows.xs, marginBottom: spacing.sm },
  storeIconChip: { width: 64, height: 64, borderRadius: radius.lg, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  storeName: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary, marginTop: spacing.md },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  plainText: { ...textStyles.bodySmall, color: colors.textPrimary },
  mutedText: { ...textStyles.caption, color: colors.textSecondary },
  statusReason: { ...textStyles.caption, color: colors.warning, marginTop: spacing.xs, textAlign: 'center' },
  acceptingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  sectionLabel: { ...textStyles.cardTitle, fontSize: 13, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.sm },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  staffRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  roleText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold', textTransform: 'capitalize' },
});
