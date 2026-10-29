import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { AlertTriangle, ArrowLeft, Bike, Camera, Check, CheckCircle2, Circle, Clock, IndianRupee, MapPin, Navigation, Phone, User, XCircle } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { SafeScreen } from '../../../components/layout/SafeScreen';
import { AppBottomSheet } from '../../../components/ui/AppBottomSheet';
import { AppImage } from '../../../components/ui/AppImage';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatINR } from '../../../components/ui/PriceBlock';
import { useStoreOpsStore } from '../../../store/storeOpsStore';
import {
  storeOpsRepository,
  type AssignableRider,
  type CompletedDeliveryProof,
  type OrderDeliveryStatus,
  type OrderRejectionReason,
  type StoreOrderDetail,
  type StoreOrderItem,
} from '../../../services/repositories/storeOpsRepository';
import { describeAssignmentError } from '../../../services/assignmentErrors';
import { canCancelAssignment, describeUnanswered, unansweredAttempt, type RiderAttempt } from '../../../services/riderAssignment';
import { CancelAssignmentDialog } from '../../../components/dispatch/CancelAssignmentDialog';
import { RiderDidNotAcceptNotice } from '../../../components/dispatch/RiderDidNotAcceptNotice';
import { RiderPickerList } from '../../../components/dispatch/RiderPickerList';
import { formatOrderAge } from '../../../services/timeAgo';
import { useRefetchOnForeground } from '../../../hooks/useRefetchOnForeground';

const DELIVERY_STAGE_LABEL: Record<string, string> = {
  assigned: 'Waiting for the rider to accept',
  accepted: 'Rider is heading to the store',
  at_store: 'Rider has arrived at the store',
  picked_up: 'Rider has the order',
  in_transit: 'Out for delivery',
};

const REJECTION_REASONS: { key: OrderRejectionReason; label: string }[] = [
  { key: 'store_unable_to_fulfill', label: 'Store unable to fulfill' },
  { key: 'inventory_mismatch', label: 'Inventory mismatch' },
  { key: 'store_closed', label: 'Store closed' },
  { key: 'operational_issue', label: 'Operational issue' },
];

const ACTION_LABEL: Partial<Record<StoreOrderDetail['status'], string>> = {
  confirmed: 'Start Processing',
  preparing: 'Start Picking',
  picking: 'Start Packing',
  packing: 'Mark Ready for Pickup',
};

const NEXT_STATUS: Partial<Record<StoreOrderDetail['status'], StoreOrderDetail['status']>> = {
  confirmed: 'preparing',
  preparing: 'picking',
  picking: 'packing',
  packing: 'packed',
};

