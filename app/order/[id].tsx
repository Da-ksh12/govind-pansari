import React, { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import BottomSheet from '@gorhom/bottom-sheet';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Camera, MapPin, Navigation, ReceiptText, XCircle } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../../components/layout/SafeBottomSpacer';
import { AppBottomSheet } from '../../components/ui/AppBottomSheet';
import { AppImage } from '../../components/ui/AppImage';
import { OrderStatusPill } from '../../components/order/OrderStatusPill';
import { OrderPreparationScene, type PreparationStage } from '../../components/order/OrderPreparationScene';
import { OrderTimeline } from '../../components/tracking/OrderTimeline';
import { PostDeliveryReview } from '../../components/order/PostDeliveryReview';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatINR } from '../../components/ui/PriceBlock';
import { OrderDetailSkeleton } from '../../components/skeletons/OrderDetailSkeleton';
import { useOrdersStore } from '../../store/ordersStore';
import { useCartStore } from '../../store/cartStore';
import { useUIStore } from '../../store/uiStore';
import { orderRepository } from '../../services/repositories/orderRepository';
import { productRepository } from '../../services/repositories/productRepository';

const ACTIVE_STATUSES = new Set(['placed', 'confirmed', 'preparing', 'packed', 'rider_assigned', 'out_for_delivery', 'arriving']);
// Matches update_order_status()'s owner-cancel rule (Phase 01/05) — a
// customer can only cancel before the store starts packing it.
const CUSTOMER_CANCELLABLE_STATUSES = new Set(['placed', 'confirmed', 'preparing']);

// Which in-store phase the preparation scene shows for a given order
// status — only the phases between "confirmed" and "rider assigned"
// have one; everything from rider-assigned onward is covered by the
// rider-journey strip on the live tracking screen instead.
const PREPARATION_STAGE_BY_STATUS: Partial<Record<string, PreparationStage>> = {
  preparing: 'gathering',
  picking: 'gathering',
  packing: 'packing',
  packed: 'sealed',
};

