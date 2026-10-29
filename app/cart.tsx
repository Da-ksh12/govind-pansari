import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft, ShoppingBag, Tag, Trash2 } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../theme';
import { ICON_SIZE, ICON_STROKE } from '../theme/icons';
import { SafeScreen } from '../components/layout/SafeScreen';
import { CartLineRow } from '../components/cart/CartLineRow';
import { EmptyCartHero, EmptyCartCopy } from '../components/cart/EmptyCartHero';
import { FreeDeliveryProgress } from '../components/cart/FreeDeliveryProgress';
import { CategoryRail } from '../components/home/CategoryRail';
import { ProductRail } from '../components/product/ProductRail';
import { formatINR } from '../components/ui/PriceBlock';
import { useCartLines } from '../hooks/useCartLines';
import { useCartStore } from '../store/cartStore';
import { productRepository } from '../services/repositories/productRepository';
import { categoryRepository } from '../services/repositories/categoryRepository';
import { cartRepository, type EnrichedCartItem } from '../services/repositories/cartRepository';
import { useAsync } from '../hooks/useAsync';
import { useFilteredRecommendations } from '../hooks/useFilteredRecommendations';

const WIDE_BREAKPOINT = 900;

export default function CartScreen() {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const insets = useSafeAreaInsets();
  const { lines, savedLines, itemTotal, mrpTotal, deliveryFee, amountToFreeDelivery, freeDeliveryProgress, hasFreeDelivery, savings, totalCount } =
    useCartLines();
  const clearCart = useCartStore((s) => s.clear);

  const grandTotal = Math.max(0, itemTotal + deliveryFee);

  // Freshly re-checked against the live catalogue every time this
  // screen gains focus (section 12/44/45/46) — the fast optimistic
  // cartStore/useCartLines above never knows about availability or
  // price drift on its own, so this is the one place that asks the
  // server "is this still accurate" rather than trusting local state.
  const [enrichment, setEnrichment] = useState<Map<string, EnrichedCartItem> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Items are on the device but their details (names, prices) are not loaded yet — a fresh start or a slow network.
  // That is "loading", never "empty".
  const storedLineCount = useCartStore((s) => s.items.filter((i) => !i.savedForLater).length);
  const loadCart = useCallback(() => {
    setLoadFailed(false);
    cartRepository
      .list()
      .then((items) => {
        setEnrichment(new Map(items.map((i) => [i.variantId, i])));
        useCartStore.getState().applyServerCart(items);
      })
      .catch(() => setLoadFailed(true));
  }, []);
  // Reconciles the local store against the real server cart on every focus — the one place that catches a cart the
  // server emptied out from under us (e.g. a checkout attempt that created-then-cancelled an order) before it can show
  // a stale item here while Checkout correctly reports CART_EMPTY. A failed read leaves the stored cart as it is.
  useFocusEffect(
    useCallback(() => {
      loadCart();
    }, [loadCart]),
  );

  const { data: crossSellRaw } = useAsync(async () => {
    if (lines.length === 0) return [];
    return productRepository.listRelated(lines[0].product.id, 8);
  }, [lines.length > 0 ? lines[0]?.product.id : null]);
  const crossSell = useFilteredRecommendations(crossSellRaw, { limit: 6 });

  // Empty-cart discovery sections (motion system, section 4) — only
  // fetched when there's actually an empty cart to fill; the cheap
  // early-return keeps this from doing real work on every render of a
  // non-empty cart, same idiom as crossSellRaw above.
  const { data: emptyCartCategories } = useAsync(async () => {
    if (totalCount > 0) return [];
    return categoryRepository.listTopLevel();
  }, [totalCount === 0]);
  const { data: emptyCartPopularRaw } = useAsync(async () => {
    if (totalCount > 0) return [];
    return productRepository.listBestsellers();
  }, [totalCount === 0]);
  const emptyCartPopular = useFilteredRecommendations(emptyCartPopularRaw, { limit: 10 });

  if (totalCount === 0 && storedLineCount > 0) {
    return (
      <SafeScreen>
        <CartHeader onClear={undefined} />
        <View style={styles.pendingCart}>
          {loadFailed ? (
            <>
              <Text style={styles.pendingTitle}>Couldn't load your cart</Text>
              <Text style={styles.pendingText}>Your items are safe. Check your connection and try again.</Text>
              <Pressable style={styles.emptyShopBtn} onPress={loadCart}>
                <Text style={styles.emptyShopBtnText}>Retry</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.pendingText}>Loading your cart…</Text>
            </>
          )}
        </View>
      </SafeScreen>
    );
  }

  if (totalCount === 0) {
    return (
      <SafeScreen>
        <CartHeader onClear={undefined} />
        <ScrollView contentContainerStyle={styles.emptyContent} showsVerticalScrollIndicator={false}>
          <EmptyCartHero />
          <EmptyCartCopy />
          <Pressable style={styles.emptyShopBtn} onPress={() => router.replace('/(tabs)')}>
            <ShoppingBag size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
            <Text style={styles.emptyShopBtnText}>Start Shopping</Text>
          </Pressable>

          {emptyCartCategories && emptyCartCategories.length > 0 && (
            <View style={styles.emptySection}>
              <Text style={styles.emptySectionTitle}>Shop by Category</Text>
              <CategoryRail categories={emptyCartCategories} />
            </View>
          )}

          {emptyCartPopular && emptyCartPopular.length > 0 && (
            <View style={[styles.emptySection, { marginTop: spacing.lg }]}>
              <ProductRail title="Popular Right Now" products={emptyCartPopular} />
            </View>
          )}

          <View style={{ height: spacing.xxl }} />
        </ScrollView>
      </SafeScreen>
    );
  }

  const itemsContent = (
    <>
      {hasFreeDelivery && <FreeDeliveryProgress progress={freeDeliveryProgress} amountRemaining={amountToFreeDelivery} />}

      <View style={styles.linesWrap}>
        {lines.map((line) => {
          const info = enrichment?.get(line.variant.id);
          return (
            <CartLineRow
              key={line.cartItemId}
              line={line}
              unavailable={info ? info.availability === 'unavailable' : false}
              priceChange={info?.priceChanged ? { oldPrice: info.priceSnapshot!, newPrice: info.currentPrice } : undefined}
            />
          );
        })}
      </View>

      {/* Coupons are not real yet — no coupons table, and
          create_order_from_cart has no discount parameter, so any
          client-computed "applied" discount would never actually be
          charged. Kept as a small, honest, low-emphasis note rather
          than a card competing for attention with real cart content
          (pre-production hardening; polish pass). */}
      <View style={styles.couponHint}>
        <Tag size={ICON_SIZE.xs} color={colors.textMuted} strokeWidth={ICON_STROKE} />
        <Text style={styles.couponHintText}>Promo codes aren't available yet</Text>
      </View>

      {savings > 0 && (
        <View style={styles.savingsBanner}>
          <Text style={styles.savingsText}>You're saving {formatINR(savings)} on this order</Text>
        </View>
      )}

      {savedLines.length > 0 && (
        <View style={styles.savedSection}>
          <Text style={styles.savedTitle}>Saved for Later ({savedLines.length})</Text>
          {savedLines.map((line) => (
            <CartLineRow key={line.cartItemId} line={line} savedForLater />
          ))}
        </View>
      )}

      {crossSell && crossSell.length > 0 && (
        <View style={{ marginTop: spacing.xl, marginHorizontal: isWide ? 0 : -spacing.base }}>
          <ProductRail title="You may also like" products={crossSell} />
        </View>
      )}
    </>
  );

  const billSummary = (
    <View style={styles.billCard}>
      <Text style={styles.billTitle}>Bill Summary</Text>
      <BillRow label={`Total MRP (${totalCount} items)`} value={formatINR(mrpTotal)} />
      <BillRow label="Discount on MRP" value={`- ${formatINR(mrpTotal - itemTotal)}`} tone="success" />
      <BillRow label="Delivery Fee" value={deliveryFee === 0 ? 'FREE' : formatINR(deliveryFee)} tone={deliveryFee === 0 ? 'success' : undefined} />
      <View style={styles.billDivider} />
      <BillRow label="To Pay" value={formatINR(grandTotal)} bold />
      {isWide && (
        <Pressable style={styles.checkoutBtnWide} onPress={() => router.push('/checkout')}>
          <ShoppingBag size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
          <Text style={styles.checkoutText}>Proceed to Checkout</Text>
        </Pressable>
      )}
    </View>
  );

  // Desktop (section 10): products on the left, a sticky order summary
  // on the right — the same cart/pricing logic and components as
  // mobile, just arranged in two columns instead of one scrolling
  // column with a floating bottom bar.
  if (isWide) {
    return (
      <SafeScreen>
        <CartHeader onClear={clearCart} />
        <ScrollView contentContainerStyle={styles.wideContent} showsVerticalScrollIndicator={false}>
          <View style={styles.wideGrid}>
            <View style={styles.wideLeftCol}>{itemsContent}</View>
            <View style={styles.wideRightCol}>{billSummary}</View>
          </View>
        </ScrollView>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen>
      <CartHeader onClear={clearCart} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {itemsContent}
        {billSummary}
        <View style={{ height: 140 }} />
      </ScrollView>

      <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, spacing.base) }]}>
        <Pressable style={styles.checkoutBtn} onPress={() => router.push('/checkout')}>
          <View style={styles.checkoutLabel}>
            <ShoppingBag size={ICON_SIZE.sm} color={colors.white} strokeWidth={ICON_STROKE} />
            <Text style={styles.checkoutText}>Proceed to Checkout</Text>
          </View>
          <Text style={styles.checkoutTotal}>{formatINR(grandTotal)}</Text>
        </Pressable>
      </View>
    </SafeScreen>
  );
}

