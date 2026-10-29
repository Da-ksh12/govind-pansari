import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Bike, Camera, Check, Clock, CreditCard, IndianRupee, MapPin, Navigation, Package, Phone, Store as StoreIcon, Truck, UserPlus, User, XCircle } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles, tabularNums } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { AdminShell } from '../../../components/admin/AdminShell';
import { AssignRiderModal } from '../../../components/admin/AssignRiderModal';
import { StatusBadge } from '../../../components/admin/StatusBadge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { AppImage } from '../../../components/ui/AppImage';
import { GPConfirmModal } from '../../../components/ui/modals/GPModal';
import { useAdminStore } from '../../../store/adminStore';
import { useStableCallback } from '../../../hooks/useStableCallback';
import { useRefetchOnForeground } from '../../../hooks/useRefetchOnForeground';
import { useUIStore } from '../../../store/uiStore';
import { pushAdmin } from '../../../services/adminNav';
import { adminRepository, type AdminOrderLine, type AdminOrderPayment } from '../../../services/repositories/adminRepository';
import { storeOpsRepository, type CompletedDeliveryProof } from '../../../services/repositories/storeOpsRepository';
import {
  addressLines,
  allowedOrderActions,
  breakdownMismatch,
  cleanTimeline,
  describePayment,
  formatMoney,
  formatOrderDateTime,
  formatPhone,
  itemCountText,
  phoneDigits,
  priceBreakdown,
  type PaymentTone,
  type TimelineEntry,
} from '../../../services/adminOrderView';

const FINISHED_DELIVERY = new Set(['completed', 'cancelled', 'declined', 'expired', 'failed']);
const PAYMENT_TONE: Record<PaymentTone, { fg: string; bg: string }> = {
  good: { fg: colors.success, bg: colors.successTint },
  pending: { fg: colors.warning, bg: colors.warningTint },
  bad: { fg: colors.error, bg: colors.errorTint },
  neutral: { fg: colors.textSecondary, bg: colors.surfaceSunken },
};