const CANCEL_REASONS = [
  'Ordered by mistake',
  'Changed my mind',
  'Delivery taking too long',
  'Found another option',
  'Other',
];

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useOrdersStore((s) => s.getById(id));
  const addOrder = useOrdersStore((s) => s.addOrder);
  const cancelOrder = useOrdersStore((s) => s.cancelOrder);
  const addItem = useCartStore((s) => s.addItem);
  const showToast = useUIStore((s) => s.showToast);
  const [cancelling, setCancelling] = useState(false);
  const cancelSheetRef = useRef<BottomSheet>(null);
  const [reordering, setReordering] = useState(false);
  const [fetching, setFetching] = useState(!order);
  const [error, setError] = useState(false);
  const [deliveryProof, setDeliveryProof] = useState<{ photoUrl: string; latitude: number | null; longitude: number | null } | null>(null);

  const loadOrder = () => {
    if (!id) return;
    setFetching(true);
    setError(false);
    orderRepository
      .getById(id)
      .then((fetched) => {
        if (fetched) addOrder(fetched);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setFetching(false));
  };

  useEffect(() => {
    if (!order && id) loadOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (order?.status !== 'delivered') {
      setDeliveryProof(null);
      return;
    }
    orderRepository.getDeliveryProof(order.id).then(setDeliveryProof).catch(() => setDeliveryProof(null));
  }, [order?.id, order?.status]);

  if (!order && fetching) return <SafeScreen><OrderDetailSkeleton /></SafeScreen>;
  if (!order) {
    return (
      <SafeScreen>
        <EmptyState title="Couldn't load this order" subtitle={error ? 'Check your connection and try again.' : "This order doesn't exist."} ctaLabel={error ? 'Retry' : undefined} onPressCta={error ? loadOrder : undefined} />
      </SafeScreen>
    );
  }

  const isActive = ACTIVE_STATUSES.has(order.status);
  const isCancellable = CUSTOMER_CANCELLABLE_STATUSES.has(order.status);

  const handleCancel = () => cancelSheetRef.current?.expand();

  const confirmCancel = async (reason: string) => {
    cancelSheetRef.current?.close();
    setCancelling(true);
    try {
      await cancelOrder(order.id, reason);
      showToast('Order cancelled', 'success');
    } catch {
      showToast("Couldn't cancel this order. Please try again.", 'error');
    } finally {
      setCancelling(false);
    }
  };

  const handleReorder = async () => {
    setReordering(true);
    try {
      // Real current availability, not the order's price/stock snapshot
      // from whenever it was placed — a product line from an old order
      // may have since gone out of stock or been deactivated.
      const productIds = [...new Set(order.items.map((i) => i.productId))];
      const currentProducts = await productRepository.listByIds(productIds);
      const variantById = new Map(currentProducts.flatMap((p) => p.variants.map((v) => [v.id, v] as const)));

      let unavailable = 0;
      for (const item of order.items) {
        const variant = variantById.get(item.variantId);
        if (!variant || variant.stockStatus === 'out_of_stock') {
          unavailable += 1;
          continue;
        }
        addItem(item.productId, item.variantId, item.quantity);
      }
      showToast(unavailable > 0 ? `Added to cart. ${unavailable} item(s) unavailable.` : 'Items added to cart', unavailable > 0 ? 'info' : 'success');
      router.push('/cart');
    } catch {
      showToast("Couldn't reorder right now. Please try again.", 'error');
    } finally {
      setReordering(false);
    }
  };

  return (
    <SafeScreen>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
          <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Order #{order.orderNumber}</Text>
          <Text style={styles.headerSubtitle}>
            {new Date(order.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
          </Text>
        </View>
        <OrderStatusPill status={order.status} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {isActive && (
          <Pressable style={styles.trackBanner} onPress={() => router.push(`/track/${order.id}`)}>
            <Text style={styles.trackBannerText}>Track your order live</Text>
            <Text style={styles.trackBannerArrow}>→</Text>
          </Pressable>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Order Status</Text>
          {PREPARATION_STAGE_BY_STATUS[order.status] && (
            <OrderPreparationScene stage={PREPARATION_STAGE_BY_STATUS[order.status]!} />
          )}
          <OrderTimeline status={order.status} />
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <ReceiptText size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.cardTitle}>Items ({order.items.length})</Text>
          </View>
          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <AppImage uri={item.image} fallbackUri={item.fallbackImage} style={styles.itemImage} contentFit="cover" kind="product" />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemMeta}>
                  {item.variantLabel} • Qty {item.quantity}
                </Text>
              </View>
              <Text style={styles.itemPrice}>{formatINR(item.price * item.quantity)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.itemRow}>
            <Text style={styles.totalLabel}>Total Paid</Text>
            <Text style={styles.totalValue}>{formatINR(order.total)}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
            <Text style={styles.cardTitle}>Delivery Address</Text>
          </View>
          <Text style={styles.addressText}>
            {order.address.receiverName} • {order.address.receiverPhone}
            {'\n'}
            {order.address.line1}, {order.address.city}, {order.address.state} - {order.address.pincode}
          </Text>
        </View>

        {order.status === 'delivered' && deliveryProof && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Delivery Photo Proof</Text>
            <AppImage uri={deliveryProof.photoUrl} style={styles.proofPhoto} contentFit="cover" fallbackIcon={Camera} />
            {deliveryProof.latitude != null && deliveryProof.longitude != null && (
              <Pressable
                style={styles.proofLocationBtn}
                onPress={() => Linking.openURL(`https://www.google.com/maps?q=${deliveryProof.latitude},${deliveryProof.longitude}`).catch(() => {})}
              >
                <Navigation size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.proofLocationText}>View delivery location on map</Text>
              </Pressable>
            )}
          </View>
        )}

        {order.status === 'delivered' && <PostDeliveryReview items={order.items} />}

        {order.status === 'delivered' && (
          <Pressable style={[styles.reorderBtn, { opacity: reordering ? 0.6 : 1 }]} onPress={handleReorder} disabled={reordering}>
            <Text style={styles.reorderText}>{reordering ? 'Checking availability…' : 'Reorder'}</Text>
          </Pressable>
        )}

        {isCancellable ? (
          <Pressable style={styles.cancelBtn} onPress={handleCancel} disabled={cancelling}>
            <XCircle size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
            <Text style={styles.cancelText}>{cancelling ? 'Cancelling…' : 'Cancel Order'}</Text>
          </Pressable>
        ) : (
          isActive && (
            <View style={styles.cancelClosedWrap}>
              <Text style={styles.cancelClosedText}>This order can no longer be cancelled — it's already being prepared for delivery.</Text>
              <Pressable style={styles.contactSupportBtn} onPress={() => router.push('/help')}>
                <Text style={styles.contactSupportText}>Contact Support</Text>
              </Pressable>
            </View>
          )
        )}

        <SafeBottomSpacer />
      </ScrollView>

      <AppBottomSheet ref={cancelSheetRef} title="Cancel this order?" snapPoints={['55%']}>
        <Text style={styles.sheetHint}>
          Order #{order.orderNumber} · {formatINR(order.total)}{'\n\n'}Tell us why — this can't be undone.
        </Text>
        {CANCEL_REASONS.map((r) => (
          <Pressable key={r} style={styles.reasonRow} onPress={() => confirmCancel(r)} disabled={cancelling}>
            <Text style={styles.reasonText}>{r}</Text>
          </Pressable>
        ))}
      </AppBottomSheet>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: colors.textPrimary },
  headerSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  content: { paddingHorizontal: spacing.base },
  trackBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md },
  trackBannerText: { ...textStyles.button, color: colors.white, fontSize: 14 },
  trackBannerArrow: { color: colors.white, fontSize: 18 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginBottom: spacing.md, ...shadows.sm },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  cardTitle: { ...textStyles.cardTitle, color: colors.textPrimary, marginBottom: spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  itemImage: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  itemName: { ...textStyles.bodySmall, color: colors.textPrimary },
  itemMeta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  itemPrice: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.xs },
  totalLabel: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, flex: 1 },
  totalValue: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  addressText: { ...textStyles.bodySmall, color: colors.textSecondary, lineHeight: 20 },
  proofPhoto: { width: '100%', height: 220, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  proofLocationBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, alignSelf: 'flex-start' },
  proofLocationText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  reorderBtn: { backgroundColor: colors.primary, borderRadius: radius.md, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  reorderText: { ...textStyles.button, color: colors.white, fontSize: 15 },
  cancelBtn: { flexDirection: 'row', gap: spacing.sm, borderWidth: 1.5, borderColor: colors.error, borderRadius: radius.md, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  cancelText: { ...textStyles.button, color: colors.error, fontSize: 15 },
  cancelClosedWrap: { marginTop: spacing.sm, backgroundColor: colors.surfaceSunken, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  cancelClosedText: { ...textStyles.bodySmall, color: colors.textSecondary, lineHeight: 19 },
  contactSupportBtn: { alignSelf: 'flex-start' },
  contactSupportText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  sheetHint: { ...textStyles.bodySmall, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.md },
  reasonRow: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  reasonText: { ...textStyles.body, color: colors.textPrimary },
});