export default function StoreOrderDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const activeStoreId = useStoreOpsStore((s) => s.activeStoreId);
  const myStores = useStoreOpsStore((s) => s.myStores);
  const staffRole = myStores.find((s) => s.storeId === activeStoreId)?.staffRole;
  const isManager = staffRole === 'store_manager';
  // Rider assignment (choose/cancel/reassign) is open to
  // any active store staff member, not manager-only — client request.
  // Exception resolution and other manager-only actions still gate on
  // `isManager` specifically.
  const canAssignRiders = staffRole === 'store_manager' || staffRole === 'staff';

  const [order, setOrder] = useState<StoreOrderDetail | null>(null);
  const [delivery, setDelivery] = useState<OrderDeliveryStatus | null>(null);
  const [deliveryProof, setDeliveryProof] = useState<CompletedDeliveryProof | null>(null);
  const [riders, setRiders] = useState<AssignableRider[]>([]);
  const [ridersLoading, setRidersLoading] = useState(false);
  const [ridersError, setRidersError] = useState<string | null>(null);
  const [busyRiderId, setBusyRiderId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<RiderAttempt[]>([]);
  const [requestSecondsLeft, setRequestSecondsLeft] = useState<number | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  // The assignment this screen last saw waiting for an answer — when it ends in a decline/timeout while the
  // manager is looking at the screen, they are asked straight away to choose again (once per assignment).
  const watchedAssignmentId = useRef<string | null>(null);
  const promptedAssignmentId = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [packingChecks, setPackingChecks] = useState({ items: false, quantity: false, packaging: false });
  const rejectSheetRef = useRef<BottomSheet>(null);
  const riderSheetRef = useRef<BottomSheet>(null);
  const packingSheetRef = useRef<BottomSheet>(null);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(false);
    Promise.all([storeOpsRepository.getOrderDetail(id), storeOpsRepository.getOrderDeliveryStatus(id), storeOpsRepository.getOrderRiderAttempts(id).catch(() => [] as RiderAttempt[])])
      .then(([o, d, history]) => {
        setOrder(o);
        setDelivery(d);
        setAttempts(history);
        if (o?.status === 'delivered') {
          storeOpsRepository.getDeliveryProof(id).then(setDeliveryProof).catch(() => setDeliveryProof(null));
        } else {
          setDeliveryProof(null);
        }
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(load);

  // Section 51: rider arrival/pickup for this one order reflects live
  // without the manager needing to leave and re-open the screen.
  useEffect(() => {
    if (!activeStoreId) return;
    return storeOpsRepository.subscribeToStoreActivity(activeStoreId, load);
  }, [activeStoreId, load]);
  useRefetchOnForeground(load);

  const loadRiders = useCallback(() => {
    if (!id) return;
    setRidersLoading(true);
    setRidersError(null);
    storeOpsRepository
      .getRidersForAssignment(id)
      .then(setRiders)
      .catch(() => {
        setRiders([]);
        setRidersError("Couldn't load the riders. Check your connection and try again.");
      })
      .finally(() => setRidersLoading(false));
  }, [id]);

  const openRiderSheet = () => {
    riderSheetRef.current?.expand();
    loadRiders();
  };

  // Real countdown against the request's own server deadline (expires_at) — how long the rider has left to
  // accept — never a client-invented timer.
  useEffect(() => {
    if (!delivery || delivery.status !== 'assigned' || !delivery.expiresAt) {
      setRequestSecondsLeft(null);
      return;
    }
    const expiresAt = new Date(delivery.expiresAt).getTime();
    const tick = () => setRequestSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [delivery?.assignmentId, delivery?.status, delivery?.expiresAt]);

  // "Ask again": when the rider this screen was waiting on declines or never answers, the manager is asked
  // straight away to choose another one (the red card below stays until they do).
  const notAccepted = order?.status === 'packed' ? unansweredAttempt(attempts, !!delivery) : null;
  useEffect(() => {
    if (delivery?.status === 'assigned') watchedAssignmentId.current = delivery.assignmentId;
  }, [delivery?.assignmentId, delivery?.status]);
  useEffect(() => {
    if (!notAccepted || !canAssignRiders) return;
    if (notAccepted.assignmentId !== watchedAssignmentId.current || promptedAssignmentId.current === notAccepted.assignmentId) return;
    promptedAssignmentId.current = notAccepted.assignmentId;
    const { title, detail } = describeUnanswered(notAccepted);
    Alert.alert(title, `${detail}\n\nChoose another rider now?`, [
      { text: 'Later', style: 'cancel' },
      { text: 'Choose rider', onPress: openRiderSheet },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notAccepted?.assignmentId, canAssignRiders]);

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = () => runAction(() => storeOpsRepository.acceptOrder(order!.id));
  const handleReject = (reason: OrderRejectionReason) => {
    rejectSheetRef.current?.close();
    runAction(() => storeOpsRepository.rejectOrder(order!.id, reason));
  };
  const handleAdvance = () => {
    // Section 15/56: packing has its own confirmation checklist before
    // the order can actually become READY_FOR_PICKUP — every other
    // stage transition uses the same advance_order_fulfillment() call
    // this always did, just with an extra confirmation step in front
    // of the one transition that ends this store's part of the job.
    if (order!.status === 'packing') {
      packingSheetRef.current?.expand();
      return;
    }
    const next = NEXT_STATUS[order!.status];
    if (!next) return;
    runAction(() => storeOpsRepository.advanceOrder(order!.id, next));
  };
  const confirmPacked = () => {
    packingSheetRef.current?.close();
    runAction(() => storeOpsRepository.advanceOrder(order!.id, 'packed'));
  };
  const handlePickItem = (item: StoreOrderItem, status: 'picked' | 'unavailable') => {
    runAction(() => storeOpsRepository.markItemPicked(item.id, status));
  };
  // An unavailable item can no longer be "resolved" with a confirmation tap:
  // that cleared the flag, left the item on the order and let it be packed,
  // delivered and charged in full. The two real resolutions are below.
  const handleReopenItem = (item: StoreOrderItem) => {
    Alert.alert('Item found?', `Put ${item.productName} back to be picked? It will have to be picked before the order can be packed.`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Yes, reopen', onPress: () => runAction(() => storeOpsRepository.reopenUnavailableItem(item.id)) },
    ]);
  };
  const handleCancelForUnavailable = () => {
    Alert.alert('Cancel this order?', 'The customer will be notified and the reserved stock released. This cannot be undone.', [
      { text: 'Keep order', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive', onPress: () => runAction(() => storeOpsRepository.cancelOrder(order!.id, 'Item unavailable')) },
    ]);
  };
  /** A person choosing a rider is the only way an order gets one. The server re-checks, under a row lock, that the order is still ready and the rider still free. */
  const handleAssignRider = async (rider: AssignableRider) => {
    if (!order || busyRiderId) return;
    setBusyRiderId(rider.riderId);
    try {
      await storeOpsRepository.assignRider(order.id, rider.riderId);
      riderSheetRef.current?.close();
      load();
    } catch (e) {
      const failure = describeAssignmentError(e);
      Alert.alert("Couldn't assign this rider", failure.message);
      if (failure.refresh) {
        riderSheetRef.current?.close();
        load();
      } else {
        loadRiders();
      }
    } finally {
      setBusyRiderId(null);
    }
  };
  /** After the second "yes": take the assignment back, then go straight to choosing a replacement. */
  const handleConfirmCancel = async () => {
    if (!delivery) return;
    try {
      await storeOpsRepository.cancelAssignment(delivery.assignmentId, 'reassigning');
    } catch (e) {
      const failure = describeAssignmentError(e);
      Alert.alert("Couldn't cancel the assignment", failure.message);
      load();
      return;
    }
    // The order is Ready for Pickup again: refresh it and open the rider list at once.
    load();
    openRiderSheet();
  };

  if (loading && !order) {
    return (
      <SafeScreen>
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeScreen>
    );
  }
  if (!order) {
    return (
      <SafeScreen>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <EmptyState
          icon={AlertTriangle}
          title={error ? "Couldn't load this order" : 'Order not found'}
          subtitle={error ? 'Check your connection and try again.' : 'It may have been removed.'}
          ctaLabel={error ? 'Retry' : undefined}
          onPressCta={error ? load : undefined}
        />
      </SafeScreen>
    );
  }

  const pendingCount = order.items.filter((i) => i.pickingStatus === 'pending').length;
  const unavailableCount = order.items.filter((i) => i.pickingStatus === 'unavailable').length;
  const packingBlocked = order.status === 'picking' && (pendingCount > 0 || unavailableCount > 0 || order.hasException);
  const groupedItems = groupByCategory(order.items);

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>#{order.orderNumber}</Text>
          <Text style={styles.headerSubtitle}>{formatOrderAge(order.placedAt)}</Text>
        </View>
        <View style={styles.statusPill}>
          <Text style={styles.statusPillText}>{order.status.replace(/_/g, ' ').toUpperCase()}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {(order.hasException || unavailableCount > 0) && order.status !== 'cancelled' && (
          <View style={styles.exceptionBanner}>
            <AlertTriangle size={ICON_SIZE.md} color={colors.error} strokeWidth={ICON_STROKE} />
            <View style={{ flex: 1 }}>
              <Text style={styles.exceptionBannerText}>
                {unavailableCount} item{unavailableCount === 1 ? ' is' : 's are'} unavailable, so this order can't be packed.
              </Text>
              <Text style={styles.rejectionNotes}>
                {isManager
                  ? 'Reopen an item if you found it, or cancel the order.'
                  : 'Ask a store manager to reopen the item if it was found, or to cancel the order.'}
              </Text>
            </View>
            {isManager && (
              <Pressable onPress={handleCancelForUnavailable} style={styles.resolveBtn} disabled={busy} accessibilityLabel="Cancel this order">
                <Text style={styles.resolveBtnText}>Cancel order</Text>
              </Pressable>
            )}
          </View>
        )}

        {order.status === 'cancelled' && order.rejectionReason && (
          <View style={styles.exceptionBanner}>
            <XCircle size={ICON_SIZE.md} color={colors.error} strokeWidth={ICON_STROKE} />
            <View style={{ flex: 1 }}>
              <Text style={styles.exceptionBannerText}>Rejected: {order.rejectionReason.replace(/_/g, ' ')}</Text>
              {order.rejectionNotes && <Text style={styles.rejectionNotes}>{order.rejectionNotes}</Text>}
            </View>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <User size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.cardTitle}>Customer</Text>
          </View>
          <Text style={styles.customerName}>{order.recipientName}</Text>
          <View style={styles.phoneRow}>
            <Phone size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
            <Text style={styles.phoneText}>{order.recipientPhone}</Text>
          </View>
          <View style={styles.addressRow}>
            <MapPin size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} style={{ marginTop: 2 }} />
            <Text style={styles.addressText}>
              {order.addressLine1}
              {order.addressLine2 ? `, ${order.addressLine2}` : ''}
              {order.landmark ? ` (near ${order.landmark})` : ''}, {order.city}
            </Text>
          </View>
          {!!order.deliveryInstructions && <Text style={styles.addressText}>Instructions: {order.deliveryInstructions}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Items ({order.items.length})</Text>
          {order.status === 'picking' && (
            <View style={styles.pickingProgressWrap}>
              <View style={styles.pickingProgressTrack}>
                <View style={[styles.pickingProgressFill, { width: `${Math.round(((order.items.length - pendingCount) / Math.max(order.items.length, 1)) * 100)}%` }]} />
              </View>
              <Text style={styles.pickingProgressText}>
                {order.items.length - pendingCount} / {order.items.length} picked — {Math.round(((order.items.length - pendingCount) / Math.max(order.items.length, 1)) * 100)}%
              </Text>
            </View>
          )}
          {Object.entries(groupedItems).map(([category, items]) => (
            <View key={category} style={{ marginTop: spacing.sm }}>
              <Text style={styles.categoryLabel}>{category.toUpperCase()}</Text>
              {items.map((item) => (
                <ItemRow key={item.id} item={item} canPick={order.status === 'picking'} onPick={handlePickItem} onReopen={isManager && order.status === 'picking' ? handleReopenItem : undefined} />
              ))}
            </View>
          ))}
        </View>

        {(order.status === 'packed' || order.status === 'rider_assigned' || order.status === 'out_for_delivery') && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Bike size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.cardTitle}>Delivery</Text>
            </View>
            {delivery ? (
              <>
                <Text style={styles.customerName}>{delivery.riderName}</Text>
                <Text style={styles.stageText}>
                  {delivery.status === 'assigned' ? `Waiting for ${delivery.riderName} to accept` : DELIVERY_STAGE_LABEL[delivery.status] ?? delivery.status}
                </Text>
                {requestSecondsLeft !== null && (
                  <View style={styles.requestTimerRow}>
                    <Clock size={12} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                    <Text style={styles.requestTimerText}>
                      {Math.floor(requestSecondsLeft / 60)}:{String(requestSecondsLeft % 60).padStart(2, '0')} left to accept
                    </Text>
                  </View>
                )}
                {['accepted', 'at_store', 'picked_up', 'in_transit'].includes(delivery.status) && (
                  <Pressable style={styles.trackLiveBtn} onPress={() => router.push(`/track/${order.id}`)}>
                    <Text style={styles.trackLiveBtnText}>Track Live Location</Text>
                  </Pressable>
                )}
                {canAssignRiders && canCancelAssignment(delivery.status) && (
                  <Pressable style={styles.cancelAssignBtn} onPress={() => setCancelOpen(true)} disabled={busy}>
                    <Text style={styles.cancelAssignBtnText}>Cancel Assignment</Text>
                  </Pressable>
                )}
              </>
            ) : canAssignRiders ? (
              <View style={{ gap: spacing.sm }}>
                {notAccepted && <RiderDidNotAcceptNotice attempt={notAccepted} onChooseAnother={openRiderSheet} disabled={busy} />}
                {!notAccepted && (
                  <Pressable style={styles.assignBtn} onPress={openRiderSheet} disabled={busy}>
                    <Text style={styles.assignBtnText}>Assign Rider</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <Text style={styles.stageText}>Waiting for store staff to choose a rider</Text>
            )}
          </View>
        )}

        {order.status === 'delivered' && (
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Bike size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.cardTitle}>Delivered</Text>
            </View>
            {deliveryProof ? (
              <>
                <Text style={styles.customerName}>{deliveryProof.riderName}</Text>
                <Text style={styles.stageText}>
                  Delivered {new Date(deliveryProof.completedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                </Text>
                {deliveryProof.cashCollected != null && (
                  <View style={styles.phoneRow}>
                    <IndianRupee size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                    <Text style={styles.phoneText}>{formatINR(deliveryProof.cashCollected)} collected (COD)</Text>
                  </View>
                )}
                {deliveryProof.photoUrl && (
                  <AppImage uri={deliveryProof.photoUrl} style={styles.proofPhoto} contentFit="cover" fallbackIcon={Camera} />
                )}
                {deliveryProof.latitude != null && deliveryProof.longitude != null && (
                  <Pressable
                    style={styles.trackLiveBtn}
                    onPress={() => Linking.openURL(`https://www.google.com/maps?q=${deliveryProof.latitude},${deliveryProof.longitude}`).catch(() => {})}
                  >
                    <View style={styles.inlineRow}>
                      <Navigation size={13} color={colors.primary} strokeWidth={ICON_STROKE} />
                      <Text style={styles.trackLiveBtnText}>View delivery location on map</Text>
                    </View>
                  </Pressable>
                )}
              </>
            ) : (
              <Text style={styles.stageText}>Loading delivery proof…</Text>
            )}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Order Total</Text>
          <BillLine label="Subtotal" value={formatINR(order.subtotal)} />
          <BillLine label="Delivery Fee" value={order.deliveryFee === 0 ? 'FREE' : formatINR(order.deliveryFee)} />
          <View style={styles.divider} />
          <BillLine label="Total" value={formatINR(order.total)} bold />
          <BillLine label="Payment" value={`${order.paymentMethod.toUpperCase()} — ${order.paymentStatus.toUpperCase()}`} />
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, spacing.base) }]}>
        {order.status === 'placed' && (
          <>
            <Pressable style={styles.rejectBtn} onPress={() => rejectSheetRef.current?.expand()} disabled={busy}>
              <Text style={styles.rejectBtnText}>Reject</Text>
            </Pressable>
            <Pressable style={styles.acceptBtn} onPress={handleAccept} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.acceptBtnText}>Accept Order</Text>}
            </Pressable>
          </>
        )}
        {ACTION_LABEL[order.status] && (
          <Pressable
            style={[styles.acceptBtn, { flex: 1 }, (busy || packingBlocked) && styles.disabledBtn]}
            onPress={handleAdvance}
            disabled={busy || packingBlocked}
          >
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.acceptBtnText}>{ACTION_LABEL[order.status]}</Text>}
          </Pressable>
        )}
        {order.status === 'packed' && delivery && (
          <View style={styles.readyBar}>
            <Check size={ICON_SIZE.md} color={colors.success} strokeWidth={ICON_STROKE} />
            <Text style={styles.readyText}>Rider assigned — see the Delivery card above</Text>
          </View>
        )}
      </View>

      <AppBottomSheet ref={rejectSheetRef} title="Reject Order" snapPoints={['45%']}>
        <Text style={styles.sheetHint}>A reason is required so this stays auditable.</Text>
        {REJECTION_REASONS.map((r) => (
          <Pressable key={r.key} style={styles.reasonRow} onPress={() => handleReject(r.key)}>
            <Text style={styles.reasonText}>{r.label}</Text>
          </Pressable>
        ))}
      </AppBottomSheet>

      <AppBottomSheet ref={riderSheetRef} title="Choose a Rider" snapPoints={['75%']}>
        <View style={styles.sheetHintRow}>
          <Text style={[styles.sheetHint, { flex: 1, marginBottom: 0 }]}>Tap a free rider to send them this order. They have 5 minutes to accept.</Text>
          <Pressable onPress={loadRiders} hitSlop={8} disabled={ridersLoading}>
            <Text style={styles.refreshLink}>Refresh</Text>
          </Pressable>
        </View>
        <RiderPickerList riders={riders} loading={ridersLoading} error={ridersError} onRetry={loadRiders} busyRiderId={busyRiderId} onPick={handleAssignRider} />
      </AppBottomSheet>

      {delivery && (
        <CancelAssignmentDialog
          visible={cancelOpen}
          riderName={delivery.riderName}
          orderNumber={order.orderNumber}
          deliveryStatus={delivery.status}
          onConfirm={handleConfirmCancel}
          onClose={() => setCancelOpen(false)}
        />
      )}

      <AppBottomSheet ref={packingSheetRef} title="Confirm Packing" snapPoints={['50%']} onDismiss={() => setPackingChecks({ items: false, quantity: false, packaging: false })}>
        <Text style={styles.sheetHint}>Confirm before this order becomes Ready for Pickup.</Text>
        <PackingCheckRow label="Items verified" checked={packingChecks.items} onToggle={() => setPackingChecks((c) => ({ ...c, items: !c.items }))} />
        <PackingCheckRow label="Quantity verified" checked={packingChecks.quantity} onToggle={() => setPackingChecks((c) => ({ ...c, quantity: !c.quantity }))} />
        <PackingCheckRow label="Packaging ready" checked={packingChecks.packaging} onToggle={() => setPackingChecks((c) => ({ ...c, packaging: !c.packaging }))} />
        <Pressable
          style={[styles.assignBtn, !(packingChecks.items && packingChecks.quantity && packingChecks.packaging) && styles.disabledBtn]}
          onPress={confirmPacked}
          disabled={busy || !(packingChecks.items && packingChecks.quantity && packingChecks.packaging)}
        >
          <Text style={styles.assignBtnText}>Mark Ready for Pickup</Text>
        </Pressable>
      </AppBottomSheet>
    </SafeScreen>
  );
}

