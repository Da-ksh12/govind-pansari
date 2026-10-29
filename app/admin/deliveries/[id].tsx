import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Camera, Check, IndianRupee, MapPin, Navigation, Package, Phone, Truck, User } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { AdminShell } from '../../../components/admin/AdminShell';
import { StatusBadge } from '../../../components/admin/StatusBadge';
import { Avatar } from '../../../components/ui/Avatar';
import { AppImage } from '../../../components/ui/AppImage';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatINR } from '../../../components/ui/PriceBlock';
import { pushAdmin } from '../../../services/adminNav';
import { adminRepository } from '../../../services/repositories/adminRepository';
import { storeOpsRepository } from '../../../services/repositories/storeOpsRepository';
import { describeAssignmentError } from '../../../services/assignmentErrors';
import { canCancelAssignment } from '../../../services/riderAssignment';
import { AssignRiderModal, type AssignableOrder } from '../../../components/admin/AssignRiderModal';
import { CancelAssignmentDialog } from '../../../components/dispatch/CancelAssignmentDialog';
import { useAdminStore } from '../../../store/adminStore';
import { useStableCallback } from '../../../hooks/useStableCallback';
import { useRefetchOnForeground } from '../../../hooks/useRefetchOnForeground';
import { useUIStore } from '../../../store/uiStore';

const TERMINAL = new Set(['completed', 'failed', 'declined', 'expired', 'cancelled']);

// Real timeline stages, each backed by a real timestamp column on
// delivery_assignments (or orders.placed_at for the very first one) —
// no fabricated "Reached Destination" entry, since mark_order_approaching()
// never writes a timestamp for that transition anywhere (see the
// current status badge for that signal instead).
function buildTimeline(d: any) {
  const stages: { label: string; at: string | null }[] = [
    { label: 'Order Placed', at: d.orders?.placed_at ?? null },
    { label: 'Rider Assigned', at: d.assigned_at },
    { label: 'Rider Accepted', at: d.accepted_at },
    { label: 'Arrived at Store', at: d.arrived_at_store_at },
    { label: 'Picked Up', at: d.picked_up_at },
    { label: 'Out for Delivery', at: d.out_for_delivery_at },
  ];
  if (d.status === 'completed') stages.push({ label: 'Delivered', at: d.completed_at });
  else if (d.status === 'failed') stages.push({ label: 'Delivery Failed', at: d.failed_at });
  return stages.filter((s) => s.at !== null);
}

