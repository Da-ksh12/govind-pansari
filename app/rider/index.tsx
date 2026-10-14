import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Bell, ChevronRight, MapPin, Package } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../../components/layout/SafeBottomSpacer';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatINR } from '../../components/ui/PriceBlock';
import { useAuthStore } from '../../store/authStore';
import { useNotificationsStore } from '../../store/notificationsStore';
import { riderOpsRepository, type RiderDashboard } from '../../services/repositories/riderOpsRepository';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';

const STATUS_META: Record<RiderDashboard['status'], { label: string; color: string; bg: string }> = {
  offline: { label: 'OFFLINE', color: colors.textMuted, bg: colors.surfaceSunken },
  available: { label: 'AVAILABLE', color: colors.success, bg: colors.successTint },
  assigned: { label: 'ASSIGNED', color: colors.info, bg: colors.infoTint },
  at_store: { label: 'AT STORE', color: colors.info, bg: colors.infoTint },
  picking_up: { label: 'PICKING UP', color: colors.warning, bg: colors.warningTint },
  delivering: { label: 'DELIVERING', color: colors.primary, bg: colors.primaryTint },
  suspended: { label: 'SUSPENDED', color: colors.error, bg: colors.errorTint },
};

const DELIVERY_STAGE_LABEL: Record<string, string> = {
  assigned: 'New assignment — accept to continue',
  accepted: 'Head to the store',
  at_store: 'Confirm pickup at the store',
  picked_up: 'Ready — start the delivery',
  in_transit: 'Delivering now',
};

export default function RiderHomeScreen() {
  const profile = useAuthStore((s) => s.profile);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const [dashboard, setDashboard] = useState<RiderDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(false);
    riderOpsRepository
      .getDashboard()
      .then(setDashboard)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(load);

  // Priority 13 (pre-production hardening): live assignment updates —
  // previously this screen only refreshed on focus, so a new
  // assignment from a store manager/admin sat unseen until the rider
  // manually navigated away and back.
  useEffect(() => {
    if (!dashboard?.riderId) return;
    return riderOpsRepository.subscribeToRiderActivity(dashboard.riderId, load);
  }, [dashboard?.riderId, load]);
  useRefetchOnForeground(load);

  const handleToggleAvailability = async () => {
    if (!dashboard) return;
    setToggling(true);
    try {
      await riderOpsRepository.setAvailability(!dashboard.isAvailable);
      load();
    } catch (e) {
      // Most likely "cannot go offline with an active delivery" — surfaced by re-loading; the button simply won't have changed.
    } finally {
      setToggling(false);
    }
  };

  return (
    <SafeScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading && !!dashboard} onRefresh={load} tintColor={colors.primary} />}
      >
        <View style={styles.greetingRow}>
          <Text style={styles.greeting}>Good {timeOfDay()}, {profile?.name?.split(' ')[0] ?? 'Rider'}</Text>
          <Pressable onPress={() => router.push('/notifications')} style={styles.bellBtn} hitSlop={8}>
            <Bell size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
            {unreadCount > 0 && <View style={styles.bellDot} />}
          </Pressable>
        </View>

        {!dashboard && loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !dashboard && error ? (
          <EmptyState title="Couldn't load your dashboard" subtitle="Check your connection and try again." ctaLabel="Retry" onPressCta={load} />
        ) : dashboard ? (
          <>
            <Pressable
              style={[styles.statusCard, { backgroundColor: STATUS_META[dashboard.status].bg }]}
              onPress={dashboard.status === 'available' || dashboard.status === 'offline' ? handleToggleAvailability : undefined}
              disabled={toggling || !(dashboard.status === 'available' || dashboard.status === 'offline')}
            >
              <View style={[styles.statusDot, { backgroundColor: STATUS_META[dashboard.status].color }]} />
              <Text style={[styles.statusLabel, { color: STATUS_META[dashboard.status].color }]}>{STATUS_META[dashboard.status].label}</Text>
              {(dashboard.status === 'available' || dashboard.status === 'offline') && (
                <Text style={styles.statusHint}>{toggling ? 'Updating…' : `Tap to go ${dashboard.status === 'available' ? 'offline' : 'available'}`}</Text>
              )}
            </Pressable>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statValue}>{dashboard.todayDeliveredCount}</Text>
                <Text style={styles.statLabel}>Deliveries Today</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Current Delivery</Text>
            {dashboard.currentAssignment ? (
              <Pressable
                style={styles.deliveryCard}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- app/rider/** is new; .expo/types/router.d.ts needs a local `expo start` to regenerate. Real, valid route.
                onPress={() => router.push(`/rider/delivery/${dashboard.currentAssignment!.assignmentId}` as any)}
              >
                <View style={styles.deliveryTop}>
                  <Text style={styles.orderNumber}>#{dashboard.currentAssignment.orderNumber}</Text>
                  <ChevronRight size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                </View>
                <Text style={styles.stageText}>{DELIVERY_STAGE_LABEL[dashboard.currentAssignment.status] ?? dashboard.currentAssignment.status}</Text>
                <View style={styles.locRow}>
                  <Package size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.locText}>Pickup: {dashboard.currentAssignment.storeName}</Text>
                </View>
                <View style={styles.locRow}>
                  <MapPin size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.locText}>Deliver to: {dashboard.currentAssignment.deliveryCity || dashboard.currentAssignment.deliveryAddressLine1}</Text>
                </View>
                <View style={styles.deliveryBottom}>
                  <Text style={styles.viewText}>VIEW DELIVERY</Text>
                </View>
              </Pressable>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyText}>
                  {dashboard.status === 'offline' ? 'Go available to start receiving deliveries.' : 'No delivery assigned right now.'}
                </Text>
              </View>
            )}
          </>
        ) : null}

        <SafeBottomSpacer />
      </ScrollView>
    </SafeScreen>
  );
}

function timeOfDay() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.base, paddingTop: spacing.md },
  centerFill: { paddingVertical: spacing.xxl * 2, alignItems: 'center', justifyContent: 'center' },
  greetingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: spacing.lg },
  greeting: { flex: 1, fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: colors.textPrimary },
  bellBtn: { position: 'relative', padding: 2, marginTop: 4 },
  bellDot: { position: 'absolute', top: 4, right: 2, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error, borderWidth: 1.5, borderColor: colors.background },
  statusCard: { borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 6 },
  statusLabel: { fontSize: 20, fontFamily: 'PlusJakartaSans_800ExtraBold', letterSpacing: 1 },
  statusHint: { ...textStyles.caption, color: colors.textSecondary, marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', ...shadows.sm },
  statValue: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 28, color: colors.primary },
  statLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  sectionTitle: { ...textStyles.sectionTitle, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.sm },
  deliveryCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, ...shadows.sm },
  deliveryTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderNumber: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: colors.textPrimary },
  stageText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold', marginTop: 4 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  locText: { ...textStyles.caption, color: colors.textSecondary },
  deliveryBottom: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  viewText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold', textAlign: 'right' },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.xl, alignItems: 'center', ...shadows.sm },
  emptyText: { ...textStyles.bodySmall, color: colors.textSecondary, textAlign: 'center' },
});
