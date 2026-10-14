import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { AlertTriangle, ArrowLeft, CheckCircle2, Headset, Locate, PackageSearch, WifiOff } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { OrderTimeline } from '../../components/tracking/OrderTimeline';
import { LiveRiderCard } from '../../components/tracking/LiveRiderCard';
import { RiderJourneyStrip, type JourneyStage } from '../../components/tracking/RiderJourneyStrip';
import { LiveTrackingMap } from '../../components/tracking/LiveTrackingMap';
import type { LiveTrackingMapRef, LngLatBoundsTuple } from '../../components/tracking/LiveTrackingMap.types';
import { useSmoothedHeading, useSmoothedPosition } from '../../hooks/useSmoothedPosition';
import { useLiveRoute, formatEta } from '../../hooks/useLiveRoute';
import { trackingRepository, type DeliveryTracking, type LiveLocation } from '../../services/repositories/trackingRepository';
import { notificationRepository } from '../../services/repositories/notificationRepository';
import type { LatLng } from '../../types/models';

// section 44: 60-120s window before a location reading counts as stale.
const STALE_MS = 90_000;
// section46: a periodic safety-net refetch so a missed Realtime event (or a
// silent reconnect) never leaves the screen showing an out-of-date delivery
// stage indefinitely.
const SAFETY_REFRESH_MS = 25_000;

const DELIVERY_HEADLINE: Record<string, string> = {
  assigned: 'Rider assigned — waiting for pickup',
  accepted: 'Rider is heading to the store',
  at_store: 'Rider has arrived at the store',
  picked_up: 'Rider has your order',
  in_transit: 'On the way to you',
};

const LIVE_LOCATION_STAGES = new Set(['accepted', 'at_store', 'picked_up', 'in_transit']);
const ROUTE_TO_STORE_STAGES = new Set(['assigned', 'accepted']);
const ROUTE_TO_CUSTOMER_STAGES = new Set(['picked_up', 'in_transit']);
const TERMINAL_DELIVERY_STATUSES = new Set(['completed', 'failed', 'declined', 'expired', 'cancelled']);

function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

function boundsOf(points: LatLng[]): LngLatBoundsTuple | null {
  if (points.length === 0) return null;
  let west = points[0].lng;
  let east = points[0].lng;
  let south = points[0].lat;
  let north = points[0].lat;
  for (const p of points) {
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
  }
  // A single-point (or near-identical) bounds collapses to zero size —
  // pad it so fitBounds doesn't zoom in to a meaningless street-level crop.
  const pad = 0.004;
  if (east - west < pad) {
    west -= pad;
    east += pad;
  }
  if (north - south < pad) {
    south -= pad;
    north += pad;
  }
  return [west, south, east, north];
}