export default function AdminOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [detail, setDetail] = useState<any | null>(null);
  // undefined = still loading, null = could not be read
  const [lines, setLines] = useState<AdminOrderLine[] | null | undefined>(undefined);
  // undefined = still loading, null = none / could not be read
  const [payment, setPayment] = useState<AdminOrderPayment | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [deliveryProof, setDeliveryProof] = useState<CompletedDeliveryProof | null>(null);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);

  // `silent` is a live refresh (a realtime event, coming back to the foreground): it keeps what is on screen while the
  // fresh copy loads and never replaces a good screen with an error. The first load and Retry are not silent.
  const load = useCallback(
    (silent = false) => {
      if (!id) return;
      if (!silent) {
        setLoading(true);
        setLoadFailed(false);
      }
      adminRepository
        .getOrderDetail(id)
        .then((d) => {
          setDetail(d);
          setLoadFailed(false);
          // Photos and payment come from their own tables; if either cannot be read the screen says so instead of guessing.
          if (!silent) {
            setLines(undefined);
            setPayment(undefined);
          }
          adminRepository.getOrderLines(id).then(setLines).catch(() => !silent && setLines(null));
          adminRepository.getOrderPayment(id).then(setPayment).catch(() => !silent && setPayment(null));
        })
        .catch(() => {
          if (silent) return;
          setDetail(null);
          setLoadFailed(true);
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [id],
  );

  useFocusEffect(useCallback(() => load(), [load]));

  // Live: this order's row and its delivery assignments only. Whoever changes it — the customer, the store, a rider,
  // another admin — this screen follows without a manual refresh.
  const refreshQuietly = useStableCallback(() => load(true));
  useEffect(() => (id ? adminRepository.subscribeToAdminOrder(id, refreshQuietly) : undefined), [id, refreshQuietly]);
  useRefetchOnForeground(refreshQuietly);

  // Delivery proof is already built for the store side (storeOpsRepository.getDeliveryProof) — reused as-is.
  useEffect(() => {
    if (!id || detail?.order?.status !== 'delivered') return;
    storeOpsRepository.getDeliveryProof(id).then(setDeliveryProof).catch(() => {});
  }, [id, detail?.order?.status]);

  const cancelOrder = async () => {
    setConfirmCancel(false);
    setCancelling(true);
    try {
      await adminRepository.cancelOrder(id);
      showToast('Order cancelled', 'success');
      // Show the result at once, then let the server's copy (timeline, refunds, stock) replace it.
      setDetail((d: any) => (d?.order ? { ...d, order: { ...d.order, status: 'cancelled' } } : d));
      load(true);
    } catch {
      showToast("Couldn't cancel this order.", 'error');
    } finally {
      setCancelling(false);
    }
  };

  if (loading && !detail) {
    return (
      <AdminShell title="Order">
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </AdminShell>
    );
  }
  if (!detail?.order) {
    return (
      <AdminShell title="Order">
        <EmptyState
          title={loadFailed ? "Couldn't load this order" : 'Order not found'}
          subtitle={loadFailed ? 'Check your connection and try again.' : 'It may have been removed.'}
          ctaLabel="Retry"
          onPressCta={() => load()}
        />
      </AdminShell>
    );
  }

  const order = detail.order;
  const delivery = detail.delivery as { assignmentId: string; status: string; riderName: string; riderPhone?: string | null } | null;
  const hasActiveDelivery = !!delivery && !FINISHED_DELIVERY.has(delivery.status);
  const actions = allowedOrderActions(order, hasActiveDelivery, (p) => hasPermission(p));
  const timeline = cleanTimeline((detail.timeline ?? []) as TimelineEntry[]);
  const money = priceBreakdown(order);
  const pay = describePayment(payment?.method, order.payment_status, false);
  const payTone = PAYMENT_TONE[pay.tone];
  const address = detail.deliveryAddress as Record<string, string | null> | null;
  const customerPhone: string | undefined = detail.customer?.phone;

  return (
    <AdminShell title={`Order #${order.order_number}`} subtitle={formatOrderDateTime(order.placed_at)}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.backRow} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back to orders" hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back to Orders</Text>
        </Pressable>

        {/* Summary */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.summaryNumber} numberOfLines={1}>#{order.order_number}</Text>
              <View style={styles.inlineRow}>
                <Clock size={12} color={colors.textMuted} strokeWidth={ICON_STROKE} />
                <Text style={styles.mutedText}>{formatOrderDateTime(order.placed_at)}</Text>
              </View>
            </View>
            <StatusBadge status={order.status} />
          </View>
          <View style={styles.summaryBottom}>
            <View>
              <Text style={styles.label}>Total</Text>
              <Text style={styles.summaryTotal}>{formatMoney(order.total)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={styles.mutedText}>{lines ? itemCountText(lines.length) : ''}</Text>
              <View style={[styles.payChip, { backgroundColor: payTone.bg }]}>
                <Text style={[styles.payChipText, { color: payTone.fg }]}>{pay.status}</Text>
              </View>
            </View>
          </View>
          {order.status === 'cancelled' && !!order.cancellation_reason && <Text style={styles.cancelReason}>Cancelled: {order.cancellation_reason}</Text>}
        </View>

        <View style={styles.grid}>
          <View style={styles.mainCol}>
            {/* Items */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Package size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardTitle}>Items</Text>
              </View>
              {(lines ?? []).map((line) => (
                <View key={line.id} style={styles.itemRow}>
                  <AppImage uri={line.image} style={styles.itemThumb} fallbackIcon={Package} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.itemName} numberOfLines={2}>{line.name}</Text>
                    <Text style={styles.mutedText} numberOfLines={1}>{[line.variant, line.sku ? `SKU ${line.sku}` : null].filter(Boolean).join(' · ')}</Text>
                    <Text style={styles.mutedText}>
                      {line.quantity} × {formatMoney(line.unitPrice)}
                      {line.mrp > line.unitPrice ? <Text style={styles.strike}>{`  ${formatMoney(line.mrp)}`}</Text> : null}
                    </Text>
                  </View>
                  <Text style={styles.itemTotal}>{formatMoney(line.total)}</Text>
                </View>
              ))}
              {lines === undefined && <Text style={styles.mutedText}>Loading items…</Text>}
              {lines === null && <Text style={styles.mutedText}>The item details could not be loaded. Go back and open the order again to retry.</Text>}
              {lines && lines.length === 0 && <Text style={styles.mutedText}>No items are recorded on this order.</Text>}
            </View>

            {/* Money, as stored */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <IndianRupee size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardTitle}>Price details</Text>
              </View>
              {money.map((line) => (
                <View key={line.label} style={[styles.moneyRow, line.kind === 'total' && styles.moneyTotalRow]}>
                  <Text style={[styles.moneyLabel, line.kind === 'total' && styles.moneyTotalLabel]}>{line.label}</Text>
                  <Text style={[styles.moneyValue, line.kind === 'discount' && line.amount > 0 && { color: colors.success }, line.kind === 'total' && styles.moneyTotalValue]}>
                    {line.kind === 'discount' && line.amount > 0 ? '−' : ''}
                    {line.kind === 'delivery' && line.amount === 0 ? 'Free' : formatMoney(line.amount)}
                  </Text>
                </View>
              ))}
              {breakdownMismatch(order) && <Text style={styles.mutedText}>These amounts are shown exactly as stored on the order.</Text>}
            </View>

            {/* Payment */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <CreditCard size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardTitle}>Payment</Text>
              </View>
              <View style={styles.moneyRow}>
                <Text style={styles.moneyLabel}>Method</Text>
                <Text style={styles.moneyValue}>{pay.method}</Text>
              </View>
              <View style={styles.moneyRow}>
                <Text style={styles.moneyLabel}>Status</Text>
                <View style={[styles.payChip, { backgroundColor: payTone.bg }]}>
                  <Text style={[styles.payChipText, { color: payTone.fg }]}>{pay.status}</Text>
                </View>
              </View>
              {payment === undefined && <Text style={styles.mutedText}>Loading payment…</Text>}
              {payment === null && <Text style={styles.mutedText}>No payment record could be loaded for this order.</Text>}
            </View>

            {/* Timeline */}
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Clock size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardTitle}>Timeline</Text>
              </View>
              {timeline.length === 0 && <Text style={styles.mutedText}>No status history yet.</Text>}
              {timeline.map((evt, i) => {
                const isLast = i === timeline.length - 1;
                return (
                  <View key={`${evt.at}-${i}`} style={styles.timelineRow}>
                    <View style={styles.timelineRail}>
                      <View style={[styles.timelineDot, isLast && styles.timelineDotActive]}>{isLast && <Check size={9} color={colors.white} strokeWidth={3} />}</View>
                      {i < timeline.length - 1 && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text style={[styles.timelineLabel, isLast && styles.timelineLabelActive]}>{evt.text}</Text>
                      <Text style={styles.timelineTime}>{formatOrderDateTime(evt.at)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {order.status === 'delivered' && (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Camera size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.cardTitle}>Delivery Proof</Text>
                </View>
                {deliveryProof ? (
                  <>
                    <Text style={styles.plainText}>Captured by {deliveryProof.riderName}</Text>
                    <Text style={styles.mutedText}>{formatOrderDateTime(deliveryProof.completedAt)}</Text>
                    {deliveryProof.cashCollected != null && <Text style={styles.mutedText}>{formatMoney(deliveryProof.cashCollected)} collected (COD)</Text>}
                    {deliveryProof.photoUrl && <AppImage uri={deliveryProof.photoUrl} style={styles.proofPhoto} fallbackIcon={Camera} />}
                    {deliveryProof.latitude != null && deliveryProof.longitude != null && (
                      <Pressable style={styles.linkRow} onPress={() => Linking.openURL(`https://www.google.com/maps?q=${deliveryProof.latitude},${deliveryProof.longitude}`).catch(() => {})}>
                        <Navigation size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                        <Text style={styles.linkText}>View delivery location on map</Text>
                      </Pressable>
                    )}
                  </>
                ) : (
                  <Text style={styles.mutedText}>Loading delivery proof…</Text>
                )}
              </View>
            )}
          </View>

          <View style={styles.sideCol}>
            {/* Actions: only what this order's status and this admin's role allow */}
            {(actions.canAssignRider || actions.canCancel || actions.canTrack) && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Actions</Text>
                {actions.canAssignRider && (
                  <Pressable style={styles.primaryAction} onPress={() => setAssigning(true)} accessibilityRole="button">
                    <UserPlus size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
                    <Text style={styles.primaryActionText}>Choose a rider</Text>
                  </Pressable>
                )}
                {actions.canTrack && (
                  <Pressable style={styles.secondaryAction} onPress={() => router.push(`/track/${order.id}` as never)} accessibilityRole="button">
                    <Truck size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                    <Text style={styles.secondaryActionText}>View live tracking</Text>
                  </Pressable>
                )}
                {actions.canCancel && (
                  <Pressable style={styles.dangerAction} onPress={() => setConfirmCancel(true)} disabled={cancelling} accessibilityRole="button">
                    <XCircle size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
                    <Text style={styles.dangerActionText}>{cancelling ? 'Cancelling…' : 'Cancel order'}</Text>
                  </Pressable>
                )}
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <User size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardTitle}>Customer</Text>
              </View>
              <Text style={styles.plainText}>{detail.customer?.name ?? 'Unknown customer'}</Text>
              {!!customerPhone && (
                <Pressable style={styles.linkRow} onPress={() => Linking.openURL(`tel:${phoneDigits(customerPhone)}`).catch(() => {})} accessibilityRole="link" accessibilityLabel={`Call ${formatPhone(customerPhone)}`}>
                  <Phone size={ICON_SIZE.xs} color={colors.primary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.linkText}>{formatPhone(customerPhone)}</Text>
                </Pressable>
              )}
              {hasPermission('customers.view') && detail.customer?.id && (
                <Pressable onPress={() => pushAdmin(`/admin/customers/${detail.customer.id}`)}>
                  <Text style={styles.linkText}>View customer profile</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardTitle}>Delivery address</Text>
              </View>
              {!!address?.recipient_name && <Text style={styles.plainText}>{address.recipient_name}</Text>}
              {!!address?.phone && <Text style={styles.mutedText}>{formatPhone(address.phone)}</Text>}
              {addressLines(address).map((l) => (
                <Text key={l} style={styles.mutedText}>{l}</Text>
              ))}
              {addressLines(address).length === 0 && <Text style={styles.mutedText}>No address is stored on this order.</Text>}
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <StoreIcon size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardTitle}>Fulfilling store</Text>
              </View>
              <Text style={styles.plainText}>{detail.store?.name ?? 'Unknown store'}</Text>
              {!!detail.store?.addressLine && <Text style={styles.mutedText}>{detail.store.addressLine}</Text>}
            </View>

            {delivery && (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Bike size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.cardTitle}>Rider</Text>
                </View>
                <Text style={styles.plainText}>{delivery.riderName}</Text>
                {!!delivery.riderPhone && (
                  <Pressable style={styles.linkRow} onPress={() => Linking.openURL(`tel:${phoneDigits(delivery.riderPhone)}`).catch(() => {})}>
                    <Phone size={ICON_SIZE.xs} color={colors.primary} strokeWidth={ICON_STROKE} />
                    <Text style={styles.linkText}>{formatPhone(delivery.riderPhone)}</Text>
                  </Pressable>
                )}
                <View style={{ marginTop: 6 }}>
                  <StatusBadge status={delivery.status} size="sm" />
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      <GPConfirmModal
        visible={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        destructive
        title="Cancel this order?"
        message="Stock will be released automatically and the customer will be told. This cannot be undone."
        primaryLabel="Cancel order"
        onPressPrimary={cancelOrder}
        secondaryLabel="Keep order"
        onPressSecondary={() => setConfirmCancel(false)}
      />
      <AssignRiderModal
        order={assigning ? { id: order.id, order_number: order.order_number, store_name: detail.store?.name ?? '', total: Number(order.total) } : null}
        onClose={() => setAssigning(false)}
        onChanged={() => load(true)}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, maxWidth: 1100, width: '100%', alignSelf: 'center', gap: spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  backText: { ...textStyles.caption, color: colors.textSecondary },
  summaryCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  summaryNumber: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  summaryBottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: spacing.md },
  summaryTotal: { ...textStyles.cardTitle, fontSize: 22, color: colors.textPrimary, ...tabularNums },
  label: { ...textStyles.caption, color: colors.textMuted },
  cancelReason: { ...textStyles.bodySmall, color: colors.error },
  payChip: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  payChipText: { ...textStyles.caption, fontFamily: 'PlusJakartaSans_700Bold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  mainCol: { flex: 2, minWidth: 300, gap: spacing.md },
  sideCol: { flex: 1, minWidth: 260, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, gap: 4, ...shadows.xs },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  cardTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  itemThumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surfaceSunken },
  itemName: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  itemTotal: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold', ...tabularNums },
  strike: { textDecorationLine: 'line-through', color: colors.textMuted },
  moneyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 4 },
  moneyLabel: { ...textStyles.bodySmall, color: colors.textSecondary },
  moneyValue: { ...textStyles.bodySmall, color: colors.textPrimary, ...tabularNums },
  moneyTotalRow: { borderTopWidth: 1, borderTopColor: colors.divider, marginTop: spacing.xs, paddingTop: spacing.sm },
  moneyTotalLabel: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  moneyTotalValue: { ...textStyles.cardTitle, fontSize: 16, color: colors.textPrimary },
  plainText: { ...textStyles.bodySmall, color: colors.textPrimary },
  mutedText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36 },
  linkText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  primaryAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.xs },
  primaryActionText: { ...textStyles.button, color: colors.white, fontSize: 14 },
  secondaryAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, marginTop: spacing.xs },
  secondaryActionText: { ...textStyles.button, color: colors.primary, fontSize: 14 },
  dangerAction: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.error, marginTop: spacing.xs },
  dangerActionText: { ...textStyles.button, color: colors.error, fontSize: 14 },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineRail: { alignItems: 'center', width: 18 },
  timelineDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.surfaceSunken, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  timelineDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  timelineLine: { width: 2, flex: 1, minHeight: 20, backgroundColor: colors.border },
  timelineContent: { flex: 1, paddingBottom: spacing.md },
  timelineTime: { ...textStyles.caption, color: colors.textMuted, marginTop: 1 },
  timelineLabel: { ...textStyles.bodySmall, color: colors.textSecondary },
  timelineLabelActive: { color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  proofPhoto: { width: '100%', height: 200, borderRadius: radius.md, marginTop: spacing.md },
});
