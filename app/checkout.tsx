import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  LocateFixed,
  MapPin,
  Package,
  ShieldCheck,
  X,
} from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { AppImage } from '../components/ui/AppImage';
import { EmptyState } from '../components/ui/EmptyState';
import { GPErrorModal } from '../components/ui/modals/GPModal';
import { BrandedLoader } from '../components/ui/BrandedLoader';
import { PaymentMethodRow } from '../components/checkout/PaymentMethodRow';
import { AnimatedPressable } from '../components/motion/AnimatedPressable';
import { formatINR } from '../components/ui/PriceBlock';
import { useCartLines } from '../hooks/useCartLines';
import { useCartStore } from '../store/cartStore';
import { useOrdersStore } from '../store/ordersStore';
import { useAuthStore } from '../store/authStore';
import { addressRepository } from '../services/repositories/addressRepository';
import { checkoutRepository, type CheckoutSummaryResult, type PaymentMethod } from '../services/repositories/checkoutRepository';
import { orderRepository } from '../services/repositories/orderRepository';
import { storeRepository } from '../services/repositories/storeRepository';
import { locationService } from '../services/location/locationService';
import { geocodingService } from '../services/location/geocodingService';
import { openRazorpayCheckout } from '../services/payments/razorpayCheckout';
import { RazorpayCheckoutCancelledError } from '../services/payments/razorpayCheckout.types';
import type { Address, LatLng, PaymentInfo } from '../types/models';

interface DetectedLocation {
  label: string;
  addressLine: string;
  city?: string;
  state?: string;
  postalCode?: string;
  position: LatLng;
  serviceable: boolean;
}

/** Cheap equirectangular approximation — good enough to decide "is this
 * basically the same spot as the address already selected", not for
 * anything billed or routed (real distance calc stays server-side). */
function roughDistanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = dLng * Math.cos(meanLat);
  return Math.sqrt(dLat * dLat + x * x) * R;
}

const STEPS = [
  { key: 'address', label: 'Address', icon: MapPin },
  { key: 'delivery', label: 'Delivery', icon: Package },
  { key: 'payment', label: 'Payment', icon: ShieldCheck },
  { key: 'review', label: 'Review', icon: Check },
] as const;

const GATEWAY_METHODS: PaymentInfo['method'][] = [];

const PAYMENT_METHOD_LABEL: Record<PaymentInfo['method'], string> = {
  cod: 'Cash on Delivery',
  upi: 'Pay via UPI',
  card: 'Pay by Card',
  netbanking: 'Pay via Net Banking',
  wallet: 'Pay via Wallet',
};

