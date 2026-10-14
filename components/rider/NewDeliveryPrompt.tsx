import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Bike, IndianRupee, MapPin, Navigation, Package, X } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { useAuthStore } from '../../store/authStore';
import { useNotificationsStore } from '../../store/notificationsStore';
import { riderOpsRepository, type CurrentAssignment, type DeliveryOfferDetail } from '../../services/repositories/riderOpsRepository';
import { startUrgentVibration } from '../../services/notifications/alertVibration';
import { useRefetchOnForeground } from '../../hooks/useRefetchOnForeground';

/**
 * The "must respond" new-delivery screen real driver apps (Uber/
 * Swiggy/Zomato, and by extension Zepto/Blinkit) use — a light toast
 * is too easy to miss when the phone's in a rider's pocket. Global,
 * rider-only, mounted at the root so it fires no matter which screen
 * the rider is currently on.
 *
 * Final Dispatch pass: this now handles TWO distinct real-time event
 * types, normalized into one shared display shape:
 *  - `delivery_assigned` — the older single-candidate flow (a manager's
 *    manual pick or the old single-best auto-assign). Still fully real
 *    and still used — this prompt doesn't replace that path.
 *  - `delivery_offer` — the new multi-rider dispatch round. Distinct
 *    from an assignment: this rider hasn't won anything yet, they're
 *    one of possibly several being asked, so Accept can genuinely fail
 *    with ALREADY_TAKEN, and the offer can flip to LOST out from under
 *    them in real time while this is on screen (handled below).
 *
 * Shows a REAL countdown against the backend's own server expiry —
 * never an invented client-side timer.
 */
type PromptData = {
  kind: 'assignment' | 'offer';
  id: string;
  orderNumber: string;
  itemCount: number;
  total: number;
  storeName: string;
  distanceMeters: number | null;
  expiresAt: string | null;
};

