import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { AppImage } from '../ui/AppImage';
import { OrderStatusPill } from './OrderStatusPill';
import { formatINR } from '../ui/PriceBlock';
import { useCartStore } from '../../store/cartStore';
import { useUIStore } from '../../store/uiStore';
import { productRepository } from '../../services/repositories/productRepository';
import type { Order } from '../../types/models';

const ACTIVE_STATUSES = new Set(['confirmed', 'preparing', 'packed', 'rider_assigned', 'out_for_delivery', 'arriving']);

/** Single image if there's one item; a 2x2 collage (Zepto/Blinkit-style "what's in this order" preview) once there are several. */
function OrderThumbCollage({ items }: { items: Order['items'] }) {
  if (items.length <= 1) {
    return <AppImage uri={items[0]?.image} fallbackUri={items[0]?.fallbackImage} style={styles.singleThumb} contentFit="cover" kind="product" />;
  }
  const cells = items.slice(0, 4);
  const extra = items.length - 4;
  return (
    <View style={styles.collage}>
      {cells.map((item, i) => (
        <View key={item.id} style={styles.collageCell}>
          <AppImage uri={item.image} fallbackUri={item.fallbackImage} style={styles.collageImage} contentFit="cover" kind="product" borderRadius={0} />
          {i === 3 && extra > 0 && (
            <View style={styles.collageMoreOverlay}>
              <Text style={styles.collageMoreText}>+{extra}</Text>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function itemSummary(items: Order['items']): string {
  const names = items.slice(0, 2).map((i) => i.name);
  const extra = items.length - names.length;
  return names.join(', ') + (extra > 0 ? ` +${extra} more` : '');
}

export function OrderCard({ order }: { order: Order }) {
  const addItem = useCartStore((s) => s.addItem);
  const showToast = useUIStore((s) => s.showToast);
  const isActive = ACTIVE_STATUSES.has(order.status);
  const [reordering, setReordering] = useState(false);

  const handleReorder = async () => {
    setReordering(true);
    try {
      // Real current availability (section 11), not a stale local
      // product index — a line item from an old order may have since
      // gone out of stock or been deactivated.
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
      showToast(
        unavailable > 0 ? `Added to cart. ${unavailable} item(s) were unavailable.` : 'Items added to cart',
        unavailable > 0 ? 'info' : 'success',
      );
      router.push('/cart');
    } catch {
      showToast("Couldn't reorder right now. Please try again.", 'error');
    } finally {
      setReordering(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.mainRow}>
        <OrderThumbCollage items={order.items} />
        <View style={styles.infoCol}>
          <Text style={styles.itemSummary} numberOfLines={2}>{itemSummary(order.items)}</Text>
          <Text style={styles.meta}>
            #{order.orderNumber} · {new Date(order.placedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
          <View style={styles.footerRow}>
            <Text style={styles.total}>{formatINR(order.total)}</Text>
            <Text style={styles.itemCount}>· {order.items.length} item{order.items.length === 1 ? '' : 's'}</Text>
          </View>
        </View>
        <OrderStatusPill status={order.status} />
      </View>

      <View style={styles.actionsRow}>
        <Pressable style={styles.secondaryBtn} onPress={() => router.push(`/order/${order.id}`)}>
          <Text style={styles.secondaryBtnText}>View Details</Text>
        </Pressable>
        {isActive ? (
          <Pressable style={styles.primaryBtn} onPress={() => router.push(`/track/${order.id}`)}>
            <Text style={styles.primaryBtnText}>Track Order</Text>
          </Pressable>
        ) : order.status === 'delivered' ? (
          <Pressable style={[styles.primaryBtn, { opacity: reordering ? 0.6 : 1 }]} onPress={handleReorder} disabled={reordering}>
            <Text style={styles.primaryBtnText}>{reordering ? 'Checking…' : 'Reorder'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const COLLAGE_SIZE = 60;
const CELL_SIZE = (COLLAGE_SIZE - 2) / 2;

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.base,
    ...shadows.sm,
  },
  mainRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  singleThumb: { width: COLLAGE_SIZE, height: COLLAGE_SIZE, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  collage: { width: COLLAGE_SIZE, height: COLLAGE_SIZE, flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: radius.sm, overflow: 'hidden' },
  collageCell: { width: CELL_SIZE, height: CELL_SIZE },
  collageImage: { width: '100%', height: '100%', backgroundColor: colors.surfaceSunken },
  collageMoreOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(20,10,8,0.6)', alignItems: 'center', justifyContent: 'center' },
  collageMoreText: { fontSize: 11, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  infoCol: { flex: 1 },
  itemSummary: { ...textStyles.cardTitle, color: colors.textPrimary, fontSize: 14 },
  meta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 3 },
  footerRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 6 },
  total: { ...textStyles.cardTitle, color: colors.textPrimary, fontSize: 14 },
  itemCount: { ...textStyles.caption, color: colors.textSecondary },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  secondaryBtn: {
    flex: 1,
    height: 42,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { ...textStyles.button, color: colors.textPrimary, fontSize: 13 },
  primaryBtn: {
    flex: 1,
    height: 42,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: { ...textStyles.button, color: colors.white, fontSize: 13 },
});
