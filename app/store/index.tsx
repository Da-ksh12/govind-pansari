import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AlertTriangle, Bell, Clock, PackageX } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../../components/layout/SafeBottomSpacer';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatINR } from '../../components/ui/PriceBlock';
import { useAuthStore } from '../../store/authStore';
import { useStoreOpsStore } from '../../store/storeOpsStore';
import { useNotificationsStore } from '../../store/notificationsStore';
import { storeOpsRepository, type StoreDashboard } from '../../services/repositories/storeOpsRepository';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';

const STATUS_META: Record<StoreDashboard['operationalStatus'], { label: string; color: string; bg: string }> = {
  open: { label: 'OPEN', color: colors.success, bg: colors.successTint },
  temporarily_unavailable: { label: 'PAUSED', color: colors.warning, bg: colors.warningTint },
  closed: { label: 'CLOSED', color: colors.error, bg: colors.errorTint },
};

// app/store/** predates the last typed-routes regeneration (needs a
// local `expo start`, which needs network access this sandbox
// doesn't have) — these are real, valid routes, just not yet in
// .expo/types/router.d.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const goToOrders = (status: string) => router.push(`/store/orders?status=${status}` as any);

export default function StoreDashboardScreen() {
  const profile = useAuthStore((s) => s.profile);
  const activeStoreId = useStoreOpsStore((s) => s.activeStoreId);
  const myStores = useStoreOpsStore((s) => s.myStores);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const [dashboard, setDashboard] = useState<StoreDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);

  const storeName = myStores.find((s) => s.storeId === activeStoreId)?.storeName ?? '';
  const isManager = myStores.find((s) => s.storeId === activeStoreId)?.staffRole === 'store_manager';

  const load = useCallback(() => {
    if (!activeStoreId) return;
    setLoading(true);
    setError(false);
    storeOpsRepository
      .getDashboard(activeStoreId)
      .then(setDashboard)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [activeStoreId]);

  useFocusEffect(load);

  // Section 51/58: counters update live, not just on screen focus — a
  // new order or a rider-status change refetches the dashboard
  // aggregate rather than the client trying to patch individual
  // numbers from the raw Realtime payload.
  useEffect(() => {
    if (!activeStoreId) return;
    return storeOpsRepository.subscribeToStoreActivity(activeStoreId, load);
  }, [activeStoreId, load]);
  // Priority 8 (pre-production hardening): re-sync on foreground —
  // the realtime socket suspends while backgrounded, so a status/order
  // change that happened during that window would otherwise sit
  // unseen until the next manual pull-to-refresh.
  useRefetchOnForeground(load);

  const [showPauseModal, setShowPauseModal] = useState(false);

  const handleToggleStatus = async (reason?: string) => {
    if (!activeStoreId || !dashboard || !isManager) return;
    setTogglingStatus(true);
    try {
      await storeOpsRepository.setAcceptingOrders(activeStoreId, !dashboard.isAcceptingOrders, reason);
      load();
    } finally {
      setTogglingStatus(false);
    }
  };
  const handlePausePress = () => {
    if (!dashboard) return;
    if (dashboard.isAcceptingOrders) setShowPauseModal(true);
    else handleToggleStatus();
  };

  if (!activeStoreId) {
    return (
      <SafeScreen>
        <View style={styles.centerFill}>
          <Text style={styles.emptyText}>No store assignment found for this account.</Text>
        </View>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && !!dashboard} onRefresh={load} tintColor={colors.primary} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>GOVIND PANSARI</Text>
            <Text style={styles.storeName}>{storeName}</Text>
            <Text style={styles.greeting}>Hi {profile?.name?.split(' ')[0] ?? 'there'}</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable onPress={() => router.push('/notifications')} style={styles.bellBtn} hitSlop={8}>
              <Bell size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
              {unreadCount > 0 && <View style={styles.bellDot} />}
            </Pressable>
            {dashboard && (
              <View style={[styles.statusBadge, { backgroundColor: STATUS_META[dashboard.operationalStatus].bg }]}>
                <View style={[styles.statusDot, { backgroundColor: STATUS_META[dashboard.operationalStatus].color }]} />
                <Text style={[styles.statusText, { color: STATUS_META[dashboard.operationalStatus].color }]}>
                  {STATUS_META[dashboard.operationalStatus].label}
                </Text>
              </View>
            )}
          </View>
        </View>

        {!dashboard && loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !dashboard && error ? (
          <EmptyState title="Couldn't load your store" subtitle="Check your connection and try again." ctaLabel="Retry" onPressCta={load} />
        ) : dashboard ? (
          <>
            {isManager && (
              <Pressable style={styles.pauseRow} onPress={handlePausePress} disabled={togglingStatus}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pauseRowText}>
                    {dashboard.isAcceptingOrders ? 'Pause new orders (temporarily unavailable)' : 'Resume accepting new orders'}
                  </Text>
                  {!dashboard.isAcceptingOrders && dashboard.statusReason && (
                    <Text style={styles.pauseReasonText}>{dashboard.statusReason}</Text>
                  )}
                </View>
                {togglingStatus && <ActivityIndicator size="small" color={colors.primary} />}
              </Pressable>
            )}

            <View style={styles.revenueCard}>
              <Text style={styles.revenueLabel}>Today</Text>
              <Text style={styles.revenueValue}>{formatINR(dashboard.todayRevenue)}</Text>
              <Text style={styles.revenueSub}>{dashboard.todayOrderCount} orders today</Text>
            </View>

            <View style={styles.statGrid}>
              <StatCard label="New" value={dashboard.newOrders} tone="primary" onPress={() => goToOrders('placed')} />
              <StatCard label="Processing" value={dashboard.processing} tone="info" onPress={() => goToOrders('processing')} />
              <StatCard label="Picking" value={dashboard.picking} tone="warning" onPress={() => goToOrders('picking')} />
              <StatCard label="Packing" value={dashboard.packing} tone="warning" onPress={() => goToOrders('packing')} />
              <StatCard label="Ready" value={dashboard.readyForPickup} tone="success" onPress={() => goToOrders('packed')} />
              <StatCard label="Cancelled/Rejected" value={dashboard.cancelledOrRejectedToday} tone="muted" />
            </View>

            <View style={styles.sectionRow}>
              <Pressable style={[styles.inventoryAlertCard, { borderColor: colors.warning }]} onPress={() => router.push('/store/inventory')}>
                <AlertTriangle size={ICON_SIZE.md} color={colors.warning} strokeWidth={ICON_STROKE} />
                <Text style={styles.inventoryAlertValue}>{dashboard.lowStockCount}</Text>
                <Text style={styles.inventoryAlertLabel}>Low Stock</Text>
              </Pressable>
              <Pressable style={[styles.inventoryAlertCard, { borderColor: colors.error }]} onPress={() => router.push('/store/inventory')}>
                <PackageX size={ICON_SIZE.md} color={colors.error} strokeWidth={ICON_STROKE} />
                <Text style={styles.inventoryAlertValue}>{dashboard.outOfStockCount}</Text>
                <Text style={styles.inventoryAlertLabel}>Out of Stock</Text>
              </Pressable>
            </View>

            <View style={styles.slaCard}>
              <View style={styles.slaHeaderRow}>
                <Clock size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.slaTitle}>Today's Pace</Text>
              </View>
              <SlaRow label="Avg. time to accept" minutes={dashboard.avgAcceptanceMinutes} />
              <SlaRow label="Avg. picking time" minutes={dashboard.avgPickingMinutes} />
              <SlaRow label="Avg. packing time" minutes={dashboard.avgPackingMinutes} />
              <SlaRow label="Avg. total fulfillment" minutes={dashboard.avgFulfillmentMinutes} bold />
            </View>

            <Pressable style={styles.activityRow} onPress={() => router.push('/store/activity' as never)}>
              <Text style={styles.activityRowText}>View Store Activity</Text>
              <Text style={styles.activityRowArrow}>→</Text>
            </Pressable>
          </>
        ) : null}

        <SafeBottomSpacer />
      </ScrollView>

      {showPauseModal && (
        <PauseReasonModal
          onCancel={() => setShowPauseModal(false)}
          onConfirm={(reason) => {
            setShowPauseModal(false);
            handleToggleStatus(reason);
          }}
        />
      )}
    </SafeScreen>
  );
}