function PackingCheckRow({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <Pressable style={styles.packingCheckRow} onPress={onToggle}>
      {checked ? (
        <CheckCircle2 size={ICON_SIZE.md} color={colors.success} strokeWidth={ICON_STROKE} />
      ) : (
        <Circle size={ICON_SIZE.md} color={colors.textMuted} strokeWidth={ICON_STROKE} />
      )}
      <Text style={[styles.packingCheckLabel, checked && styles.packingCheckLabelDone]}>{label}</Text>
    </Pressable>
  );
}

function ItemRow({ item, canPick, onPick, onReopen }: { item: StoreOrderItem; canPick: boolean; onPick: (item: StoreOrderItem, status: 'picked' | 'unavailable') => void; onReopen?: (item: StoreOrderItem) => void }) {
  const picked = item.pickingStatus === 'picked';
  const unavailable = item.pickingStatus === 'unavailable';
  return (
    <View style={styles.itemRow}>
      <Pressable
        style={styles.itemCheckArea}
        onPress={() => canPick && !picked && onPick(item, 'picked')}
        disabled={!canPick}
      >
        {picked ? (
          <CheckCircle2 size={ICON_SIZE.md} color={colors.success} strokeWidth={ICON_STROKE} />
        ) : unavailable ? (
          <XCircle size={ICON_SIZE.md} color={colors.error} strokeWidth={ICON_STROKE} />
        ) : (
          <Circle size={ICON_SIZE.md} color={colors.textMuted} strokeWidth={ICON_STROKE} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, (picked || unavailable) && styles.itemNameDone]}>
            {item.productName} <Text style={styles.itemVariant}>{item.variantLabel}</Text>
          </Text>
          <Text style={styles.itemMeta}>Qty {item.quantity} • {formatINR(item.total)}{unavailable ? ' • Unavailable' : ''}</Text>
        </View>
      </Pressable>
      {canPick && !picked && !unavailable && (
        <Pressable style={styles.unavailableBtn} onPress={() => onPick(item, 'unavailable')} hitSlop={6}>
          <Text style={styles.unavailableBtnText}>N/A</Text>
        </Pressable>
      )}
      {unavailable && onReopen && (
        <Pressable style={styles.unavailableBtn} onPress={() => onReopen(item)} hitSlop={6} accessibilityLabel={`Item found: reopen ${item.productName}`}>
          <Text style={styles.unavailableBtnText}>Found it</Text>
        </Pressable>
      )}
    </View>
  );
}

