import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Camera, Check, IndianRupee, MapPin, Navigation, Phone, Truck, User, XCircle } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { AdminShell } from '../../../components/admin/AdminShell';
import { StatusBadge } from '../../../components/admin/StatusBadge';
import { EmptyState } from '../../../components/ui/EmptyState';
import { AppImage } from '../../../components/ui/AppImage';
import { formatINR } from '../../../components/ui/PriceBlock';
import { useAdminStore } from '../../../store/adminStore';
import { useUIStore } from '../../../store/uiStore';
import { pushAdmin } from '../../../services/adminNav';
import { adminRepository } from '../../../services/repositories/adminRepository';
import { storeOpsRepository, type CompletedDeliveryProof } from '../../../services/repositories/storeOpsRepository';

const NON_CANCELLABLE = new Set(['delivered', 'cancelled']);

export default function AdminOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [deliveryProof, setDeliveryProof] = useState<CompletedDeliveryProof | null>(null);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const showToast = useUIStore((s) => s.showToast);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    adminRepository.getOrderDetail(id).then(setDetail).catch(() => setDetail(null)).finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(load);

  // Delivery Proof (redesign section 25): already fully built for the
  // store-ops side (storeOpsRepository.getDeliveryProof) — admin just
  // never surfaced it. Reused as-is rather than rebuilt.
  useEffect(() => {
    if (!id || detail?.order?.status !== 'delivered') return;
    storeOpsRepository.getDeliveryProof(id).then(setDeliveryProof).catch(() => {});
  }, [id, detail?.order?.status]);

  const handleCancel = () => {
    Alert.alert('Cancel this order?', 'Stock will be released/restocked automatically. This cannot be undone.', [
      { text: 'Keep Order', style: 'cancel' },
      {
        text: 'Cancel Order',
        style: 'destructive',
        onPress: async () => {
          setCancelling(true);
          try {
            await adminRepository.cancelOrder(id);
            showToast('Order cancelled', 'success');
            load();
          } catch {
            showToast("Couldn't cancel this order.", 'error');
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  };

  if (loading) {
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
        <EmptyState title="Couldn't load this order" subtitle="It may have been removed, or something went wrong. Please try again." ctaLabel="Retry" onPressCta={load} />
      </AdminShell>
    );
  }

  const order = detail.order;
  const items = detail.items ?? [];
  const timeline = detail.timeline ?? [];
  const canCancel = hasPermission('orders.cancel') && !NON_CANCELLABLE.has(order.status);

  return (
    <AdminShell title={`Order #${order.order_number}`} subtitle={new Date(order.placed_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.backRow} onPress={() => router.back()}>
          <ArrowLeft size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
          <Text style={styles.backText}>Back to Orders</Text>
        </Pressable>

        <View style={styles.grid}>
          <View style={styles.mainCol}>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Items</Text>
              {items.map((item: any) => (
                <View key={item.id} style={styles.itemRow}>
                  <Text style={styles.itemName} numberOfLines={1}>{item.productName} • {item.variantLabel}</Text>
                  <Text style={styles.itemQty}>×{item.quantity}</Text>
                  <Text style={styles.itemPrice}>{formatINR(item.unitPrice * item.quantity)}</Text>
                </View>
              ))}
              <View style={styles.divider} />
              <View style={styles.itemRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{formatINR(order.total)}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Timeline</Text>
              {timeline.map((evt: any, i: number) => {
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
                      <Text style={[styles.timelineLabel, isLast && styles.timelineLabelActive]}>{evt.label.replace(/_/g, ' ')}</Text>
                      <Text style={styles.timelineTime}>{new Date(evt.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
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
                    <Text style={styles.mutedText}>
                      {new Date(deliveryProof.completedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </Text>
                    {deliveryProof.cashCollected != null && (
                      <View style={styles.proofCashRow}>
                        <IndianRupee size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                        <Text style={styles.mutedText}>{formatINR(deliveryProof.cashCollected)} collected (COD)</Text>
                      </View>
                    )}
                    {deliveryProof.photoUrl && (
                      <AppImage uri={deliveryProof.photoUrl} style={styles.proofPhoto} fallbackIcon={Camera} />
                    )}
                    {deliveryProof.latitude != null && deliveryProof.longitude != null && (
                      <Pressable
                        style={styles.trackBtn}
                        onPress={() => Linking.openURL(`https://www.google.com/maps?q=${deliveryProof.latitude},${deliveryProof.longitude}`).catch(() => {})}
                      >
                        <Navigation size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                        <Text style={styles.trackBtnText}>View delivery location on map</Text>
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
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Status</Text>
              <StatusBadge status={order.status} />
              {canCancel && (
                <Pressable style={styles.cancelBtn} onPress={handleCancel} disabled={cancelling}>
                  <XCircle size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
                  <Text style={styles.cancelText}>{cancelling ? 'Cancelling…' : 'Cancel Order'}</Text>
                </Pressable>
              )}
              {detail.delivery && hasPermission('deliveries.view') && (
                <Pressable style={styles.trackBtn} onPress={() => router.push(`/track/${order.id}` as never)}>
                  <Truck size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.trackBtnText}>View Live Tracking</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <User size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardTitle}>Customer</Text>
              </View>
              <Text style={styles.plainText}>{detail.customer?.name ?? 'Unknown customer'}</Text>
              <Text style={styles.mutedText}>{detail.customer?.phone}</Text>
              {hasPermission('customers.view') && detail.customer?.id && (
                <Pressable onPress={() => pushAdmin(`/admin/customers/${detail.customer.id}`)}>
                  <Text style={styles.linkText}>View customer profile</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                <Text style={styles.cardTitle}>Delivery Address</Text>
              </View>
              <Text style={styles.mutedText}>
                {detail.deliveryAddress?.address_line_1}, {detail.deliveryAddress?.city} - {detail.deliveryAddress?.postal_code}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Store</Text>
              <Text style={styles.plainText}>{detail.store?.name ?? 'Unknown store'}</Text>
              <Text style={styles.mutedText}>{detail.store?.addressLine}</Text>
            </View>

            {detail.delivery && (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Phone size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
                  <Text style={styles.cardTitle}>Rider</Text>
                </View>
                <Text style={styles.plainText}>{detail.delivery.riderName}</Text>
                <View style={{ marginTop: 6 }}>
                  <StatusBadge status={detail.delivery.status} size="sm" />
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, maxWidth: 1100, width: '100%', alignSelf: 'center' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  backText: { ...textStyles.caption, color: colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  mainCol: { flex: 2, minWidth: 320, gap: spacing.md },
  sideCol: { flex: 1, minWidth: 260, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  cardTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, marginBottom: spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  itemName: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary },
  itemQty: { ...textStyles.caption, color: colors.textSecondary },
  itemPrice: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold', minWidth: 70, textAlign: 'right' },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.xs },
  totalLabel: { flex: 1, ...textStyles.cardTitle, fontSize: 13, color: colors.textPrimary },
  totalValue: { ...textStyles.cardTitle, fontSize: 13, color: colors.textPrimary },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineRail: { alignItems: 'center', width: 18 },
  timelineDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.surfaceSunken, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  timelineDotActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  timelineLine: { width: 2, flex: 1, minHeight: 20, backgroundColor: colors.border },
  timelineContent: { flex: 1, paddingBottom: spacing.md },
  timelineTime: { ...textStyles.caption, color: colors.textMuted, marginTop: 1 },
  timelineLabel: { ...textStyles.bodySmall, color: colors.textSecondary, textTransform: 'capitalize' },
  timelineLabelActive: { color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  cancelText: { ...textStyles.caption, color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
  trackBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  trackBtnText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  proofCashRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  proofPhoto: { width: '100%', height: 200, borderRadius: radius.md, marginTop: spacing.md },
  plainText: { ...textStyles.bodySmall, color: colors.textPrimary },
  mutedText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  linkText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold', marginTop: spacing.sm },
});
