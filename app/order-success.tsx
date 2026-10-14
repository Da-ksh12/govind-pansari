import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Check, ChevronRight, Crown, Gift, Headset, MapPin } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { SafeBottomSpacer } from '../components/layout/SafeBottomSpacer';
import { formatINR } from '../components/ui/PriceBlock';
import { useOrdersStore } from '../store/ordersStore';
import { orderRepository } from '../services/repositories/orderRepository';

const CONFETTI_COLORS = [colors.gold, colors.primary, colors.success, colors.goldDark];
const CONFETTI_ANGLES = Array.from({ length: 10 }, (_, i) => (360 / 10) * i);

function SuccessRing({ delay }: { delay: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: (1 - progress.value) * 0.5,
    transform: [{ scale: 1 + progress.value * 1.4 }],
  }));
  return <Animated.View style={[styles.successRing, style]} />;
}

function ConfettiParticle({ angle, delay, color }: { angle: number; delay: number; color: string }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rad = (angle * Math.PI) / 180;
  const distance = 72;
  const style = useAnimatedStyle(() => {
    const t = progress.value;
    return {
      opacity: 1 - t,
      transform: [
        { translateX: Math.cos(rad) * distance * t },
        { translateY: Math.sin(rad) * distance * t },
        { rotate: `${t * 300}deg` },
        { scale: 1 - t * 0.3 },
      ],
    };
  });
  return <Animated.View style={[styles.confettiDot, { backgroundColor: color }, style]} />;
}

/** Celebratory burst — radiating rings + confetti — behind the checkmark, the "successful animation" counterpart to the cart-fly animation on Add to Cart. */
function SuccessBurst() {
  return (
    <>
      <SuccessRing delay={80} />
      <SuccessRing delay={220} />
      {CONFETTI_ANGLES.map((angle, i) => (
        <ConfettiParticle key={angle} angle={angle} delay={120 + i * 25} color={CONFETTI_COLORS[i % CONFETTI_COLORS.length]} />
      ))}
    </>
  );
}