export default function TrackOrderScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<LiveTrackingMapRef>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const hasAutoFitted = useRef(false);
  const followRider = useRef(true);
  const notifiedArrivingRef = useRef(false);

  const [tracking, setTracking] = useState<DeliveryTracking | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<string | null>(null);
  const [liveLocation, setLiveLocation] = useState<LiveLocation | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [, forceTick] = useState(0);

  const refetch = useCallback(async () => {
    if (!orderId) return;
    try {
      const data = await trackingRepository.getTracking(orderId);
      setTracking(data);
      setDeliveryStatus(data.deliveryStatus);
      if (data.currentLocation) setLiveLocation(data.currentLocation);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    hasAutoFitted.current = false;
    notifiedArrivingRef.current = false;
    followRider.current = true;
    setTracking(null);
    setDeliveryStatus(null);
    setLiveLocation(null);
    setLoading(true);
    refetch();
  }, [refetch]);

  const isTerminal = deliveryStatus != null && TERMINAL_DELIVERY_STATUSES.has(deliveryStatus);
  const isDelivered = tracking?.orderStatus === 'delivered';
  const isCancelled = tracking?.orderStatus === 'cancelled';
  const isFailed = deliveryStatus === 'failed' || deliveryStatus === 'declined' || deliveryStatus === 'expired';
  const isLivePhase = !!tracking?.deliveryId && !isDelivered && !isCancelled && !(isTerminal && isFailed);

  // Realtime subscriptions — only while there's an active delivery leg to
  // watch, and torn down the moment that stops being true (section 65):
  // privacy requires tracking to stop, not just the UI to hide it.
  useEffect(() => {
    if (!tracking?.deliveryId || !isLivePhase) return;
    const unsubLocation = trackingRepository.subscribeToLocation(tracking.deliveryId, (loc) => setLiveLocation(loc));
    const unsubStatus = trackingRepository.subscribeToDeliveryStatus(tracking.deliveryId, (status) => {
      setDeliveryStatus(status);
      refetch(); // pick up whatever else changed alongside the status (e.g. deliveredAt)
    });
    // orders.status (e.g. 'approaching', from the rider's "I've Reached
    // Destination") changes independently of delivery_assignments, so it
    // needs its own feed — see subscribeToOrderStatus's own comment.
    const unsubOrderStatus = trackingRepository.subscribeToOrderStatus(tracking.orderId, refetch);
    return () => {
      unsubLocation();
      unsubStatus();
      unsubOrderStatus();
    };
  }, [tracking?.deliveryId, tracking?.orderId, isLivePhase, refetch]);

  // section 46: re-sync on app foreground (Realtime sockets suspend in the
  // background) and on a periodic safety-net timer, rather than trusting
  // missed-event delivery alone.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  useEffect(() => {
    if (!isLivePhase) return;
    const interval = setInterval(refetch, SAFETY_REFRESH_MS);
    return () => clearInterval(interval);
  }, [isLivePhase, refetch]);

  // Forces a re-render every 15s purely so the staleness check below
  // (derived from Date.now() at render time) keeps advancing even when no
  // new event has arrived to trigger a render on its own.
  useEffect(() => {
    const interval = setInterval(() => forceTick((t) => t + 1), 15_000);
    return () => clearInterval(interval);
  }, []);

  const hasFreshLocation = deliveryStatus != null && LIVE_LOCATION_STAGES.has(deliveryStatus) && !!liveLocation;
  const isStale = hasFreshLocation && Date.now() - new Date(liveLocation!.recordedAt).getTime() > STALE_MS;

  const riderPos: LatLng | null = hasFreshLocation ? { lat: liveLocation!.latitude, lng: liveLocation!.longitude } : null;
  const smoothedRiderPos = useSmoothedPosition(riderPos);
  const smoothedHeading = useSmoothedHeading(liveLocation?.heading ?? null);

  const storePos: LatLng | null =
    tracking?.storeLatitude != null && tracking?.storeLongitude != null
      ? { lat: tracking.storeLatitude, lng: tracking.storeLongitude }
      : null;
  const destPos: LatLng | null =
    tracking?.destinationLatitude != null && tracking?.destinationLongitude != null
      ? { lat: tracking.destinationLatitude, lng: tracking.destinationLongitude }
      : null;

  const routeDestination = deliveryStatus != null
    ? ROUTE_TO_STORE_STAGES.has(deliveryStatus)
      ? storePos
      : ROUTE_TO_CUSTOMER_STAGES.has(deliveryStatus)
        ? destPos
        : null
    : null;
  const { route, unavailable: routeUnavailable } = useLiveRoute(riderPos, routeDestination);

  // Section 47: notify once, the moment ETA first crosses the
  // arriving-soon threshold. The signal genuinely originates here
  // (Phase 09's client-side routing has no server equivalent), but the
  // decision/dedup/send still goes through the same NotificationService
  // path (notify_arriving_soon dedupes on delivery_assignments.id) — a
  // client bug re-firing this effect still sends at most one push.
  useEffect(() => {
    if (!route || deliveryStatus !== 'in_transit' || notifiedArrivingRef.current) return;
    if (route.durationSeconds / 60 > 5) return;
    notifiedArrivingRef.current = true;
    notificationRepository.notifyArrivingSoon(tracking!.orderId).catch(() => {});
  }, [route, deliveryStatus, tracking]);

  // Initial camera fit once we know enough points; recenter button re-fits
  // on demand afterwards, but ordinary position updates never yank the
  // camera back once the customer has panned (section 34).
  useEffect(() => {
    if (hasAutoFitted.current || !isLivePhase) return;
    const points = [storePos, destPos, smoothedRiderPos].filter((p): p is LatLng => !!p);
    const bounds = boundsOf(points);
    if (!bounds) return;
    hasAutoFitted.current = true;
    cameraRef.current?.fitBounds(bounds, { padding: { top: 140, left: 60, right: 60, bottom: 280 }, duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLivePhase, !!storePos, !!destPos, !!smoothedRiderPos]);

  const handleRecenter = () => {
    const points = [storePos, destPos, smoothedRiderPos].filter((p): p is LatLng => !!p);
    const bounds = boundsOf(points);
    if (!bounds) return;
    followRider.current = true;
    cameraRef.current?.fitBounds(bounds, { padding: { top: 140, left: 60, right: 60, bottom: 280 }, duration: 700 });
  };

  if (loading) {
    return (
      <SafeScreen>
        <View style={styles.loadingHeader}>
          <Skeleton width={40} height={40} borderRadius={20} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="60%" height={16} />
            <Skeleton width="40%" height={12} />
          </View>
        </View>
        <View style={{ paddingHorizontal: spacing.base, gap: spacing.md }}>
          <Skeleton height={220} borderRadius={radius.lg} />
          <Skeleton height={100} borderRadius={radius.lg} />
        </View>
      </SafeScreen>
    );
  }

  if (loadFailed || !tracking) {
    return (
      <SafeScreen>
        <ScreenHeader title="Order Tracking" onBack={() => router.back()} />
        <EmptyState
          icon={WifiOff}
          title="Couldn't load tracking"
          subtitle="Check your connection and try again."
          ctaLabel="Retry"
          onPressCta={() => {
            setLoading(true);
            refetch();
          }}
        />
      </SafeScreen>
    );
  }

  if (!isLivePhase) {
    const finished = isDelivered || isCancelled || isFailed;
    return (
      <SafeScreen>
        <ScreenHeader title="Order Tracking" subtitle={`Order #${tracking.orderNumber}`} onBack={() => router.back()} />
        <ScrollView contentContainerStyle={styles.staticContent} showsVerticalScrollIndicator={false}>
          {finished ? (
            <EmptyState
              icon={isDelivered ? CheckCircle2 : AlertTriangle}
              title={isDelivered ? 'Delivered' : isCancelled ? 'Order cancelled' : 'Delivery unsuccessful'}
              subtitle={isDelivered ? 'We hope you enjoyed your order.' : 'View your order for more details.'}
            />
          ) : (
            <EmptyState
              icon={PackageSearch}
              title="Tracking will start soon"
              subtitle="We'll show live rider location here once a rider is on the way with your order."
            />
          )}
          <View style={styles.section}>
            <Text style={styles.cardTitle}>Order Status</Text>
            <OrderTimeline status={tracking.orderStatus} />
          </View>
          <Pressable style={styles.viewOrderBtn} onPress={() => router.push(`/order/${tracking.orderId}`)}>
            <Text style={styles.viewOrderText}>View Order</Text>
          </Pressable>
        </ScrollView>
      </SafeScreen>
    );
  }

  // tracking.orderStatus (orders.status, already mapped to 'arriving' for
  // the DB's 'approaching') carries the "reached destination" signal —
  // deliveryStatus (delivery_assignments.status) stays 'in_transit'
  // throughout, so it alone can never show this stage.
  const hasReachedDestination = tracking.orderStatus === 'arriving';
  const headline = hasReachedDestination
    ? "Your rider has reached your destination!"
    : deliveryStatus
      ? (DELIVERY_HEADLINE[deliveryStatus] ?? 'Tracking your order')
      : 'Tracking your order';
  const etaLabel = route ? formatEta(route.durationSeconds) : null;
  const distanceLabel = route ? formatDistance(route.distanceMeters) : null;
  const journeyStage: JourneyStage = hasReachedDestination ? 'arriving' : ((deliveryStatus as JourneyStage) ?? 'assigned');

  return (
    <SafeScreen edges={[]}>
      <View style={styles.mapWrap}>
        <LiveTrackingMap
          ref={cameraRef}
          storePos={storePos}
          destPos={destPos}
          riderPos={smoothedRiderPos}
          heading={smoothedHeading}
          stale={isStale}
          arrived={hasReachedDestination}
          route={route}
          initialCenter={storePos}
        />

        <ScreenHeader
          title="Order Tracking"
          subtitle={`Order #${tracking.orderNumber}`}
          onBack={() => router.back()}
          floating
          topInset={insets.top}
        />

        <Pressable style={[styles.recenterBtn, { top: insets.top + 60 }]} onPress={handleRecenter}>
          <Locate size={ICON_SIZE.sm} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>

        {deliveryStatus != null && LIVE_LOCATION_STAGES.has(deliveryStatus) && !liveLocation && (
          <View style={[styles.banner, { top: insets.top + 60 }]}>
            <Text style={styles.bannerText}>Waiting for the rider's GPS signal…</Text>
          </View>
        )}
        {isStale && (
          <View style={[styles.banner, { top: insets.top + 60 }]}>
            <Text style={styles.bannerText}>Updating rider location…</Text>
          </View>
        )}
        {!isStale && liveLocation && routeUnavailable && (
          <View style={[styles.banner, { top: insets.top + 60 }]}>
            <Text style={styles.bannerText}>Route temporarily unavailable</Text>
          </View>
        )}
      </View>

      <BottomSheet ref={sheetRef} index={0} snapPoints={['30%', '58%']} enablePanDownToClose={false} handleIndicatorStyle={styles.sheetHandle} backgroundStyle={styles.sheetBackground}>
        <BottomSheetScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          <LiveRiderCard
            riderName={tracking.riderName ?? 'Your rider'}
            vehicleType={tracking.vehicleType}
            headline={headline}
            etaLabel={etaLabel}
            distanceLabel={distanceLabel}
          />

          <View style={styles.journeyCard}>
            <RiderJourneyStrip stage={journeyStage} />
          </View>

          <View style={styles.section}>
            <Text style={styles.cardTitle}>Order Status</Text>
            <OrderTimeline status={tracking.orderStatus} />
          </View>

          <Pressable style={styles.viewOrderBtn} onPress={() => router.push(`/order/${tracking.orderId}`)}>
            <Text style={styles.viewOrderText}>View Order</Text>
          </Pressable>
          <View style={{ height: spacing.lg }} />
        </BottomSheetScrollView>
      </BottomSheet>
    </SafeScreen>
  );
}

function ScreenHeader({
  title,
  subtitle,
  onBack,
  floating,
  topInset,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  floating?: boolean;
  topInset?: number;
}) {
  return (
    <View style={[styles.headerRow, floating && [styles.headerFloating, { top: (topInset ?? 44) + spacing.sm }]]}>
      <Pressable style={styles.circleButton} onPress={onBack}>
        <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
      </Pressable>
      <View style={styles.headerTitles}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
      </View>
      <Pressable style={styles.supportBtn} onPress={() => router.push('/help')}>
        <Headset size={ICON_SIZE.sm} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: { flex: 1 },
  map: { flex: 1 },
  loadingHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.base },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  headerFloating: {
    position: 'absolute',
    left: spacing.base,
    right: spacing.base,
    paddingVertical: 0,
  },
  circleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  headerTitles: { flex: 1 },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 17, color: colors.textPrimary },
  headerSubtitle: { ...textStyles.caption, color: colors.textSecondary },
  supportBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  recenterBtn: {
    position: 'absolute',
    right: spacing.base,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  banner: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
    ...shadows.sm,
  },
  bannerText: { ...textStyles.caption, color: colors.white, fontFamily: 'PlusJakartaSans_600SemiBold' },
  journeyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.base, ...shadows.sm },
  sheetHandle: { backgroundColor: colors.border, width: 40 },
  sheetBackground: { backgroundColor: colors.background, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl },
  sheetContent: { paddingHorizontal: spacing.base, paddingTop: spacing.sm, gap: spacing.lg },
  staticContent: { paddingHorizontal: spacing.base, paddingBottom: spacing.xxl, gap: spacing.lg },
  section: { gap: spacing.sm },
  cardTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  viewOrderBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewOrderText: { ...textStyles.button, color: colors.white, fontSize: 15 },
});
