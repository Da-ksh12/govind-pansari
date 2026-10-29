import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Camera, Navigation, Package, Phone, Radio, XCircle } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { SafeScreen } from '../../../components/layout/SafeScreen';
import { AppImage } from '../../../components/ui/AppImage';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatINR } from '../../../components/ui/PriceBlock';
import { riderOpsRepository, type CurrentAssignment, type DeliveryFailureReason, type DeliveryProof } from '../../../services/repositories/riderOpsRepository';
import { riderLocationService } from '../../../services/location/riderLocationService';
import { trackingRepository } from '../../../services/repositories/trackingRepository';
import { useRefetchOnForeground } from '../../../hooks/useRefetchOnForeground';
import { useRiderLocationStatus } from '../../../hooks/useRiderLocationStatus';
import { useKeyboardOverlap } from '../../../hooks/useKeyboardOverlap';
import { actionBarBottomPadding } from '../../../services/keyboardOverlap';
import { LocationSharingNotice } from '../../../components/rider/LocationSharingNotice';
import { captureDeliveryProofPhoto, recoverInterruptedProofPhoto, uploadDeliveryProofPhoto, DeliveryProofError, type ProofPhoto } from '../../../services/storage/deliveryProof';

// section 7: continuous tracking only while genuinely on this leg —
// never while just assigned-and-unaccepted, never once terminal.
const TRACKABLE_STATUSES = new Set(['accepted', 'at_store', 'picked_up', 'in_transit']);

// app/rider/** is new; .expo/types/router.d.ts needs a local `expo
// start` (network access) to regenerate — real, valid route.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const goHome = () => router.replace('/rider' as any);

const FAILURE_REASONS: { key: DeliveryFailureReason; label: string }[] = [
  { key: 'customer_unavailable', label: 'Customer unavailable' },
  { key: 'wrong_address', label: 'Wrong address' },
  { key: 'customer_refused', label: 'Customer refused' },
  { key: 'other', label: 'Other' },
];