export default function OrderSuccessScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const order = useOrdersStore((s) => s.getById(orderId));
  const addOrder = useOrdersStore((s) => s.addOrder);

  const scale = useSharedValue(0.5);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(1, { damping: 10, stiffness: 140 });
    opacity.value = withTiming(1, { duration: 300 });
  }, [scale, opacity]);

  // Normally already in the store (checkout pushed it in right before
  // navigating here) — this is only the fallback for a cold start /
  // deep link straight to this screen.
  useEffect(() => {
    if (!order && orderId) {
      orderRepository.getById(orderId).then((fetched) => fetched && addOrder(fetched));
    }
  }, [order, orderId, addOrder]);

  const checkStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));

  if (!order) return <SafeScreen />;

  return (
    <SafeScreen>
      <View style={styles.helpRow}>
        <Pressable style={styles.helpBtn} onPress={() => router.push('/help')}>
          <Headset size={14} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
          <Text style={styles.helpText}>Help</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.checkStage}>
          <SuccessBurst />
          <Animated.View style={[styles.checkCircle, checkStyle]}>
            <Check size={32} color={colors.white} strokeWidth={2.4} />
          </Animated.View>
        </View>

        <Animated.View entering={FadeIn.delay(200).duration(400)}>
          <Text style={styles.title}>Order Confirmed!</Text>
          <Text style={styles.subtitle}>
            Thank you for choosing <Text style={styles.brand}>Govind Pansari</Text> ♥
          </Text>
        </Animated.View>

        <Animated.View entering={FadeIn.delay(300).duration(400)} style={styles.metaRow}>
          <MetaItem label="Order ID" value={order.orderNumber} />
          <View style={styles.metaDivider} />
          <MetaItem label="Order Total" value={formatINR(order.total)} />
          <View style={styles.metaDivider} />
          <MetaItem label="Payment" value={order.payment.method.toUpperCase()} />
        </Animated.View>

        <Animated.View entering={FadeIn.delay(380).duration(400)} style={styles.etaCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.etaLabel}>Estimated Delivery</Text>
            <Text style={styles.etaValue}>
              {order.etaMinutesMin}–{order.etaMinutesMax} min
            </Text>
            <Text style={styles.etaHint}>We'll update you when your order is on the way.</Text>
          </View>
          <Pressable style={styles.trackBtn} onPress={() => router.replace(`/track/${order.id}`)}>
            <Text style={styles.trackBtnText}>Track Order</Text>
            <ChevronRight size={14} color={colors.primary} strokeWidth={ICON_STROKE} />
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeIn.delay(440).duration(400)} style={styles.twoColRow}>
          <View style={styles.colCard}>
            <View style={styles.colHeader}>
              <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.colTitle}>Delivery Address</Text>
            </View>
            <Text style={styles.colBody}>
              {order.address.line1}, {order.address.city}, {order.address.state} - {order.address.pincode}
            </Text>
          </View>
        </Animated.View>

        <Animated.View entering={FadeIn.delay(500).duration(400)} style={styles.itemsCard}>
          <View style={styles.itemsHeader}>
            <Text style={styles.colTitle}>Order Items ({order.items.length})</Text>
          </View>
          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemMeta}>
                  {item.variantLabel} • Qty: {item.quantity}
                </Text>
              </View>
              <Text style={styles.itemPrice}>{formatINR(item.price * item.quantity)}</Text>
            </View>
          ))}
          {order.savings > 0 && (
            <View style={styles.savingsRow}>
              <Gift size={ICON_SIZE.sm} color={colors.success} strokeWidth={ICON_STROKE} />
              <Text style={styles.savingsText}>You saved {formatINR(order.savings)} on this order</Text>
            </View>
          )}
        </Animated.View>

        <Animated.View entering={FadeIn.delay(560).duration(400)} style={styles.loyaltyBanner}>
          <Crown size={ICON_SIZE.lg} color={colors.gold} strokeWidth={ICON_STROKE} />
          <View style={{ flex: 1 }}>
            <Text style={styles.loyaltyTitle}>Welcome to the Govind Pansari Family!</Text>
            <Text style={styles.loyaltySubtitle}>Enjoy exclusive offers & early access to new products.</Text>
          </View>
        </Animated.View>

        <View style={styles.buttonRow}>
          <Pressable style={styles.secondaryBtn} onPress={() => router.replace('/(tabs)')}>
            <Text style={styles.secondaryBtnText}>Continue Shopping</Text>
          </Pressable>
          <Pressable style={styles.primaryBtn} onPress={() => router.replace('/(tabs)/orders')}>
            <Text style={styles.primaryBtnText}>View My Orders</Text>
          </Pressable>
        </View>

        <SafeBottomSpacer />
      </ScrollView>
    </SafeScreen>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  helpRow: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.base, paddingTop: spacing.sm },
  helpBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  helpText: { ...textStyles.bodySmall, color: colors.textSecondary },
  content: { paddingHorizontal: spacing.base, alignItems: 'center' },
  checkStage: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  checkCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successRing: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  confettiDot: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: -3,
    marginLeft: -3,
  },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.textPrimary, marginTop: spacing.lg, textAlign: 'center' },
  subtitle: { ...textStyles.body, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' },
  brand: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  metaRow: {
    flexDirection: 'row',
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.base,
    marginTop: spacing.xl,
    ...shadows.sm,
  },
  metaDivider: { width: 1, backgroundColor: colors.divider },
  metaLabel: { ...textStyles.caption, color: colors.textSecondary },
  metaValue: { ...textStyles.cardTitle, color: colors.textPrimary, fontSize: 13, marginTop: 2 },
  etaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.successTint,
    borderRadius: radius.md,
    padding: spacing.base,
    marginTop: spacing.md,
  },
  etaLabel: { ...textStyles.caption, color: colors.textSecondary },
  etaValue: { ...textStyles.cardTitle, color: colors.success, fontSize: 20, marginTop: 2 },
  etaHint: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  trackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  trackBtnText: { ...textStyles.button, color: colors.primary, fontSize: 13 },
  twoColRow: { flexDirection: 'row', gap: spacing.md, width: '100%', marginTop: spacing.md },
  colCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, ...shadows.sm },
  colHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  colTitle: { ...textStyles.cardTitle, fontSize: 13, color: colors.textPrimary },
  colBody: { ...textStyles.caption, color: colors.textSecondary, lineHeight: 16 },
  itemsCard: { width: '100%', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginTop: spacing.md, ...shadows.sm },
  itemsHeader: { marginBottom: spacing.sm },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.divider },
  itemName: { ...textStyles.bodySmall, color: colors.textPrimary },
  itemMeta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  itemPrice: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold' },
  savingsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  savingsText: { ...textStyles.bodySmall, color: colors.success, fontFamily: 'PlusJakartaSans_600SemiBold' },
  loyaltyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    width: '100%',
    backgroundColor: colors.primaryTint,
    borderRadius: radius.md,
    padding: spacing.base,
    marginTop: spacing.md,
  },
  loyaltyTitle: { ...textStyles.cardTitle, fontSize: 14, color: colors.primaryDarker },
  loyaltySubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  buttonRow: { flexDirection: 'row', gap: spacing.md, width: '100%', marginTop: spacing.xl },
  secondaryBtn: { flex: 1, height: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { ...textStyles.button, color: colors.primary, fontSize: 14 },
  primaryBtn: { flex: 1, height: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { ...textStyles.button, color: colors.white, fontSize: 14 },
});