export default function CheckoutScreen() {
  const insets = useSafeAreaInsets();
  const { lines, totalCount } = useCartLines();
  const setQuantity = useCartStore((s) => s.setQuantity);
  const clearCartLocal = useCartStore((s) => s.clearLocal);
  const addOrder = useOrdersStore((s) => s.addOrder);
  const profile = useAuthStore((s) => s.profile);

  const [paymentMethod, setPaymentMethod] = useState<PaymentInfo['method']>('cod');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CheckoutSummaryResult | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [placing, setPlacing] = useState(false);

  // Real checkout-state tracking (section 8-9 of the hardening brief) —
  // these drive the progress stepper and must only ever flip to true
  // once the thing they claim actually happened, never merely because
  // the screen loaded successfully.
  const [gatewayPaymentConfirmed, setGatewayPaymentConfirmed] = useState(false);
  const [gatewayPaymentFailed, setGatewayPaymentFailed] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const [paymentFailureModal, setPaymentFailureModal] = useState<{ message: string } | null>(null);
  const [genericErrorModal, setGenericErrorModal] = useState<{ message: string } | null>(null);

  // Auto-detected current location (client request: "auto-fetch current
  // location, no need to change it at checkout, but let me confirm/
  // override"). Purely a suggestion banner — detection runs once, silently,
  // and never blocks or replaces the selected address on its own; the
  // customer has to tap "Deliver Here" to actually apply it. Getting no
  // fix at all (permission denied, GPS off, geocoder unavailable) just
  // means the banner never appears — checkout proceeds exactly as before,
  // using the saved default address.
  const [detectedLocation, setDetectedLocation] = useState<DetectedLocation | null>(null);
  const [applyingDetected, setApplyingDetected] = useState(false);
  const [detectedAppliedId, setDetectedAppliedId] = useState<string | null>(null);

  // A different payment method is a fresh attempt — any earlier
  // gateway outcome no longer applies to what's selected now.
  useEffect(() => {
    setGatewayPaymentConfirmed(false);
    setGatewayPaymentFailed(false);
  }, [paymentMethod]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Only ever auto-prompts the OS permission dialog the very first
        // time (permission === 'not_requested') — if the customer already
        // said no once, we don't ask again on every checkout visit; they
        // can still grant it later via Address > Use Current Location,
        // which explicitly re-prompts on a real tap.
        let permission = await locationService.getPermissionState();
        if (permission === 'not_requested') permission = await locationService.requestPermission();
        if (permission !== 'granted') return;

        const position = await locationService.getCurrentPosition();
        const [geocoded, result] = await Promise.all([
          geocodingService.reverseGeocode(position),
          storeRepository.checkServiceability(position),
        ]);
        if (cancelled) return;
        setDetectedLocation({
          label: geocoded?.label ?? 'Current location',
          addressLine: geocoded?.addressLine ?? geocoded?.label ?? 'Current location',
          city: geocoded?.city,
          state: geocoded?.state,
          postalCode: geocoded?.postalCode,
          position,
          serviceable: result.serviceable,
        });
      } catch {
        // GPS/permission/geocoding failure — silent, see comment above.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyDetectedLocation = async () => {
    if (!detectedLocation) return;
    setApplyingDetected(true);
    try {
      const created = await addressRepository.create({
        label: 'other',
        receiverName: profile?.name || 'Customer',
        receiverPhone: profile?.phone || '',
        line1: detectedLocation.addressLine,
        city: detectedLocation.city ?? 'Agra',
        state: detectedLocation.state ?? 'Uttar Pradesh',
        pincode: detectedLocation.postalCode ?? '',
        lat: detectedLocation.position.lat,
        lng: detectedLocation.position.lng,
      });
      setAddresses((prev) => [created, ...prev]);
      setSelectedAddressId(created.id);
      setDetectedAppliedId(created.id);
      setDetectedLocation(null);
    } catch {
      // Leave the banner up so they can retry rather than silently
      // losing the detected location.
    } finally {
      setApplyingDetected(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      setLoadingAddresses(true);
      addressRepository
        .list()
        .then((list) => {
          setAddresses(list);
          // Root cause of a real bug: this used to keep whatever address
          // was already selected as long as it still existed in the
          // refreshed list — so changing your default address on the
          // Address screen (the app's only address-selection UI; there
          // is no separate "pick an address for just this order" picker)
          // and coming back to Checkout kept using the OLD address,
          // silently ignoring the new default, because the old one
          // hadn't been deleted, just demoted. Checkout has to actually
          // follow the current default every time it refocuses, not
          // just on first load.
          const preferred = list.find((a) => a.isDefault) ?? list[0];
          setSelectedAddressId(preferred?.id ?? null);
        })
        .finally(() => setLoadingAddresses(false));
    }, []),
  );

  const selectedAddress = addresses.find((a) => a.id === selectedAddressId);

  // Regenerated only when the address changes — stable across retries
  // of the *same* attempt (double-tap, transient failure) so
  // create_order_from_cart's idempotency check actually dedupes them,
  // but never reused across a genuinely different attempt (a different
  // address is a different order).
  const idempotencyKey = useMemo(
    () => (selectedAddressId ? checkoutRepository.newIdempotencyKey() : null),
    [selectedAddressId],
  );

  useFocusEffect(
    useCallback(() => {
      if (!selectedAddressId) {
        setSummary(null);
        return;
      }
      setLoadingSummary(true);
      checkoutRepository
        .getSummary(selectedAddressId)
        .then((result) => {
          setSummary(result);
          // The one place Checkout can detect "the server cart doesn't
          // match what the local store thinks it has" — e.g. a previous
          // checkout attempt created (then failed/cancelled) a gateway
          // order that has since been resolved some other way. Resync
          // rather than leave Cart and Checkout disagreeing (section
          // 15-18, 41).
          if (!result.success && result.code === 'CART_EMPTY') {
            useCartStore.getState().loadCart();
          }
        })
        .catch(() => setSummary({ success: false, code: 'OUT_OF_STOCK', message: "Couldn't load your order summary. Please try again." }))
        .finally(() => setLoadingSummary(false));
    }, [selectedAddressId]),
  );

  const canPlaceOrder = summary?.success && summary.meetsMinimumOrder && !placing && !loadingSummary;

  // Real, state-driven progress (section 7-9) — this is one continuous
  // scrolling form, not a gated multi-screen wizard, so each step
  // reflects what has actually happened, never merely that the screen
  // loaded. Payment is "done" for COD as soon as delivery resolves
  // (COD needs no further confirmation) but for a gateway method only
  // once the payment gateway has actually confirmed success — never on
  // method selection alone. Review is "done" only once the order has
  // genuinely been placed (right before navigating to order-success),
  // never just because the cart is valid and ready to submit.
  const addressDone = !!selectedAddress;
  const deliveryDone = !!summary?.success;
  const paymentDone = deliveryDone && (paymentMethod === 'cod' || gatewayPaymentConfirmed);
  const reviewDone = orderPlaced;
  const stepDone = [addressDone, deliveryDone, paymentDone, reviewDone];
  const stepFailed = [false, false, gatewayPaymentFailed, false];
  const activeStepIndex = stepDone.indexOf(false);

  /** Returns true once the payment is genuinely verified server-side (see verify-razorpay-payment) — never trusts the client-reported "success" alone. */
  const completeGatewayPayment = async (orderId: string, orderNumber: string): Promise<boolean> => {
    try {
      const razorpayOrder = await checkoutRepository.createRazorpayOrder(orderId);
      const result = await openRazorpayCheckout({
        keyId: razorpayOrder.keyId,
        razorpayOrderId: razorpayOrder.razorpayOrderId,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        orderNumber,
        customerName: profile?.name,
        customerEmail: profile?.email,
        customerPhone: profile?.phone,
      });
      const verifyResult = await checkoutRepository.verifyRazorpayPayment({
        orderId,
        razorpayOrderId: result.razorpayOrderId,
        razorpayPaymentId: result.razorpayPaymentId,
        razorpaySignature: result.razorpaySignature,
      });
      if (!verifyResult.success) {
        setGatewayPaymentFailed(true);
        setPaymentFailureModal({ message: "We couldn't verify your payment. Please try again — your order is saved and nothing was charged twice." });
        return false;
      }
      setGatewayPaymentConfirmed(true);
      return true;
    } catch (e) {
      // A cancelled sheet is a quiet, expected exit (section 13) — no
      // error popup, no "failed" stepper state, just back to checkout
      // with the cart untouched. A genuine failure gets both.
      if (!(e instanceof RazorpayCheckoutCancelledError)) {
        setGatewayPaymentFailed(true);
        setPaymentFailureModal({ message: e instanceof Error ? e.message : "We couldn't complete your payment. Please try again." });
      }
      return false;
    }
  };

  const handlePlaceOrder = async () => {
    if (!canPlaceOrder || !selectedAddressId || !idempotencyKey) return;
    setPlacing(true);
    try {
      // Idempotent on (user, idempotencyKey) — retrying after a
      // cancelled/failed gateway payment resumes the SAME order and
      // reservation rather than creating a duplicate.
      const result = await checkoutRepository.placeOrder(selectedAddressId, idempotencyKey, paymentMethod);
      if (!result.success) {
        setSummary(result);
        if (result.code === 'CART_EMPTY') useCartStore.getState().loadCart();
        setPlacing(false);
        return;
      }
      if (paymentMethod !== 'cod') {
        const paid = await completeGatewayPayment(result.orderId, result.orderNumber);
        if (!paid) {
          // create_order_from_cart() already created a real order +
          // inventory reservation, and deleted the server-side cart,
          // before Razorpay even opened (so a retry with the same
          // idempotency key resumes it instead of double-ordering) — a
          // cancelled/failed payment must undo BOTH the order and the
          // cart deletion, not just the order, or the customer's cart
          // silently vanishes for a purchase that never happened
          // (section 11-13, 15-18).
          try {
            await orderRepository.restoreCartAfterFailedPayment(result.orderId);
          } catch {
            // Best-effort — the payment-failed popup already shown is the
            // important feedback here; the 15-minute expiry sweep is
            // still a backstop for the reservation if this fails too.
          } finally {
            // Resync local state to whatever the server actually ended
            // up with, whether or not the restore above succeeded —
            // this is what guarantees Cart and Checkout can never
            // disagree after this point.
            useCartStore.getState().loadCart();
          }
          setPlacing(false);
          return;
        }
      }
      const order = await orderRepository.getById(result.orderId);
      if (order) addOrder(order);
      setOrderPlaced(true);
      clearCartLocal();
      setPlacing(false);
      router.replace(`/order-success?orderId=${result.orderId}`);
    } catch {
      setPlacing(false);
      setGenericErrorModal({ message: "We couldn't place your order. Please try again." });
    }
  };

  useEffect(() => {
    if (totalCount === 0) router.replace('/cart');
  }, [totalCount]);

  if (totalCount === 0) {
    return <SafeScreen />;
  }

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>Checkout</Text>
          <View style={styles.secureRow}>
            <ShieldCheck size={13} color={colors.success} strokeWidth={ICON_STROKE} />
            <Text style={styles.secureText}>100% Secure Payments</Text>
          </View>
        </View>
      </View>

      <View style={styles.stepRow}>
        {STEPS.map((step, i) => {
          const done = stepDone[i];
          const failed = stepFailed[i];
          const active = i === activeStepIndex || (activeStepIndex === -1 && i === STEPS.length - 1);
          const label = step.key === 'payment' && done && paymentMethod === 'cod' ? `${step.label} — COD` : step.label;
          return (
            <React.Fragment key={step.key}>
              <View style={styles.stepItem}>
                <View
                  style={[
                    styles.stepCircle,
                    (done || active) && !failed && styles.stepCircleActive,
                    done && !failed && styles.stepCircleDone,
                    failed && styles.stepCircleFailed,
                  ]}
                >
                  {failed ? (
                    <AlertTriangle size={16} color={colors.white} strokeWidth={ICON_STROKE} />
                  ) : done ? (
                    <Check size={16} color={colors.white} strokeWidth={ICON_STROKE} />
                  ) : (
                    <step.icon size={16} color={active ? colors.white : colors.textSecondary} strokeWidth={ICON_STROKE} />
                  )}
                </View>
                <Text style={[styles.stepLabel, (done || active) && styles.stepLabelActive, failed && styles.stepLabelFailed]} numberOfLines={1}>
                  {label}
                </Text>
              </View>
              {i < STEPS.length - 1 && <View style={[styles.stepConnector, done && !failed && styles.stepConnectorDone]} />}
            </React.Fragment>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loadingAddresses ? (
          <View style={styles.loadingCard}>
            <BrandedLoader size="large" />
          </View>
        ) : !selectedAddress ? (
          <View style={styles.card}>
            <EmptyState
              icon={MapPin}
              title="No delivery address yet"
              subtitle="Add an address to continue to checkout."
              ctaLabel="Add Address"
              onPressCta={() => router.push('/address/add')}
            />
          </View>
        ) : (
          <>
            {detectedLocation && roughDistanceMeters(detectedLocation.position, { lat: selectedAddress.lat, lng: selectedAddress.lng }) > 300 && (
              <View style={styles.detectedCard}>
                <View style={styles.detectedIconWrap}>
                  <LocateFixed size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.detectedTitle}>You look like you're near {detectedLocation.label}</Text>
                  <Text style={styles.detectedSubtitle}>
                    {detectedLocation.serviceable ? 'We deliver here — want your order sent to your current location instead?' : "We're not delivering to your current spot yet — your saved address is still used."}
                  </Text>
                  {detectedLocation.serviceable && (
                    <View style={styles.detectedActions}>
                      <Pressable style={styles.detectedApplyBtn} onPress={applyDetectedLocation} disabled={applyingDetected}>
                        {applyingDetected ? <BrandedLoader color={colors.white} /> : <Text style={styles.detectedApplyBtnText}>Deliver Here</Text>}
                      </Pressable>
                    </View>
                  )}
                </View>
                <Pressable hitSlop={8} onPress={() => setDetectedLocation(null)}>
                  <X size={16} color={colors.textMuted} strokeWidth={ICON_STROKE} />
                </Pressable>
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <MapPin size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardHeaderTitle}>Delivery Address</Text>
                <Pressable onPress={() => router.push('/address')}>
                  <Text style={styles.changeText}>CHANGE</Text>
                </Pressable>
              </View>
              <Text style={styles.addressLabel}>
                {selectedAddressId === detectedAppliedId
                  ? 'Current Location'
                  : selectedAddress.label === 'home' ? 'Home' : selectedAddress.label === 'work' ? 'Work' : 'Other'}
              </Text>
              <Text style={styles.addressLine}>
                {selectedAddress.line1}, {selectedAddress.city}, {selectedAddress.state} - {selectedAddress.pincode}
              </Text>
              {selectedAddress.isDefault && (
                <View style={styles.defaultChip}>
                  <Check size={11} color={colors.success} strokeWidth={ICON_STROKE} />
                  <Text style={styles.defaultChipText}>Default Address</Text>
                </View>
              )}
            </View>

            {/* A confirmed failure (no store can serve this cart/address)
                gets ONLY the red CheckoutIssueBanner below — showing
                this green "checking delivery time… EXPRESS" card at the
                same time was actively misleading (real bug: it never
                said "checking" was done, or that it had failed, it just
                sat there forever next to a contradicting error banner). */}
            {(loadingSummary || !summary || summary.success) && (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Clock size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.cardHeaderTitle}>Delivery Time</Text>
                </View>
                <View style={styles.deliveryTimeRow}>
                  <View style={styles.deliveryTimeText}>
                    <Text style={styles.deliveryEta} numberOfLines={1}>
                      {summary?.success ? `Arrives in ~${summary.estimatedDeliveryMinutes} min` : 'Checking delivery time…'}
                    </Text>
                    <Text style={styles.deliverySubtitle} numberOfLines={1} ellipsizeMode="tail">
                      {summary?.success ? `Delivering from ${summary.storeName}` : 'Fast delivery from nearest store'}
                    </Text>
                  </View>
                  <View style={styles.expressChip}>
                    <Text style={styles.expressChipText}>EXPRESS</Text>
                  </View>
                </View>
              </View>
            )}

            {summary && !summary.success && (
              <CheckoutIssueBanner result={summary} onAddress={() => router.push('/address')} onEditCart={() => router.back()} />
            )}

            {summary?.success && summary.warnings.length > 0 && (
              <View style={styles.warningBanner}>
                <AlertTriangle size={ICON_SIZE.sm} color={colors.warning} strokeWidth={ICON_STROKE} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.warningTitle}>Some prices changed</Text>
                  {summary.warnings.map((w, i) => (
                    <Text key={i} style={styles.warningBody}>
                      {w.productName}: {formatINR(w.oldPrice)} → {formatINR(w.newPrice)}
                    </Text>
                  ))}
                </View>
              </View>
            )}

            {summary?.success && !summary.meetsMinimumOrder && (
              <View style={styles.warningBanner}>
                <AlertTriangle size={ICON_SIZE.sm} color={colors.warning} strokeWidth={ICON_STROKE} />
                <Text style={styles.warningBody}>
                  Add {formatINR(summary.amountToMinimumOrder)} more to place an order in this area (minimum {formatINR(summary.minimumOrderValue)}).
                </Text>
              </View>
            )}

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Package size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardHeaderTitle}>Order Items ({totalCount})</Text>
                <Pressable onPress={() => router.back()}>
                  <Text style={styles.changeText}>EDIT CART</Text>
                </Pressable>
              </View>
              {lines.map((line) => (
                <View key={line.cartItemId} style={styles.itemRow}>
                  <AppImage uri={line.product.images[0]} style={styles.itemImage} contentFit="cover" kind="product" />
                  <View style={styles.itemInfo}>
                    <Text numberOfLines={2} style={styles.itemName}>{line.product.name}</Text>
                    <Text numberOfLines={1} style={styles.itemVariant}>{line.variant.label}</Text>
                  </View>
                  <View style={styles.itemStepper}>
                    <Pressable onPress={() => setQuantity(line.cartItemId, line.quantity - 1)} hitSlop={6} style={styles.itemStepBtn}>
                      <Text style={styles.itemStepBtnText}>−</Text>
                    </Pressable>
                    <Text style={styles.itemQty}>{line.quantity}</Text>
                    <Pressable onPress={() => setQuantity(line.cartItemId, line.quantity + 1)} hitSlop={6} style={styles.itemStepBtn}>
                      <Text style={styles.itemStepBtnText}>+</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.itemPrice}>{formatINR(line.lineTotal)}</Text>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={[styles.cardHeaderTitle, { marginBottom: spacing.md }]}>Payment Method</Text>
              <PaymentMethodRow selected={paymentMethod} onSelect={setPaymentMethod} disabledKeys={GATEWAY_METHODS} />
            </View>

            <View style={styles.card}>
              <Text style={[styles.cardHeaderTitle, { marginBottom: spacing.sm }]}>Bill Summary</Text>
              {loadingSummary || !summary?.success ? (
                <View style={{ paddingVertical: spacing.md, alignItems: 'center', gap: spacing.sm }}>
                  <BrandedLoader />
                  <Text style={styles.billLoadingText}>Finding the nearest store for your order…</Text>
                </View>
              ) : (
                <>
                  <BillLine label={`Item Total (${totalCount} items)`} value={formatINR(summary.subtotal)} />
                  <BillLine label="You Saved" value={`- ${formatINR(summary.discount)}`} tone="success" />
                  <BillLine label="Delivery Fee" value={summary.deliveryFee === 0 ? 'FREE' : formatINR(summary.deliveryFee)} tone={summary.deliveryFee === 0 ? 'success' : undefined} />
                  <View style={styles.divider} />
                  <BillLine label="To Pay" value={formatINR(summary.total)} bold />
                </>
              )}
            </View>
          </>
        )}

        <View style={{ height: 140 }} />
      </ScrollView>

      <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
        <View>
          <Text style={styles.stickyTotal}>{summary?.success ? formatINR(summary.total) : '—'}</Text>
          <Text style={styles.stickyLink}>{PAYMENT_METHOD_LABEL[paymentMethod]}</Text>
        </View>
        <AnimatedPressable style={[styles.placeOrderBtn, !canPlaceOrder && styles.placeOrderBtnDisabled]} pressScale={0.97} onPress={handlePlaceOrder} disabled={!canPlaceOrder}>
          {placing ? (
            <>
              <BrandedLoader color={colors.white} />
              <Text style={styles.placeOrderText}>Placing your order…</Text>
            </>
          ) : (
            <>
              <Text style={styles.placeOrderText}>{paymentMethod === 'cod' ? 'Place Order' : 'Pay Now'}</Text>
              <ChevronRight size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
            </>
          )}
        </AnimatedPressable>
      </View>

      <GPErrorModal
        visible={!!paymentFailureModal}
        onClose={() => setPaymentFailureModal(null)}
        title="Payment wasn't completed"
        message={`${paymentFailureModal?.message ?? ''}\n\nYour cart is safe.`}
        primaryLabel="Try Again"
        onPressPrimary={() => {
          setPaymentFailureModal(null);
          handlePlaceOrder();
        }}
        secondaryLabel="Change Payment Method"
        onPressSecondary={() => setPaymentFailureModal(null)}
      />

      <GPErrorModal
        visible={!!genericErrorModal}
        onClose={() => setGenericErrorModal(null)}
        title="We couldn't place your order"
        message={`${genericErrorModal?.message ?? ''}\n\nYour cart is still safe.`}
        primaryLabel="Try Again"
        onPressPrimary={() => setGenericErrorModal(null)}
      />
    </SafeScreen>
  );
}

function CheckoutIssueBanner({
  result,
  onAddress,
  onEditCart,
}: {
  result: Extract<CheckoutSummaryResult, { success: false }>;
  onAddress: () => void;
  onEditCart: () => void;
}) {
  const copy: Record<string, { title: string; action?: { label: string; onPress: () => void } }> = {
    CART_EMPTY: { title: 'Your cart is empty', action: { label: 'Go to Cart', onPress: onEditCart } },
    ADDRESS_NOT_FOUND: { title: 'Please choose a delivery address', action: { label: 'Choose Address', onPress: onAddress } },
    PRODUCT_UNAVAILABLE: { title: 'Some items in your cart are no longer available', action: { label: 'Edit Cart', onPress: onEditCart } },
    OUTSIDE_SERVICE_AREA: { title: "We don't deliver to this address yet", action: { label: 'Change Address', onPress: onAddress } },
    CART_NOT_FULFILLABLE: { title: 'No nearby store can fulfill your whole cart right now', action: { label: 'Edit Cart', onPress: onEditCart } },
    BELOW_MINIMUM_ORDER: { title: result.message },
    OUT_OF_STOCK: { title: result.message, action: { label: 'Edit Cart', onPress: onEditCart } },
    CHECKOUT_ALREADY_PROCESSED: { title: 'This order was already placed' },
  };
  const meta = copy[result.code] ?? { title: result.message };

  return (
    <View style={styles.errorBanner}>
      <AlertTriangle size={ICON_SIZE.md} color={colors.error} strokeWidth={ICON_STROKE} />
      <View style={{ flex: 1 }}>
        <Text style={styles.errorTitle}>{meta.title}</Text>
        {result.unavailableItems && result.unavailableItems.length > 0 && (
          <Text style={styles.errorBody}>{result.unavailableItems.join(', ')}</Text>
        )}
        {meta.action && (
          <Pressable onPress={meta.action.onPress}>
            <Text style={styles.errorAction}>{meta.action.label} →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function BillLine({ label, value, tone, bold }: { label: string; value: string; tone?: 'success'; bold?: boolean }) {
  return (
    <View style={styles.billLine}>
      <Text style={[styles.billLabel, bold && styles.billLabelBold]}>{label}</Text>
      <Text style={[styles.billValue, tone === 'success' && { color: colors.success }, bold && styles.billValueBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: colors.textPrimary },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  secureText: { ...textStyles.caption, color: colors.success },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.xl, marginBottom: spacing.md },
  stepItem: { alignItems: 'center', width: 64 },
  stepCircle: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  stepCircleActive: { backgroundColor: colors.primary },
  stepCircleDone: { backgroundColor: colors.success },
  stepCircleFailed: { backgroundColor: colors.error },
  stepLabel: { ...textStyles.caption, color: colors.textSecondary, marginTop: 4, fontSize: 10.5 },
  stepLabelActive: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  stepLabelFailed: { color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
  stepConnector: { flex: 1, height: 1.5, backgroundColor: colors.border, marginTop: 17 },
  stepConnectorDone: { backgroundColor: colors.success },
  content: { paddingHorizontal: spacing.base },
  loadingCard: { paddingVertical: spacing.xxl, alignItems: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md, ...shadows.sm },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  cardHeaderTitle: { ...textStyles.cardTitle, color: colors.textPrimary, flex: 1 },
  changeText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  addressLabel: { ...textStyles.cardTitle, fontSize: 14, color: colors.primary, marginTop: spacing.xs },
  addressLine: { ...textStyles.bodySmall, color: colors.textSecondary, marginTop: 2 },
  defaultChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.successTint, alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, marginTop: spacing.sm },
  defaultChipText: { fontSize: 10.5, color: colors.success, fontFamily: 'PlusJakartaSans_700Bold' },
  detectedCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    backgroundColor: colors.goldTint, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gold,
    padding: spacing.base, marginBottom: spacing.md,
  },
  detectedIconWrap: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  detectedTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  detectedSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  detectedActions: { flexDirection: 'row', marginTop: spacing.sm },
  detectedApplyBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minWidth: 96, alignItems: 'center' },
  detectedApplyBtnText: { ...textStyles.bodySmall, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  deliveryTimeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, backgroundColor: colors.successTint, borderRadius: radius.sm, padding: spacing.md, marginTop: spacing.xs },
  // flex:1 + minWidth:0 is what actually lets the store-name line
  // truncate instead of overflowing under the EXPRESS chip on a long
  // store name / narrow screen (section 23) — without minWidth:0, a
  // flex child won't shrink below its own text's intrinsic width.
  deliveryTimeText: { flex: 1, minWidth: 0 },
  deliveryEta: { ...textStyles.cardTitle, fontSize: 14, color: colors.success },
  deliverySubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  billLoadingText: { ...textStyles.caption, color: colors.textSecondary, textAlign: 'center' },
  expressChip: { flexShrink: 0, borderWidth: 1, borderColor: colors.success, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  expressChipText: { fontSize: 10, color: colors.success, fontFamily: 'PlusJakartaSans_700Bold' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  itemImage: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  // flex:1 + minWidth:0 on the wrapping column (not the Text itself) is
  // what lets the name actually wrap/truncate within a flex row instead
  // of forcing the row wider than the card (section 25/15).
  itemInfo: { flex: 1, minWidth: 0 },
  itemName: { ...textStyles.bodySmall, color: colors.textPrimary, lineHeight: 18 },
  itemVariant: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  itemStepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xs, paddingHorizontal: spacing.sm },
  itemStepBtn: { paddingVertical: 4 },
  itemStepBtnText: { color: colors.primary, fontSize: 16, fontFamily: 'PlusJakartaSans_700Bold' },
  itemQty: { ...textStyles.bodySmall, color: colors.textPrimary, minWidth: 14, textAlign: 'center' },
  itemPrice: { ...textStyles.cardTitle, fontSize: 13, color: colors.textPrimary, minWidth: 60, textAlign: 'right' },
  billLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  billLabel: { ...textStyles.bodySmall, color: colors.textSecondary },
  billLabelBold: { color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },
  billValue: { ...textStyles.bodySmall, color: colors.textPrimary },
  billValueBold: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  errorBanner: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.errorTint, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md },
  errorTitle: { ...textStyles.bodySmall, color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
  errorBody: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  errorAction: { ...textStyles.caption, color: colors.error, fontFamily: 'PlusJakartaSans_700Bold', marginTop: 4 },
  warningBanner: { flexDirection: 'row', gap: spacing.sm, backgroundColor: colors.warningTint, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md },
  warningTitle: { ...textStyles.bodySmall, color: colors.warning, fontFamily: 'PlusJakartaSans_700Bold' },
  warningBody: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    ...shadows.lg,
  },
  stickyTotal: { ...textStyles.priceLarge, color: colors.textPrimary },
  stickyLink: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  placeOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    height: 52,
    minWidth: 160,
    justifyContent: 'center',
  },
  placeOrderBtnDisabled: { backgroundColor: colors.textMuted },
  placeOrderText: { ...textStyles.button, color: colors.white, fontSize: 15 },
});