function PauseReasonModal({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Pause new orders</Text>
            <Text style={styles.modalSubtitle}>Customers won't be able to order from your store until you resume. A reason helps other staff and admin understand why (e.g. "Store maintenance").</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Reason (optional)"
              placeholderTextColor={colors.textMuted}
              value={reason}
              onChangeText={setReason}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={onCancel}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirmBtn} onPress={() => onConfirm(reason.trim())}>
                <Text style={styles.modalConfirmText}>Pause Orders</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function StatCard({ label, value, tone, onPress }: { label: string; value: number; tone: 'primary' | 'info' | 'warning' | 'success' | 'muted'; onPress?: () => void }) {
  const toneColor = { primary: colors.primary, info: colors.info, warning: colors.warning, success: colors.success, muted: colors.textMuted }[tone];
  return (
    <Pressable style={styles.statCard} onPress={onPress} disabled={!onPress}>
      <Text style={[styles.statValue, { color: toneColor }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

function SlaRow({ label, minutes, bold }: { label: string; minutes: number | null; bold?: boolean }) {
  return (
    <View style={styles.slaRow}>
      <Text style={[styles.slaLabel, bold && styles.slaLabelBold]}>{label}</Text>
      <Text style={[styles.slaValue, bold && styles.slaValueBold]}>{minutes != null ? `${minutes} min` : 'No data yet'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.base, paddingTop: spacing.sm },
  centerFill: { paddingVertical: spacing.xxl * 2, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...textStyles.body, color: colors.textSecondary, textAlign: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.lg },
  brand: { ...textStyles.caption, color: colors.textMuted, letterSpacing: 1.2, fontFamily: 'PlusJakartaSans_700Bold' },
  storeName: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: colors.textPrimary, marginTop: 2 },
  greeting: { ...textStyles.bodySmall, color: colors.textSecondary, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bellBtn: { position: 'relative', padding: 2 },
  bellDot: { position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error, borderWidth: 1.5, borderColor: colors.background },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 0.5 },
  pauseRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surfaceSunken, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  pauseRowText: { ...textStyles.bodySmall, color: colors.textPrimary },
  pauseReasonText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  activityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, paddingHorizontal: spacing.xs, marginTop: spacing.xs },
  activityRowText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  activityRowArrow: { color: colors.primary, fontSize: 16 },
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...shadows.lg },
  modalTitle: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary },
  modalSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.md, lineHeight: 16 },
  modalInput: { backgroundColor: colors.surfaceSunken, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44, ...textStyles.bodySmall, color: colors.textPrimary },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { ...textStyles.button, color: colors.textPrimary, fontSize: 14 },
  modalConfirmBtn: { flex: 1, height: 46, borderRadius: radius.md, backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center' },
  modalConfirmText: { ...textStyles.button, color: colors.white, fontSize: 14 },
  revenueCard: { backgroundColor: colors.primaryDarker, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  revenueLabel: { ...textStyles.caption, color: 'rgba(255,255,255,0.75)' },
  revenueValue: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 34, color: colors.white, marginTop: 4 },
  revenueSub: { ...textStyles.caption, color: 'rgba(255,255,255,0.75)', marginTop: 4 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  statCard: { width: '31%', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', ...shadows.sm },
  statValue: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24 },
  statLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2, textAlign: 'center' },
  sectionRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  inventoryAlertCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', borderWidth: 1, ...shadows.sm },
  inventoryAlertValue: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: colors.textPrimary, marginTop: 4 },
  inventoryAlertLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  slaCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, ...shadows.sm },
  slaHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  slaTitle: { ...textStyles.cardTitle, color: colors.textPrimary },
  slaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  slaLabel: { ...textStyles.bodySmall, color: colors.textSecondary },
  slaLabelBold: { color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  slaValue: { ...textStyles.bodySmall, color: colors.textPrimary },
  slaValueBold: { fontFamily: 'PlusJakartaSans_700Bold' },
});