function fromAssignment(a: CurrentAssignment): PromptData {
  return { kind: 'assignment', id: a.assignmentId, orderNumber: a.orderNumber, itemCount: a.itemCount, total: a.total, storeName: a.storeName, distanceMeters: null, expiresAt: a.expiresAt };
}
function fromOffer(o: DeliveryOfferDetail): PromptData {
  return { kind: 'offer', id: o.offerId, orderNumber: o.orderNumber, itemCount: o.itemCount, total: o.total, storeName: o.storeName, distanceMeters: o.distanceMeters, expiresAt: o.expiresAt };
}
function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function NewDeliveryPrompt() {
  const role = useAuthStore((s) => s.profile?.role);
  const incoming = useNotificationsStore((s) => s.incoming);
  const dismissIncoming = useNotificationsStore((s) => s.dismissIncoming);
  const markRead = useNotificationsStore((s) => s.markRead);

  const [data, setData] = useState<PromptData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [lostMessage, setLostMessage] = useState<string | null>(null);

  const isRider = role === 'rider';
  const offerId = isRider && incoming?.eventType === 'delivery_offer' ? incoming.data.offerId : null;
  const deliveryId = isRider && incoming?.eventType === 'delivery_assigned' ? incoming.data.deliveryId : null;

  const close = () => {
    if (incoming) markRead(incoming.id);
    dismissIncoming();
    setData(null);
    setLostMessage(null);
  };

  useEffect(() => {
    if (!offerId && !deliveryId) {
      setData(null);
      setLostMessage(null);
      return;
    }
    // Keeps buzzing — a phone-call-style ring, not a single tap — for
    // as long as this prompt sits unanswered. Stops the moment the
    // rider accepts, declines, or dismisses it (effect cleanup below).
    const stopVibration = startUrgentVibration();
    setLoading(true);
    const fetcher = offerId
      ? riderOpsRepository.getOfferDetail(offerId).then((o) => (o ? fromOffer(o) : null))
      : riderOpsRepository.getDeliveryDetail(deliveryId!).then((a) => (a ? fromAssignment(a) : null));
    fetcher.then(setData).catch(() => setData(null)).finally(() => setLoading(false));
    return stopVibration;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerId, deliveryId]);

  // Section 15/16 — the instant ANOTHER rider wins this exact offer (or
  // it simply times out), this rider's own delivery_offers row flips
  // OPEN -> LOST/EXPIRED. RLS already scopes the subscription to their
  // own row. Never leave a dead "Accept" button sitting on screen for
  // a delivery that's already gone to someone else. Keyed off `data`
  // (not the raw incoming-derived `offerId`) so this also covers an
  // offer discovered via the cold-start fallback below, not just one
  // that arrived while this prompt was already watching Realtime.
  useEffect(() => {
    if (!data || data.kind !== 'offer') return;
    const id = data.id;
    return riderOpsRepository.subscribeToOffer(id, () => {
      riderOpsRepository
        .getOfferDetail(id)
        .then((o) => {
          if (o && o.status !== 'open') {
            setLostMessage(o.status === 'lost' ? 'This delivery was accepted by another rider.' : 'This offer has expired.');
          }
        })
        .catch(() => {});
    });
  }, [data?.kind, data?.id]);

  useEffect(() => {
    if (!lostMessage) return;
    const t = setTimeout(close, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lostMessage]);

  // Cold-start / background-reconnect fallback (section 13) — don't
  // override an event already actively driving the prompt.
  const checkForOpenOffer = useCallback(() => {
    if (!isRider || offerId || deliveryId || data) return;
    riderOpsRepository.getMyOpenOffer().then((o) => {
      if (o) setData(fromOffer(o));
    }).catch(() => {});
  }, [isRider, offerId, deliveryId, data]);
  useEffect(() => {
    checkForOpenOffer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRider]);
  useRefetchOnForeground(checkForOpenOffer);

  useEffect(() => {
    const expiresAt = data?.expiresAt;
    if (!expiresAt) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [data?.expiresAt]);

  const handleAccept = async () => {
    if (!data) return;
    setBusy(true);
    try {
      if (data.kind === 'offer') {
        // The server, not this call site, decides who wins (section
        // 6/39/40) — a typed {success:false, code:'ALREADY_TAKEN'} is
        // an expected outcome here, not an error to throw past.
        const result = await riderOpsRepository.acceptDeliveryOffer(data.id);
        if (!result.success) {
          setLostMessage(result.message ?? 'This delivery is no longer available.');
          setBusy(false);
          return;
        }
        close();
        router.push(`/rider/delivery/${result.assignmentId}` as never);
      } else {
        await riderOpsRepository.acceptDelivery(data.id);
        close();
        router.push(`/rider/delivery/${data.id}` as never);
      }
    } catch {
      // Someone else may have taken it, or it expired — just close;
      // the rider's own dashboard reflects real state on next refresh.
      close();
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (!data) return;
    setBusy(true);
    try {
      if (data.kind === 'offer') await riderOpsRepository.declineDeliveryOffer(data.id);
      else await riderOpsRepository.declineDelivery(data.id);
    } catch {
      // Already reassigned/expired — fine, closing either way.
    } finally {
      setBusy(false);
      close();
    }
  };

  const visible = loading || !!data || !!lostMessage;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          {lostMessage ? (
            <View style={styles.lostBlock}>
              <Text style={styles.lostText}>{lostMessage}</Text>
            </View>
          ) : loading || !data ? (
            <View style={styles.loadingBlock}>
              <ActivityIndicator color={colors.white} />
            </View>
          ) : (
            <>
              <Pressable style={styles.closeBtn} onPress={close} hitSlop={10}>
                <X size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
              </Pressable>

              <View style={styles.iconCircle}>
                <Bike size={ICON_SIZE.xxl} color={colors.white} strokeWidth={ICON_STROKE} />
              </View>
              <Text style={styles.title}>New Delivery</Text>
              {secondsLeft !== null && (
                <View style={styles.timerPill}>
                  <Text style={styles.timerText}>{Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} to respond</Text>
                </View>
              )}

              <View style={styles.detailCard}>
                <View style={styles.detailRow}>
                  <MapPin size={ICON_SIZE.sm} color={colors.gold} strokeWidth={ICON_STROKE} />
                  <Text style={styles.detailText} numberOfLines={1}>{data.storeName}</Text>
                </View>
                <View style={styles.detailRow}>
                  <Package size={ICON_SIZE.sm} color={colors.gold} strokeWidth={ICON_STROKE} />
                  <Text style={styles.detailText}>{data.itemCount} item{data.itemCount === 1 ? '' : 's'} • Order #{data.orderNumber}</Text>
                </View>
                <View style={styles.detailRow}>
                  <IndianRupee size={ICON_SIZE.sm} color={colors.gold} strokeWidth={ICON_STROKE} />
                  <Text style={styles.detailText}>₹{data.total.toFixed(0)} order value</Text>
                </View>
                {data.distanceMeters != null && (
                  <View style={styles.detailRow}>
                    <Navigation size={ICON_SIZE.sm} color={colors.gold} strokeWidth={ICON_STROKE} />
                    <Text style={styles.detailText}>Approx. {formatDistance(data.distanceMeters)} away</Text>
                  </View>
                )}
              </View>

              <View style={styles.actions}>
                <Pressable style={styles.declineBtn} onPress={handleDecline} disabled={busy}>
                  <Text style={styles.declineBtnText}>Decline</Text>
                </Pressable>
                <Pressable style={styles.acceptBtn} onPress={handleAccept} disabled={busy}>
                  {busy ? <ActivityIndicator color={colors.primaryDarker} /> : <Text style={styles.acceptBtnText}>Accept Delivery</Text>}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,10,8,0.55)' },
  card: {
    backgroundColor: colors.primaryDarker, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing.xl, paddingTop: spacing.xxl, alignItems: 'center', ...shadows.lg,
  },
  loadingBlock: { height: 220, alignItems: 'center', justifyContent: 'center' },
  lostBlock: { height: 160, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  lostText: { ...textStyles.body, color: colors.white, textAlign: 'center' },
  closeBtn: { position: 'absolute', top: spacing.md, right: spacing.md, padding: spacing.xs },
  iconCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: colors.white, textAlign: 'center' },
  timerPill: { marginTop: spacing.sm, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  timerText: { ...textStyles.caption, color: colors.gold, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13 },
  detailCard: { width: '100%', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: radius.md, padding: spacing.lg, marginTop: spacing.xl, gap: spacing.md },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  detailText: { ...textStyles.bodySmall, color: colors.white, flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl, width: '100%' },
  declineBtn: { flex: 1, height: 54, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
  declineBtnText: { ...textStyles.button, color: colors.white, fontSize: 15 },
  acceptBtn: { flex: 2, height: 54, borderRadius: radius.md, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center' },
  acceptBtnText: { ...textStyles.button, color: colors.primaryDarker, fontSize: 15, fontFamily: 'PlusJakartaSans_700Bold' },
});