function CartHeader({ onClear }: { onClear?: () => void }) {
  const { totalCount, itemTotal } = useCartLines();
  return (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.headerBtn} hitSlop={8}>
        <ArrowLeft size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>Your Cart</Text>
        {totalCount > 0 && (
          <Text style={styles.headerSubtitle}>
            {totalCount} items • {formatINR(itemTotal)}
          </Text>
        )}
      </View>
      {onClear && totalCount > 0 && (
        <Pressable onPress={onClear} hitSlop={8}>
          <Trash2 size={ICON_SIZE.md} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
        </Pressable>
      )}
    </View>
  );
}

function BillRow({ label, value, tone, bold }: { label: string; value: string; tone?: 'success'; bold?: boolean }) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, bold && styles.billLabelBold]}>{label}</Text>
      <Text style={[styles.billValue, tone === 'success' && { color: colors.success }, bold && styles.billValueBold]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.base, paddingVertical: spacing.md },
  headerBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  headerTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22, color: colors.textPrimary },
  headerSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  content: { paddingHorizontal: spacing.base, paddingTop: spacing.sm },
  emptyContent: { paddingBottom: spacing.xxl },
  pendingCart: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xl },
  pendingTitle: { ...textStyles.sectionTitle, fontSize: 18, color: colors.textPrimary, textAlign: 'center' },
  pendingText: { ...textStyles.body, color: colors.textSecondary, textAlign: 'center' },
  emptyShopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.pill, height: 50, marginTop: spacing.xl,
    marginHorizontal: spacing.xl,
  },
  emptyShopBtnText: { ...textStyles.button, color: colors.white, fontSize: 15 },
  emptySection: { marginTop: spacing.xxl },
  emptySectionTitle: { ...textStyles.sectionTitle, fontSize: 16, color: colors.textPrimary, marginBottom: spacing.md, paddingHorizontal: spacing.base },
  wideContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl, alignItems: 'center' },
  wideGrid: { flexDirection: 'row', gap: spacing.xl, width: '100%', maxWidth: 1100, alignItems: 'flex-start' },
  wideLeftCol: { flex: 1.7 },
  wideRightCol: { flex: 1, position: 'sticky' as never, top: spacing.md },
  checkoutBtnWide: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, height: 52, marginTop: spacing.lg },
  linesWrap: { marginTop: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, ...shadows.sm },
  couponHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, paddingHorizontal: spacing.xs },
  couponHintText: { ...textStyles.caption, color: colors.textMuted },
  savingsBanner: { backgroundColor: colors.successTint, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  savingsText: { ...textStyles.bodySmall, color: colors.success, fontFamily: 'PlusJakartaSans_600SemiBold', textAlign: 'center' },
  savedSection: { marginTop: spacing.xl },
  savedTitle: { ...textStyles.sectionTitle, fontSize: 15, color: colors.textPrimary, marginBottom: spacing.sm },
  billCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.base, marginTop: spacing.xl, ...shadows.sm },
  billTitle: { ...textStyles.cardTitle, color: colors.textPrimary, marginBottom: spacing.sm },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  billLabel: { ...textStyles.bodySmall, color: colors.textSecondary },
  billLabelBold: { color: colors.textPrimary, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },
  billValue: { ...textStyles.bodySmall, color: colors.textPrimary },
  billValueBold: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15 },
  billDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.sm },
  stickyBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    padding: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  checkoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 54,
    paddingHorizontal: spacing.lg,
  },
  checkoutLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  checkoutText: { ...textStyles.button, color: colors.white, fontSize: 15 },
  checkoutTotal: { ...textStyles.button, color: colors.white, fontSize: 15 },
});
