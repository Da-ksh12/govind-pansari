import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { StatCard } from '../../components/admin/StatCard';
import { StatusBadge } from '../../components/admin/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { Avatar } from '../../components/ui/Avatar';
import { Bike, ChevronRight, Radio, MapPinOff, Truck } from 'lucide-react-native';
import { useAdminStore } from '../../store/adminStore';
import { useUIStore } from '../../store/uiStore';
import { adminRepository } from '../../services/repositories/adminRepository';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';
import { pushAdmin } from '../../services/adminNav';

export default function AdminRidersScreen() {
  const [riders, setRiders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);
  const canManage = hasPermission('riders.manage');

  const load = useCallback(() => {
    setLoading(true);
    adminRepository.getRiders().then(setRiders).catch(() => setRiders([])).finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);
  useEffect(() => adminRepository.subscribeToAdminRiders(load), [load]);
  useRefetchOnForeground(load);

  const toggleActive = async (rider: any) => {
    const next = !rider.is_active;
    setRiders((prev) => prev.map((r) => (r.id === rider.id ? { ...r, is_active: next } : r)));
    try {
      await adminRepository.setRiderActive(rider.id, next);
      showToast(next ? 'Rider activated' : 'Rider deactivated', 'success');
    } catch {
      setRiders((prev) => prev.map((r) => (r.id === rider.id ? { ...r, is_active: !next } : r)));
      showToast("Couldn't update the rider.", 'error');
    }
  };

  const online = riders.filter((r) => r.is_available && r.is_active).length;
  const offline = riders.filter((r) => !r.is_available && r.is_active).length;
  const inactive = riders.filter((r) => !r.is_active).length;

  return (
    <AdminShell title="Riders" subtitle="Monitor your delivery fleet in real time">
      <View style={styles.statsRow}>
        <StatCard label="Total Riders" value={riders.length} icon={Bike} />
        <StatCard label="Online" value={online} icon={Radio} tone="success" />
        <StatCard label="Offline" value={offline} icon={MapPinOff} />
        <StatCard label="Inactive" value={inactive} icon={Truck} />
      </View>
      <FlatList
        style={{ flex: 1 }}
        data={riders}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.listContent}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={!loading ? <EmptyState icon={Bike} title="No riders" subtitle="Invite a rider from Staff & Roles to get started." /> : null}
        renderItem={({ item }) => (
          <Pressable style={[styles.row, !item.is_active && styles.rowInactive]} onPress={() => pushAdmin(`/admin/riders/${item.id}`)}>
            <Avatar uri={item.profiles?.avatar_url} name={item.profiles?.full_name ?? '?'} size="md" status={!item.is_active ? undefined : item.is_available ? 'online' : 'offline'} />
            <View style={{ flex: 1.2 }}>
              <Text style={styles.name}>{item.profiles?.full_name}</Text>
              <Text style={styles.meta}>{item.profiles?.phone} • {item.vehicle_type}</Text>
            </View>
            <Text style={[styles.meta, { flex: 0.8 }]}>{item.stores?.name ?? '—'}</Text>
            {item.is_active ? (
              <StatusBadge status={item.is_available ? 'online' : 'offline'} size="sm" />
            ) : (
              <StatusBadge status="inactive" size="sm" />
            )}
            {canManage && (
              <Switch value={item.is_active} onValueChange={() => toggleActive(item)} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
            )}
            <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          </Pressable>
        )}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  listContent: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  rowInactive: { opacity: 0.6 },
  name: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  meta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
});
