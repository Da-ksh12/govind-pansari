import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MapPin, Phone, Store } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AdminShell } from '../../components/admin/AdminShell';
import { StatusBadge } from '../../components/admin/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { useAdminStore } from '../../store/adminStore';
import { useUIStore } from '../../store/uiStore';
import { adminRepository } from '../../services/repositories/adminRepository';
import { pushAdmin } from '../../services/adminNav';

export default function AdminStoresScreen() {
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);
  const canManage = hasPermission('stores.manage');

  const load = useCallback(() => {
    setLoading(true);
    adminRepository.getStores().then(setStores).catch(() => setStores([])).finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  const toggleAccepting = async (store: any) => {
    const next = !store.is_accepting_orders;
    setStores((prev) => prev.map((s) => (s.id === store.id ? { ...s, is_accepting_orders: next } : s)));
    try {
      await adminRepository.updateStore(store.id, { is_accepting_orders: next });
    } catch {
      setStores((prev) => prev.map((s) => (s.id === store.id ? { ...s, is_accepting_orders: !next } : s)));
      showToast("Couldn't update the store.", 'error');
    }
  };

  return (
    <AdminShell title="Stores" subtitle="Manage your physical store locations">
      <FlatList
        data={stores}
        keyExtractor={(s) => s.id}
        contentContainerStyle={styles.listContent}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={!loading ? <EmptyState icon={Store} title="No stores" /> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => pushAdmin(`/admin/stores/${item.id}`)}>
            <View style={styles.headerRow}>
              <View style={styles.storeIconChip}>
                <Store size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              </View>
              <Text style={styles.storeName}>{item.name}</Text>
              <StatusBadge status={item.is_active ? 'active' : 'inactive'} size="sm" />
            </View>
            <View style={styles.metaRow}>
              <MapPin size={ICON_SIZE.xs} color={colors.textMuted} strokeWidth={ICON_STROKE} />
              <Text style={styles.metaText}>{item.address_line}, {item.city}</Text>
            </View>
            {item.phone && (
              <View style={styles.metaRow}>
                <Phone size={ICON_SIZE.xs} color={colors.textMuted} strokeWidth={ICON_STROKE} />
                <Text style={styles.metaText}>{item.phone}</Text>
              </View>
            )}
            <Text style={styles.metaText}>{item.opening_time} – {item.closing_time}</Text>
            <View style={styles.footerRow}>
              <Text style={styles.metaText}>Accepting new orders</Text>
              {canManage ? (
                <Switch value={item.is_accepting_orders} onValueChange={() => toggleAccepting(item)} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
              ) : (
                <Text style={styles.metaText}>{item.is_accepting_orders ? 'Yes' : 'Paused'}</Text>
              )}
            </View>
          </Pressable>
        )}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  listContent: { padding: spacing.lg, gap: spacing.md, flexDirection: 'row', flexWrap: 'wrap', maxWidth: 1200, width: '100%', alignSelf: 'center' },
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: 6, flexGrow: 1, flexBasis: 360, maxWidth: 420,
    borderWidth: 1, borderColor: colors.border, ...shadows.sm,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  storeIconChip: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  storeName: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary, flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { ...textStyles.caption, color: colors.textSecondary },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
});