function BillLine({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.billLine}>
      <Text style={[styles.billLabel, bold && styles.billLabelBold]}>{label}</Text>
      <Text style={[styles.billValue, bold && styles.billValueBold]}>{value}</Text>
    </View>
  );
}

function groupByCategory(items: StoreOrderItem[]): Record<string, StoreOrderItem[]> {
  const groups: Record<string, StoreOrderItem[]> = {};
  for (const item of items) {
    const key = item.categoryName ?? 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: colors.textPrimary },
  headerSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  statusPill: { backgroundColor: colors.primaryTint, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  statusPillText: { fontSize: 10, color: colors.primaryDarker, fontFamily: 'PlusJakartaSans_700Bold' },
  content: { paddingHorizontal: spacing.base },
  exceptionBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.errorTint, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md },
  exceptionBannerText: { ...textStyles.bodySmall, color: colors.error, flex: 1 },
  rejectionNotes: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  resolveBtn: { backgroundColor: colors.error, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  resolveBtnText: { fontSize: 11, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md, ...shadows.sm },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  cardTitle: { ...textStyles.cardTitle, color: colors.textPrimary },
  customerName: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold', marginTop: spacing.xs },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  phoneText: { ...textStyles.caption, color: colors.textSecondary },
  addressRow: { flexDirection: 'row', gap: 5, marginTop: 4 },
  addressText: { ...textStyles.caption, color: colors.textSecondary, flex: 1, lineHeight: 17 },
  pickingProgressWrap: { marginTop: spacing.sm, marginBottom: spacing.xs },
  pickingProgressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  pickingProgressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 3 },
  pickingProgressText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 4, fontFamily: 'PlusJakartaSans_600SemiBold' },
  categoryLabel: { fontSize: 10.5, color: colors.textMuted, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 0.6, marginBottom: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  itemCheckArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemName: { ...textStyles.bodySmall, color: colors.textPrimary },
  itemNameDone: { color: colors.textMuted },
  itemVariant: { ...textStyles.caption, color: colors.textSecondary },
  itemMeta: { ...textStyles.caption, color: colors.textMuted, marginTop: 1 },
  unavailableBtn: { borderWidth: 1, borderColor: colors.error, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, marginLeft: spacing.sm },
  unavailableBtnText: { fontSize: 10, color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
  billLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  billLabel: { ...textStyles.bodySmall, color: colors.textSecondary },
  billLabelBold: { color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },
  billValue: { ...textStyles.bodySmall, color: colors.textPrimary },
  billValueBold: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.xs },
  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.base, ...shadows.lg },
  rejectBtn: { flex: 1, height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.error, alignItems: 'center', justifyContent: 'center' },
  rejectBtnText: { ...textStyles.button, color: colors.error, fontSize: 14 },
  acceptBtn: { flex: 2, height: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  acceptBtnText: { ...textStyles.button, color: colors.white, fontSize: 14 },
  disabledBtn: { backgroundColor: colors.textMuted },
  readyBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center', paddingVertical: spacing.sm },
  readyText: { ...textStyles.bodySmall, color: colors.success, fontFamily: 'PlusJakartaSans_600SemiBold' },
  sheetHint: { ...textStyles.caption, color: colors.textSecondary, marginBottom: spacing.md },
  reasonRow: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  reasonText: { ...textStyles.body, color: colors.textPrimary },
  stageText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold', marginTop: spacing.xs },
  assignBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  assignBtnText: { ...textStyles.button, color: colors.white, fontSize: 13 },
  requestTimerRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  requestTimerText: { ...textStyles.caption, color: colors.textSecondary },
  sheetHintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginBottom: spacing.md },
  refreshLink: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  trackLiveBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  trackLiveBtnText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  proofPhoto: { width: '100%', height: 160, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, marginTop: spacing.sm },
  cancelAssignBtn: { marginTop: spacing.md, alignSelf: 'flex-start', borderWidth: 1.5, borderColor: colors.error, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  cancelAssignBtnText: { ...textStyles.caption, color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
  packingCheckRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  packingCheckLabel: { ...textStyles.body, color: colors.textPrimary },
  packingCheckLabelDone: { color: colors.textMuted },
});
