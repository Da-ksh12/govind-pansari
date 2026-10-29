import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Camera, CheckCircle2, Mail, MapPin, Pencil, Phone, Star, Trash2, Truck, XCircle } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { AdminShell } from '../../../components/admin/AdminShell';
import { StatusBadge } from '../../../components/admin/StatusBadge';
import { StatCard } from '../../../components/admin/StatCard';
import { Avatar } from '../../../components/ui/Avatar';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatINR } from '../../../components/ui/PriceBlock';
import { pushAdmin } from '../../../services/adminNav';
import { useAdminStore } from '../../../store/adminStore';
import { useUIStore } from '../../../store/uiStore';
import { adminRepository } from '../../../services/repositories/adminRepository';
import { pickRiderAvatar, uploadRiderAvatar, deleteRiderAvatar, AvatarUploadError } from '../../../services/storage/riderAvatar';
import { ChoiceChips, EditField, EditSheet } from '../../../components/admin/EditSheet';
import { VEHICLE_TYPES, validateRiderForm, type RiderFormErrors } from '../../../services/riderEdit';

export default function AdminRiderProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rider, setRider] = useState<any | null>(null);
  const [stats, setStats] = useState<{ deliveredToday: number; deliveredLifetime: number; failedLifetime: number; successRate: number | null } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [currentDelivery, setCurrentDelivery] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editing, setEditing] = useState(false);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);
  const canManage = hasPermission('riders.manage');

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      adminRepository.getRider(id),
      adminRepository.getRiderStats(id),
      adminRepository.getRiderHistory(id),
      adminRepository.getActiveDeliveries().catch(() => []),
    ])
      .then(([r, s, h, active]) => {
        setRider(r);
        setStats(s);
        setHistory(h);
        setCurrentDelivery((active as any[]).find((a) => a.riders?.id === id) ?? null);
      })
      .catch(() => setRider(null))
      .finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(load);

  const toggleActive = async () => {
    if (!rider) return;
    const next = !rider.is_active;
    setRider((prev: any) => ({ ...prev, is_active: next }));
    try {
      await adminRepository.setRiderActive(rider.id, next);
      showToast(next ? 'Rider activated' : 'Rider deactivated', 'success');
      load();
    } catch (e) {
      setRider((prev: any) => ({ ...prev, is_active: !next }));
      // The server's own reason, e.g. "this rider has a delivery in progress — finish or cancel it first".
      showToast(e instanceof Error ? e.message : "Couldn't update the rider.", 'error');
    }
  };

  const handleChangePhoto = async () => {
    if (!rider) return;
    setUploadingPhoto(true);
    try {
      const asset = await pickRiderAvatar();
      if (!asset) return;
      const url = await uploadRiderAvatar(rider.id, asset);
      const previousUrl = rider.profiles?.avatar_url as string | undefined;
      await adminRepository.setRiderAvatar(rider.id, url);
      if (previousUrl) deleteRiderAvatar(previousUrl).catch(() => {});
      setRider((prev: any) => ({ ...prev, profiles: { ...prev.profiles, avatar_url: url } }));
      showToast('Photo updated.', 'success');
    } catch (e) {
      showToast(e instanceof AvatarUploadError ? e.message : 'Upload failed. Please try again.', 'error');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = () => {
    if (!rider) return;
    Alert.alert('Remove photo?', 'The rider will show initials instead.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const previousUrl = rider.profiles?.avatar_url as string | undefined;
          try {
            await adminRepository.setRiderAvatar(rider.id, null);
            if (previousUrl) deleteRiderAvatar(previousUrl).catch(() => {});
            setRider((prev: any) => ({ ...prev, profiles: { ...prev.profiles, avatar_url: null } }));
          } catch {
            showToast("Couldn't remove the photo.", 'error');
          }
        },
      },
    ]);
  };

  if (loading && !rider) {
    return (
      <AdminShell title="Rider">
        <View style={styles.centerFill}><ActivityIndicator color={colors.primary} /></View>
      </AdminShell>
    );
  }
  if (!rider) {
    return (
      <AdminShell title="Rider">
        <EmptyState title="Couldn't load this rider" subtitle="They may have been removed, or something went wrong." ctaLabel="Retry" onPressCta={load} />
      </AdminShell>
    );
  }

  const name = rider.profiles?.full_name ?? 'Rider';
  const shortId = `RID-${(rider.id as string).slice(0, 6).toUpperCase()}`;

  return (
    <AdminShell title={name}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.backRow} onPress={() => router.back()}>
          <ArrowLeft size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back to Riders</Text>
        </Pressable>

        {/* Header */}
        <View style={styles.headerCard}>
          <View style={{ position: 'relative' }}>
            <Avatar uri={rider.profiles?.avatar_url} name={name} size="xl" status={!rider.is_active ? undefined : rider.is_available ? 'online' : 'offline'} />
            {canManage && (
              <Pressable style={styles.photoEditBtn} onPress={handleChangePhoto} disabled={uploadingPhoto} hitSlop={6}>
                {uploadingPhoto ? <ActivityIndicator size="small" color={colors.white} /> : <Camera size={14} color={colors.white} strokeWidth={ICON_STROKE} />}
              </Pressable>
            )}
          </View>
          <Text style={styles.riderName}>{name}</Text>
          <Text style={styles.riderIdText}>{shortId}</Text>
          <View style={{ marginTop: spacing.xs }}>
            {rider.is_active ? <StatusBadge status={rider.is_available ? 'online' : 'offline'} /> : <StatusBadge status="inactive" />}
          </View>
          {canManage && rider.profiles?.avatar_url && (
            <Pressable style={styles.removePhotoBtn} onPress={handleRemovePhoto}>
              <Trash2 size={12} color={colors.error} strokeWidth={ICON_STROKE} />
              <Text style={styles.removePhotoText}>Remove photo</Text>
            </Pressable>
          )}
        </View>

        {/* Currently delivering */}
        {currentDelivery && (
          <AnimatedCard onPress={() => pushAdmin(`/admin/orders/${currentDelivery.order_id}`)}>
            <View style={styles.cardHeaderRow}>
              <Truck size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.cardTitle}>Currently Delivering</Text>
            </View>
            <Text style={styles.plainText}>#{currentDelivery.orders?.order_number}</Text>
            <Text style={styles.mutedText}>{currentDelivery.stores?.name}</Text>
            <View style={{ marginTop: spacing.xs }}><StatusBadge status={currentDelivery.status} size="sm" /></View>
          </AnimatedCard>
        )}

        <View style={styles.grid}>
          {/* Personal & Work */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Personal</Text>
            <InfoRow icon={Phone} text={rider.profiles?.phone ?? '—'} />
            {rider.profiles?.email && <InfoRow icon={Mail} text={rider.profiles.email} />}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Work</Text>
            <InfoRow icon={MapPin} text={rider.stores?.name ?? 'No store assigned'} />
            <InfoRow icon={Truck} text={`${rider.vehicle_type}${rider.vehicle_number ? ` • ${rider.vehicle_number}` : ''}`} />
            {rider.profiles?.created_at && (
              <Text style={styles.mutedText}>Joined {new Date(rider.profiles.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
            )}
            {canManage && (
              <Pressable style={styles.editBtn} onPress={() => setEditing(true)} accessibilityRole="button" accessibilityLabel="Edit rider details">
                <Pencil size={ICON_SIZE.xs} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.editBtnText}>Edit details</Text>
              </Pressable>
            )}
            {canManage && (
              <View style={styles.activeToggleRow}>
                <Text style={styles.plainText}>Active</Text>
                <Switch value={rider.is_active} onValueChange={toggleActive} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
              </View>
            )}
          </View>
        </View>

        {/* Performance */}
        <Text style={styles.sectionLabel}>Performance</Text>
        <View style={styles.grid}>
          <StatCard label="Delivered Today" value={stats?.deliveredToday ?? 0} icon={CheckCircle2} tone="success" />
          <StatCard label="Delivered (Lifetime)" value={stats?.deliveredLifetime ?? 0} icon={Truck} />
          <StatCard label="Failed (Lifetime)" value={stats?.failedLifetime ?? 0} icon={XCircle} tone={stats && stats.failedLifetime > 0 ? 'warning' : 'default'} />
          <StatCard label="Success Rate" value={stats?.successRate != null ? `${stats.successRate}%` : '—'} icon={Star} />
        </View>

        {/* Delivery history */}
        <Text style={styles.sectionLabel}>Delivery History</Text>
        {history.length === 0 ? (
          <EmptyState icon={Truck} title="No deliveries yet" subtitle="Completed deliveries will show up here." />
        ) : (
          <FlatList
            data={history}
            keyExtractor={(h) => h.id}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
            renderItem={({ item }) => {
              const when = item.completed_at ?? item.failed_at ?? item.assigned_at;
              return (
                <Pressable style={styles.historyRow} onPress={() => pushAdmin(`/admin/orders/${item.order_id}`)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.plainText}>#{item.orders?.order_number}</Text>
                    <Text style={styles.mutedText}>{new Date(when).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                  </View>
                  <Text style={styles.plainText}>{formatINR(item.orders?.total ?? 0)}</Text>
                  {item.delivery_proof_photo_url && <Camera size={14} color={colors.success} strokeWidth={ICON_STROKE} />}
                  <StatusBadge status={item.status} size="sm" />
                </Pressable>
              );
            }}
          />
        )}
      </ScrollView>

      {editing && (
        <RiderEditor
          rider={rider}
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
function RiderEditor({ rider, onClose, onSaved }: { rider: any; onClose: () => void; onSaved: () => void }) {
  const showToast = useUIStore((s) => s.showToast);
  const current = {
    fullName: (rider.profiles?.full_name ?? '') as string,
    vehicleType: (rider.vehicle_type ?? '') as string,
    vehicleNumber: (rider.vehicle_number ?? '') as string,
    primaryStoreId: (rider.primary_store_id ?? null) as string | null,
    maxActive: (rider.max_active_deliveries ?? 1) as number,
  };
  const [fullName, setFullName] = useState(current.fullName);
  const [vehicleType, setVehicleType] = useState(current.vehicleType);
  const [vehicleNumber, setVehicleNumber] = useState(current.vehicleNumber);
  const [primaryStoreId, setPrimaryStoreId] = useState<string | null>(current.primaryStoreId);
  const [maxActive, setMaxActive] = useState(String(current.maxActive));
  const [stores, setStores] = useState<{ id: string; name: string }[]>([]);
  const [errors, setErrors] = useState<RiderFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminRepository.getStores().then((rows) => setStores(rows.filter((s: { is_active: boolean }) => s.is_active))).catch(() => {});
  }, []);

  const save = async () => {
    const { errors: found, patch } = validateRiderForm({ fullName, vehicleType, vehicleNumber, primaryStoreId, maxActive }, current);
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
      await adminRepository.updateRider(rider.id, patch);
      showToast('Rider updated.', 'success');
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Couldn't save the rider. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <EditSheet title="Edit rider details" onClose={onClose} onSave={save} saving={saving} error={formError}>
      <EditField label="Full name" value={fullName} onChangeText={setFullName} error={errors.fullName} maxLength={60} />
      <ChoiceChips label="Vehicle" options={VEHICLE_TYPES.map((v) => ({ value: v, label: v }))} value={VEHICLE_TYPES.find((v) => v === vehicleType.trim().toLowerCase()) ?? null} onChange={setVehicleType} />
      <EditField label="Vehicle type (or type your own)" value={vehicleType} onChangeText={setVehicleType} error={errors.vehicleType} autoCapitalize="none" maxLength={30} />
      <EditField label="Vehicle number" value={vehicleNumber} onChangeText={setVehicleNumber} error={errors.vehicleNumber} autoCapitalize="characters" maxLength={20} placeholder="UP80 AB 1234" />
      <ChoiceChips label="Home store" options={stores.map((s) => ({ value: s.id, label: s.name.replace('Govind Pansari — ', '') }))} value={primaryStoreId} onChange={setPrimaryStoreId} error={errors.primaryStoreId} />
      <EditField label="Deliveries at once" value={maxActive} onChangeText={setMaxActive} error={errors.maxActive} keyboardType="number-pad" maxLength={2} hint="How many orders this rider can carry together (1 to 10)." />
      <Text style={styles.editNote}>Their phone number is their sign-in and can't be changed here. A rider with a delivery in progress can't be moved to another store or switched off.</Text>
    </EditSheet>
  );
}

function AnimatedCard({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return <Pressable style={styles.card} onPress={onPress}>{children}</Pressable>;
}

function InfoRow({ icon: Icon, text }: { icon: typeof Phone; text: string }) {
  return (
    <View style={styles.infoRow}>
      <Icon size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
      <Text style={styles.plainText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, maxWidth: 900, width: '100%', alignSelf: 'center', gap: spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { ...textStyles.caption, color: colors.textSecondary },
  headerCard: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, ...shadows.xs },
  photoEditBtn: {
    position: 'absolute', right: -2, bottom: -2, width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface,
  },
  riderName: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary, marginTop: spacing.md },
  riderIdText: { ...textStyles.caption, color: colors.textMuted, marginTop: 2 },
  removePhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.md },
  removePhotoText: { ...textStyles.caption, color: colors.error },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { flexGrow: 1, flexBasis: 260, minWidth: 260, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  cardTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, marginBottom: spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  plainText: { ...textStyles.bodySmall, color: colors.textPrimary },
  mutedText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  activeToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  editBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: spacing.md, paddingHorizontal: spacing.md, minHeight: 40, borderRadius: radius.pill, backgroundColor: colors.primaryTint },
  editBtnText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  editNote: { ...textStyles.caption, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 17 },
  sectionLabel: { ...textStyles.cardTitle, fontSize: 13, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing.sm },
  historyRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
});
