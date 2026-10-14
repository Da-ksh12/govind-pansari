import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Ban, ChevronRight, CheckCircle2 } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { AdminShell } from '../../../components/admin/AdminShell';
import { StatusBadge } from '../../../components/admin/StatusBadge';
import { Avatar } from '../../../components/ui/Avatar';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatINR } from '../../../components/ui/PriceBlock';
import { useAdminStore } from '../../../store/adminStore';
import { useUIStore } from '../../../store/uiStore';
import { pushAdmin } from '../../../services/adminNav';
import { adminRepository } from '../../../services/repositories/adminRepository';

export default function AdminCustomerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<{ profile: any; orders: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    adminRepository.getCustomerDetail(id).then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(load);

  const toggleActive = () => {
    if (!data) return;
    const next = !data.profile.is_active;
    Alert.alert(next ? 'Activate this customer?' : 'Deactivate this customer?', next ? undefined : 'They will be unable to place new orders.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: next ? 'Activate' : 'Deactivate',
        style: next ? 'default' : 'destructive',
        onPress: async () => {
          try {
            await adminRepository.setCustomerActive(id, next);
            showToast(next ? 'Customer activated' : 'Customer deactivated', 'success');
            load();
          } catch {
            showToast("Couldn't update the customer.", 'error');
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <AdminShell title="Customer">
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AdminShell>
    );
  }
  if (!data?.profile) {
    return (
      <AdminShell title="Customer">
        <EmptyState title="Couldn't load this customer" subtitle="They may not exist, or something went wrong. Please try again." ctaLabel="Retry" onPressCta={load} />
      </AdminShell>
    );
  }

  const totalSpend = data.orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.total), 0);

  return (
    <AdminShell title={data.profile.full_name ?? 'Customer'} subtitle={data.profile.phone}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.backRow} onPress={() => router.back()}>
          <ArrowLeft size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back to Customers</Text>
        </Pressable>

        <View style={styles.card}>
          <View style={styles.nameRow}>
            <View style={styles.nameWithAvatar}>
              <Avatar uri={data.profile.avatar_url} name={data.profile.full_name ?? '?'} size="md" />
              <Text style={styles.name}>{data.profile.full_name ?? 'Unnamed'}</Text>
            </View>
            <StatusBadge status={data.profile.is_active ? 'active' : 'inactive'} />
          </View>
          <Text style={styles.meta}>{data.profile.phone}{data.profile.email ? ` • ${data.profile.email}` : ''}</Text>
          <Text style={styles.meta}>Joined {new Date(data.profile.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>

          <View style={styles.statsRow}>
            <Stat label="Orders" value={String(data.orders.length)} />
            <Stat label="Total Spend" value={formatINR(totalSpend)} />
          </View>

          {hasPermission('customers.manage') && (
            <Pressable style={[styles.actionBtn, data.profile.is_active ? styles.deactivateBtn : styles.activateBtn]} onPress={toggleActive}>
              {data.profile.is_active ? <Ban size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} /> : <CheckCircle2 size={ICON_SIZE.sm} color={colors.success} strokeWidth={ICON_STROKE} />}
              <Text style={[styles.actionText, { color: data.profile.is_active ? colors.error : colors.success }]}>
                {data.profile.is_active ? 'Deactivate Account' : 'Activate Account'}
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Order History</Text>
          {data.orders.length === 0 ? (
            <Text style={styles.meta}>No orders yet.</Text>
          ) : (
            data.orders.map((o) => (
              <Pressable key={o.id} style={({ pressed }) => [styles.orderRow, pressed && styles.orderRowPressed]} onPress={() => pushAdmin(`/admin/orders/${o.id}`)}>
                <Text style={styles.orderNumber}>#{o.order_number}</Text>
                <StatusBadge status={o.status} size="sm" />
                <Text style={styles.orderTotal}>{formatINR(o.total)}</Text>
                <ChevronRight size={ICON_SIZE.xs} color={colors.textMuted} strokeWidth={ICON_STROKE} />
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </AdminShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, maxWidth: 640, width: '100%', alignSelf: 'center' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  backText: { ...textStyles.caption, color: colors.textSecondary },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  cardTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, marginBottom: spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  nameWithAvatar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  name: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  meta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  statsRow: { flexDirection: 'row', marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  statValue: { ...textStyles.cardTitle, fontSize: 15, color: colors.textPrimary },
  statLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 44, borderRadius: radius.md, marginTop: spacing.md, borderWidth: 1.5 },
  deactivateBtn: { borderColor: colors.error },
  activateBtn: { borderColor: colors.success },
  actionText: { ...textStyles.button, fontSize: 13 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  orderRowPressed: { backgroundColor: colors.surfaceMuted },
  orderNumber: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary },
  orderTotal: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
});