export default function RiderDeliveryScreen() {
  const insets = useSafeAreaInsets();
  // The pickup form has a text box low on the screen; edge-to-edge Android does not lift it above the keyboard by itself.
  const keyboard = useKeyboardOverlap();
  const scrollRef = useRef<ScrollView>(null);
  const confirmCardY = useRef(0);
  const [orderInputFocused, setOrderInputFocused] = useState(false);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [delivery, setDelivery] = useState<CurrentAssignment | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [orderNumberInput, setOrderNumberInput] = useState('');
  const [locationTracking, setLocationTracking] = useState(false);
  const { status: locationStatus, now: locationNow } = useRiderLocationStatus();
  const [proofPhoto, setProofPhoto] = useState<ProofPhoto | null>(null);
  const [completedProof, setCompletedProof] = useState<DeliveryProof | null>(null);

  const [error, setError] = useState(false);

  // Derived, not local-only state: mark_order_approaching() writes
  // orders.status, which getDeliveryDetail()/get_rider_dashboard() both
  // now report back as orderStatus — so "has the rider already tapped
  // I've Reached Destination" survives a screen reopen, app
  // kill/reopen, or a second device, instead of forgetting itself the
  // moment this component remounts.
  const reachedDestination = delivery?.orderStatus === 'approaching';

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(false);
    riderOpsRepository
      .getDeliveryDetail(id)
      .then(setDelivery)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  // A fresh photo (and the reached-destination gate ahead of it) is
  // per-delivery — clear any leftover state from a previous screen
  // instance the moment the route param changes.
  useEffect(() => {
    setProofPhoto(null);
  }, [id]);

  // Android can kill the app while the camera is open; the app then restarts and comes back to this screen (app/rider/index.tsx).
  // Ask the picker for the photo it could not deliver, so the rider carries on instead of starting the photo again.
  useEffect(() => {
    if (!id) return;
    let alive = true;
    recoverInterruptedProofPhoto(id)
      .then((recovered) => {
        if (!alive) return;
        if (recovered.status === 'recovered') setProofPhoto(recovered.photo);
        else if (recovered.status === 'lost') Alert.alert('Camera', "The camera closed before your photo came back. Please take the delivery photo again.");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]);

  useFocusEffect(load);

  // With the keyboard up, bring the order-number card to the top of what is left of the screen, so the rider sees what they type.
  useEffect(() => {
    if (!orderInputFocused || keyboard.overlap <= 0) return;
    const timer = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, confirmCardY.current - spacing.md), animated: true }), 60);
    return () => clearTimeout(timer);
  }, [orderInputFocused, keyboard.overlap]);

  // Section 1 (final QA hardening): the rider couldn't see their own
  // past delivery's proof photo at all — history rows weren't even
  // tappable before this. Fetched once the delivery actually reads
  // completed, same "null until it exists" contract
  // storeOpsRepository.getDeliveryProof already uses on the store side.
  useEffect(() => {
    if (!id || delivery?.status !== 'completed') return;
    riderOpsRepository.getDeliveryProof(id).then(setCompletedProof).catch(() => {});
  }, [id, delivery?.status]);

  // Priority 13 (pre-production hardening): live status updates — e.g.
  // a manager cancelling/reassigning this delivery — reuses the same
  // channel the customer tracking screen already subscribes to
  // (delivery_assignments by id), rather than a second subscription
  // mechanism for the same table/row.
  useEffect(() => {
    if (!id) return;
    return trackingRepository.subscribeToDeliveryStatus(id, load);
  }, [id, load]);
  useRefetchOnForeground(load);

  // Start/stop foreground GPS capture as the delivery's own status
  // dictates (section 7) — never left running once terminal (section
  // 37/39: "stop tracking immediately after DELIVERED/FAILED/CANCELLED",
  // "the customer should no longer receive rider location").
  useEffect(() => {
    if (!delivery) return;
    if (TRACKABLE_STATUSES.has(delivery.status)) {
      riderLocationService
        .start((message) => Alert.alert('Location', message))
        .then(() => setLocationTracking(riderLocationService.isTracking()))
        .catch(() => Alert.alert('Location', "Couldn't start location sharing. Please try again."));
    } else {
      riderLocationService.stop();
      setLocationTracking(false);
    }
    return () => {
      // Only stop on unmount if this delivery has actually ended —
      // navigating away mid-delivery (e.g. to check Home) shouldn't
      // silently kill tracking for an order still out for delivery.
      if (!TRACKABLE_STATUSES.has(delivery.status)) riderLocationService.stop();
    };
  }, [delivery?.status]);

  const runAction = async (fn: () => Promise<void>, onDone?: () => void) => {
    setBusy(true);
    try {
      await fn();
      if (onDone) onDone();
      else load();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = () => runAction(() => riderOpsRepository.acceptDelivery(delivery!.assignmentId));
  const handleDecline = () => {
    Alert.alert('Decline this delivery?', 'It will be offered to another rider.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Decline', style: 'destructive', onPress: () => runAction(() => riderOpsRepository.declineDelivery(delivery!.assignmentId), () => goHome()) },
    ]);
  };
  const handleArrived = () => runAction(() => riderOpsRepository.markArrivedAtStore(delivery!.assignmentId));
  const handleConfirmPickup = () => {
    if (orderNumberInput.trim().toUpperCase() !== delivery!.orderNumber.toUpperCase()) {
      Alert.alert('Order number does not match', `Please confirm you have order #${delivery!.orderNumber}.`);
      return;
    }
    runAction(() => riderOpsRepository.markPickedUp(delivery!.assignmentId, orderNumberInput.trim()));
  };
  const handleStartDelivery = () => runAction(() => riderOpsRepository.startDelivery(delivery!.assignmentId));
  const handleMarkApproaching = () => runAction(() => riderOpsRepository.markApproaching(delivery!.orderId));
  const handleCaptureProof = async () => {
    if (!id) return;
    try {
      // `busy` covers the moment between the camera handing the photo back and the shrunk copy being ready.
      const photo = await captureDeliveryProofPhoto(id, () => setBusy(true));
      if (photo) setProofPhoto(photo);
    } catch (e) {
      Alert.alert('Camera', e instanceof DeliveryProofError ? e.message : 'Could not open the camera. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const handleConfirmDelivered = () => {
    if (!proofPhoto) return;
    runAction(async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) throw new Error('Location permission is required to confirm this delivery.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const path = await uploadDeliveryProofPhoto(delivery!.assignmentId, proofPhoto);
      await riderOpsRepository.completeDelivery(delivery!.assignmentId, path, {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    }, () => goHome());
  };
  const handleFail = (reason: DeliveryFailureReason) => {
    runAction(() => riderOpsRepository.failDelivery(delivery!.assignmentId, reason), () => goHome());
  };

  const call = (phone: string) => Linking.openURL(`tel:${phone}`).catch(() => {});
  const navigate = (lat: number | null, lng: number | null) => {
    if (lat == null || lng == null) return;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`).catch(() => {});
  };

  if (loading && !delivery) {
    return (
      <SafeScreen>
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeScreen>
    );
  }
  if (!delivery) {
    return (
      <SafeScreen>
        <EmptyState title="Couldn't load this delivery" subtitle={error ? 'Check your connection and try again.' : "It may no longer exist."} ctaLabel={error ? 'Retry' : undefined} onPressCta={error ? load : undefined} />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen>
      <View ref={keyboard.ref} onLayout={keyboard.onLayout} collapsable={false} style={{ flex: 1, paddingBottom: keyboard.overlap }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>#{delivery.orderNumber}</Text>
          <Text style={styles.headerSubtitle}>{formatINR(delivery.total)} • {delivery.itemCount} items</Text>
        </View>
        {locationTracking && (
          <View style={styles.trackingBadge}>
            <Radio size={11} color={colors.success} strokeWidth={ICON_STROKE} />
            <Text style={styles.trackingBadgeText}>Live</Text>
          </View>
        )}
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {TRACKABLE_STATUSES.has(delivery.status) && (
          <LocationSharingNotice
            sharing={locationTracking && locationStatus.tracking}
            lastSentAt={locationStatus.lastSentAt}
            accuracy={locationStatus.lastAccuracy}
            rejected={locationStatus.lastRejected}
            now={locationNow}
            onRetry={() =>
              riderLocationService
                .start((message) => Alert.alert('Location', message))
                .then(() => setLocationTracking(riderLocationService.isTracking()))
            }
          />
        )}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Package size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.cardTitle}>Pickup</Text>
          </View>
          <Text style={styles.primaryText}>{delivery.storeName}</Text>
          <Text style={styles.secondaryText}>{delivery.storeAddress}</Text>
          <Pressable style={styles.navBtn} onPress={() => navigate(delivery.storeLatitude, delivery.storeLongitude)}>
            <Navigation size={14} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.navBtnText}>Navigate</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Deliver To</Text>
          <Text style={styles.primaryText}>{delivery.recipientName}</Text>
          <Text style={styles.secondaryText}>
            {[delivery.deliveryAddressLine1, delivery.deliveryAddressLine2, delivery.deliveryCity].filter(Boolean).join(', ')}
          </Text>
          {!!delivery.deliveryLandmark && <Text style={styles.secondaryText}>Landmark: {delivery.deliveryLandmark}</Text>}
          {!!delivery.deliveryInstructions && <Text style={[styles.secondaryText, { fontFamily: 'PlusJakartaSans_600SemiBold' }]}>Instructions: {delivery.deliveryInstructions}</Text>}
          <View style={styles.actionRow}>
            <Pressable style={styles.navBtn} onPress={() => call(delivery.recipientPhone)}>
              <Phone size={14} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.navBtnText}>Call Customer</Text>
            </Pressable>
            <Pressable style={styles.navBtn} onPress={() => navigate(delivery.deliveryLatitude, delivery.deliveryLongitude)}>
              <Navigation size={14} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.navBtnText}>Navigate</Text>
            </Pressable>
          </View>
        </View>

        {delivery.status === 'completed' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Delivery Proof</Text>
            {completedProof ? (
              <>
                {completedProof.photoUrl && (
                  <AppImage uri={completedProof.photoUrl} style={styles.proofPreview} contentFit="cover" fallbackIcon={Camera} />
                )}
                <Text style={styles.secondaryText}>
                  Delivered {new Date(completedProof.completedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </Text>
                {completedProof.cashCollected != null && (
                  <Text style={styles.secondaryText}>Cash collected: {formatINR(completedProof.cashCollected)}</Text>
                )}
              </>
            ) : (
              <ActivityIndicator color={colors.primary} />
            )}
          </View>
        )}

        {['failed', 'declined', 'expired', 'cancelled'].includes(delivery.status) && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Delivery Closed</Text>
            <Text style={styles.secondaryText}>
              {delivery.status === 'failed' && 'This delivery could not be completed.'}
              {delivery.status === 'declined' && 'You declined this delivery.'}
              {delivery.status === 'expired' && 'This assignment expired before it was accepted.'}
              {delivery.status === 'cancelled' && 'This delivery was cancelled.'}
            </Text>
          </View>
        )}

        {delivery.status === 'at_store' && (
          <View style={styles.card} onLayout={(e) => { confirmCardY.current = e.nativeEvent.layout.y; }}>
            <Text style={styles.cardTitle}>Confirm Pickup</Text>
            <Text style={styles.secondaryText}>Enter the order number to confirm you have the right package.</Text>
            <TextInput
              style={styles.input}
              placeholder={`e.g. ${delivery.orderNumber}`}
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              value={orderNumberInput}
              onChangeText={setOrderNumberInput}
              onFocus={() => setOrderInputFocused(true)}
              onBlur={() => setOrderInputFocused(false)}
              onSubmitEditing={() => {
                if (orderNumberInput.trim() && !busy) handleConfirmPickup();
              }}
            />
          </View>
        )}

        {delivery.status === 'in_transit' && !reachedDestination && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>At the Delivery Location?</Text>
            <Text style={styles.secondaryText}>
              Once you've arrived, tap "I've Reached Destination" below to let the customer know — then confirm delivery with a photo.
            </Text>
          </View>
        )}

        {delivery.status === 'in_transit' && reachedDestination && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Delivery Photo Proof</Text>
            <Text style={styles.secondaryText}>
              A photo of the delivered package is required to complete this delivery.
            </Text>
            {proofPhoto && (
              <>
                <Image source={{ uri: proofPhoto.uri }} style={styles.proofPreview} contentFit="cover" />
                <Pressable style={styles.navBtn} onPress={handleCaptureProof} disabled={busy}>
                  <Camera size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.navBtnText}>Retake Photo</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {delivery.status === 'in_transit' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Delivery Issue?</Text>
            <View style={styles.failGrid}>
              {FAILURE_REASONS.map((r) => (
                <Pressable key={r.key} style={styles.failChip} onPress={() => handleFail(r.key)} disabled={busy}>
                  <XCircle size={13} color={colors.error} strokeWidth={ICON_STROKE} />
                  <Text style={styles.failChipText}>{r.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={[styles.actionBar, { paddingBottom: actionBarBottomPadding(keyboard.overlap, insets.bottom, spacing.base) }]}>
        {delivery.status === 'assigned' && (
          <>
            <Pressable style={styles.declineBtn} onPress={handleDecline} disabled={busy}>
              <Text style={styles.declineBtnText}>Decline</Text>
            </Pressable>
            <Pressable style={styles.primaryBtn} onPress={handleAccept} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>Accept Delivery</Text>}
            </Pressable>
          </>
        )}
        {delivery.status === 'accepted' && (
          <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={handleArrived} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>Arrived at Store</Text>}
          </Pressable>
        )}
        {delivery.status === 'at_store' && (
          <Pressable style={[styles.primaryBtn, { flex: 1 }, !orderNumberInput.trim() && styles.disabledBtn]} onPress={handleConfirmPickup} disabled={busy || !orderNumberInput.trim()}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>Confirm Pickup</Text>}
          </Pressable>
        )}
        {delivery.status === 'picked_up' && (
          <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={handleStartDelivery} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>Start Delivery</Text>}
          </Pressable>
        )}
        {delivery.status === 'in_transit' && !reachedDestination && (
          <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={handleMarkApproaching} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>I've Reached Destination</Text>}
          </Pressable>
        )}
        {delivery.status === 'in_transit' && reachedDestination && !proofPhoto && (
          <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={handleCaptureProof} disabled={busy}>
            <Camera size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
            <Text style={styles.primaryBtnText}>Take Delivery Photo</Text>
          </Pressable>
        )}
        {delivery.status === 'in_transit' && reachedDestination && proofPhoto && (
          <Pressable style={[styles.primaryBtn, { flex: 1 }]} onPress={handleConfirmDelivered} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryBtnText}>Confirm Delivery</Text>}
          </Pressable>
        )}
        {['completed', 'failed', 'declined', 'expired', 'cancelled'].includes(delivery.status) && (
          <Text style={styles.doneText}>This delivery is closed.</Text>
        )}
      </View>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: colors.textPrimary },
  headerSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  trackingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.successTint, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  trackingBadgeText: { fontSize: 10, color: colors.success, fontFamily: 'PlusJakartaSans_700Bold' },
  content: { paddingHorizontal: spacing.base },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md, ...shadows.sm },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  cardTitle: { ...textStyles.cardTitle, color: colors.textPrimary },
  primaryText: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold', marginTop: spacing.xs },
  secondaryText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginTop: spacing.sm, alignSelf: 'flex-start' },
  navBtnText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.base, height: 48, ...textStyles.body, color: colors.textPrimary, marginTop: spacing.sm },
  failGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  failChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: colors.error, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  failChipText: { fontSize: 11, color: colors.error, fontFamily: 'PlusJakartaSans_600SemiBold' },
  actionBar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.base, ...shadows.lg },
  declineBtn: { flex: 1, height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.error, alignItems: 'center', justifyContent: 'center' },
  declineBtnText: { ...textStyles.button, color: colors.error, fontSize: 14 },
  primaryBtn: { flex: 2, height: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  primaryBtnText: { ...textStyles.button, color: colors.white, fontSize: 14 },
  disabledBtn: { backgroundColor: colors.textMuted },
  doneText: { flex: 1, textAlign: 'center', ...textStyles.bodySmall, color: colors.textSecondary, paddingVertical: spacing.sm },
  proofPreview: { width: '100%', height: 180, borderRadius: radius.sm, marginTop: spacing.sm, backgroundColor: colors.surfaceMuted },
});