export default function AdminDeliveryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [detail, setDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [assignOrder, setAssignOrder] = useState<AssignableOrder | null>(null);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    adminRepository.getDeliveryDetail(id).then(setDetail).catch(() => setDetail(null)).finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(load);

  // Live: this assignment's own row (accepted, at store, picked up, completed, reassigned, cancelled). A live refresh
  // keeps the current screen and never swaps a good page for an error.
  const refreshQuietly = useStableCallback(() => {
    if (!id) return;
    adminRepository.getDeliveryDetail(id).then((d) => d && setDetail(d)).catch(() => {});
  });
  useEffect(() => (id ? adminRepository.subscribeToAdminDelivery(id, refreshQuietly) : undefined), [id, refreshQuietly]);
  useRefetchOnForeground(refreshQuietly);

  if (loading && !detail) {
    return (
      <AdminShell title="Delivery">
        <View style={styles.centerFill}><ActivityIndicator color={colors.primary} /></View>
      </AdminShell>
    );
  }
  if (!detail) {
    return (
      <AdminShell title="Delivery">
        <EmptyState title="Couldn't load this delivery" subtitle="It may have been removed, or something went wrong." ctaLabel="Retry" onPressCta={load} />
      </AdminShell>
    );
  }

  const order = detail.orders;
  const rider = detail.riders;
  const store = detail.stores;
  const timeline = buildTimeline(detail);
  const isLive = !TERMINAL.has(detail.status);
  const riderName: string = rider?.profiles?.full_name ?? 'The rider';
  const orderForAssign: AssignableOrder = { id: detail.order_id, order_number: order?.order_number ?? '', store_name: store?.name ?? '', total: order?.total ?? 0 };
  const canCancel = isLive && canCancelAssignment(detail.status) && hasPermission('deliveries.reassign');
  // A declined / timed-out request leaves the order ready for pickup with nobody on it.
  const canChooseAnother = (detail.status === 'declined' || detail.status === 'expired') && order?.status === 'packed' && hasPermission('deliveries.assign');

  const cancelAssignment = async () => {
    try {
      await storeOpsRepository.cancelAssignment(detail.id, 'reassigning');
    } catch (e) {
      showToast(describeAssignmentError(e).message, 'error');
      load();
      return;
    }
    // Taken back — now choose the replacement straight away.
    load();
    setAssignOrder(orderForAssign);
  };

  return (
    <AdminShell title={`Delivery #${order?.order_number ?? ''}`}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.backRow} onPress={() => router.back()}>
          <ArrowLeft size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back to Deliveries</Text>
        </Pressable>

        {/* Header */}
        <View style={styles.headerCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.orderTitle}>#{order?.order_number}</Text>
            <Text style={styles.mutedText}>{new Date(order?.placed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
            <StatusBadge status={detail.status} />
            <Text style={styles.amount}>{formatINR(order?.total ?? 0)}</Text>
          </View>
        </View>

        {isLive && (
          <Pressable style={styles.trackBtn} onPress={() => router.push(`/track/${detail.order_id}` as never)}>
            <Truck size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.trackBtnText}>View Live Tracking</Text>
          </Pressable>
        )}

        {(canCancel || canChooseAnother) && (
          <View style={styles.actionRow}>
            {canCancel && (
              <Pressable style={styles.cancelBtn} onPress={() => setCancelOpen(true)}>
                <Text style={styles.cancelBtnText}>Cancel assignment</Text>
              </Pressable>
            )}
            {canChooseAnother && (
              <Pressable style={styles.chooseBtn} onPress={() => setAssignOrder(orderForAssign)}>
                <Text style={styles.chooseBtnText}>Choose another rider</Text>
              </Pressable>
            )}
          </View>
        )}

        <View style={styles.grid}>
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <User size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.cardTitle}>Customer</Text>
            </View>
            <Text style={styles.plainText}>{order?.profiles?.full_name ?? 'Customer'}</Text>
            <Text style={styles.mutedText}>{order?.profiles?.phone}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.cardTitle}>Store</Text>
            </View>
            <Text style={styles.plainText}>{store?.name}</Text>
            <Text style={styles.mutedText}>{store?.address_line}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Phone size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.cardTitle}>Rider</Text>
            </View>
            {rider ? (
              <Pressable style={styles.riderRow} onPress={() => pushAdmin(`/admin/riders/${rider.id}`)}>
                <Avatar uri={rider.profiles?.avatar_url} name={rider.profiles?.full_name ?? 'Rider'} size="sm" />
                <View>
                  <Text style={styles.plainText}>{rider.profiles?.full_name}</Text>
                  <Text style={styles.mutedText}>{rider.vehicle_type}{rider.vehicle_number ? ` • ${rider.vehicle_number}` : ''}</Text>
                </View>
              </Pressable>
            ) : (
              <Text style={styles.mutedText}>Not yet assigned</Text>
            )}
          </View>
        </View>

        {/* Items */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Items</Text>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {(order?.order_items ?? []).map((item: any) => (
            <View key={item.id} style={styles.itemRow}>
              <AppImage uri={item.image_snapshot} style={styles.itemThumb} fallbackIcon={Package} />
              <Text style={styles.itemName} numberOfLines={1}>{item.product_name_snapshot}{item.variant_snapshot ? ` • ${item.variant_snapshot}` : ''}</Text>
              <Text style={styles.itemQty}>×{item.quantity}</Text>
              <Text style={styles.itemPrice}>{formatINR(item.unit_price * item.quantity)}</Text>
            </View>
          ))}
        </View>

        {/* Timeline */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Timeline</Text>
          {timeline.map((evt, i) => {
            const isLast = i === timeline.length - 1;
            return (
              <View key={i} style={styles.timelineRow}>
                <View style={styles.timelineRail}>
                  <View style={[styles.timelineDot, isLast && styles.timelineDotActive]}>
                    {isLast && <Check size={9} color={colors.white} strokeWidth={3} />}
                  </View>
                  {i < timeline.length - 1 && <View style={styles.timelineLine} />}
                </View>
                <View style={styles.timelineContent}>
                  <Text style={[styles.timelineLabel, isLast && styles.timelineLabelActive]}>{evt.label}</Text>
                  <Text style={styles.mutedText}>{new Date(evt.at!).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
              </View>
            );
          })}
          {detail.status === 'failed' && detail.failure_reason && (
            <Text style={styles.failureText}>Reason: {String(detail.failure_reason).replace(/_/g, ' ')}</Text>
          )}
        </View>

        {/* Delivery proof */}
        {detail.status === 'completed' && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Camera size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.cardTitle}>Delivery Proof</Text>
            </View>
            {detail.cash_collected != null && (
              <View style={styles.proofCashRow}>
                <IndianRupee size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                <Text style={styles.mutedText}>{formatINR(detail.cash_collected)} collected (COD)</Text>
              </View>
            )}
            {detail.delivery_proof_photo_url ? (
              <AppImage uri={detail.delivery_proof_photo_url} style={styles.proofPhoto} fallbackIcon={Camera} />
            ) : (
              <Text style={styles.mutedText}>No photo on file.</Text>
            )}
            {detail.delivery_proof_latitude != null && detail.delivery_proof_longitude != null && (
              <Pressable
                style={styles.trackBtn}
                onPress={() => Linking.openURL(`https://www.google.com/maps?q=${detail.delivery_proof_latitude},${detail.delivery_proof_longitude}`).catch(() => {})}
              >
                <Navigation size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.trackBtnText}>View delivery location on map</Text>
              </Pressable>
            )}
          </View>
        )}
      </ScrollView>

      <CancelAssignmentDialog
        visible={cancelOpen}
        riderName={riderName}
        orderNumber={order?.order_number ?? ''}
        deliveryStatus={detail.status}
        onConfirm={cancelAssignment}
        onClose={() => setCancelOpen(false)}
      />
      <AssignRiderModal
        order={assignOrder}
        onClose={() => setAssignOrder(null)}
        onChanged={() => {
          // The new rider is on a new delivery — back to the list, where it shows up.
          router.replace('/admin/deliveries' as never);
        }}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  cancelBtn: { borderWidth: 1.5, borderColor: colors.error, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  cancelBtnText: { ...textStyles.button, fontSize: 14, color: colors.error },
  chooseBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  chooseBtnText: { ...textStyles.button, fontSize: 14, color: colors.white },
  content: { padding: spacing.lg, maxWidth: 900, width: '100%', alignSelf: 'center', gap: spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { ...textStyles.caption, color: colors.textSecondary },
  headerCard: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', backgroundColor: colors.surface,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, ...shadows.xs,
  },
  orderTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  amount: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary },
  trackBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  trackBtnText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: { flexGrow: 1, flexBasis: 260, minWidth: 260, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  cardTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, marginBottom: spacing.sm },
  plainText: { ...textStyles.bodySmall, color: colors.textPrimary },
  mutedText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  itemThumb: { width: 32, height: 32, borderRadius: radius.xs },
  itemName: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary },
  itemQty: { ...textStyles.caption, color: colors.textSecondary },
  itemPrice: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold', minWidth: 70, textAlign: 'right' },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineRail: { alignItems: 'center', width: 18 },
  timelineDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.surfaceSunken, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  timelineDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  timelineLine: { width: 2, flex: 1, minHeight: 20, backgroundColor: colors.border },
  timelineContent: { flex: 1, paddingBottom: spacing.md },
  timelineLabel: { ...textStyles.bodySmall, color: colors.textSecondary },
  timelineLabelActive: { color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  failureText: { ...textStyles.bodySmall, color: colors.error, marginTop: spacing.xs, textTransform: 'capitalize' },
  proofCashRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  proofPhoto: { width: '100%', height: 200, borderRadius: radius.md, marginBottom: spacing.md },
});
