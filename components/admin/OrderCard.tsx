import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bike, ChevronRight, Clock, Package, Store as StoreIcon, User } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles, tabularNums } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AppImage } from '../ui/AppImage';
import { StatusBadge } from './StatusBadge';
import type { AdminOrderRow } from '../../services/repositories/adminRepository';
import { formatMoney, formatOrderDateTime, formatPhone, itemCountText, mainLineTitle, moreItemsText, type OrderPreview } from '../../services/adminOrderView';
import { shortStoreName } from '../../services/serviceability';

interface Props {
  order: AdminOrderRow;
  /** The order's real lines (main product + photo). undefined while loading, null when they could not be read. */
  preview: OrderPreview | null | undefined;
  onPress: () => void;
}

/**
 * One order as a card: the order number, status and total up top, the main product with its photo and a compact "+ N more"
 * underneath, then who it is for, which store fulfils it and when it was placed. Everything shown is stored data — if the
 * order's lines cannot be read the card says so instead of showing a made-up picture or name.
 */
export function OrderCard({ order, preview, onPress }: Props) {
  const main = preview?.main ?? null;
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.order_number}, ${order.customer_name}, ${formatMoney(order.total)}. Open details`}
    >
      <View style={styles.topRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.orderNumber} numberOfLines={1}>#{order.order_number}</Text>
          <View style={styles.inlineRow}>
            <Clock size={11} color={colors.textMuted} strokeWidth={ICON_STROKE} />
            <Text style={styles.dateText} numberOfLines={1}>{formatOrderDateTime(order.placed_at)}</Text>
          </View>
        </View>
        {order.awaiting_payment ? (
          <View style={styles.awaitingBadge}>
            <Text style={styles.awaitingBadgeText}>Awaiting payment</Text>
          </View>
        ) : (
          <StatusBadge status={order.status} />
        )}
      </View>

      <View style={styles.productRow}>
        <AppImage uri={main?.image ?? null} style={styles.thumb} fallbackIcon={Package} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {preview === undefined ? (
            <Text style={styles.mutedLine}>Loading items…</Text>
          ) : main ? (
            <>
              <Text style={styles.productName} numberOfLines={2}>{mainLineTitle(main)}</Text>
              <Text style={styles.mutedLine} numberOfLines={1}>
                {main.quantity > 1 ? `Qty ${main.quantity}` : 'Qty 1'}
                {preview && preview.moreLines > 0 ? `  ·  ${moreItemsText(preview.moreLines)}` : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.mutedLine}>Items unavailable</Text>
          )}
        </View>
        <View style={styles.totalCol}>
          <Text style={styles.total} numberOfLines={1}>{formatMoney(order.total)}</Text>
          <Text style={styles.itemCount} numberOfLines={1}>{itemCountText(order.item_count)}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.metaBlock}>
        <View style={styles.inlineRow}>
          <User size={ICON_SIZE.xs} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          <Text style={styles.metaText} numberOfLines={1}>
            {order.customer_name}{order.customer_phone ? `  ·  ${formatPhone(order.customer_phone)}` : ''}
          </Text>
        </View>
        <View style={styles.inlineRow}>
          <StoreIcon size={ICON_SIZE.xs} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          <Text style={styles.metaText} numberOfLines={1}>{shortStoreName(order.store_name)}</Text>
        </View>
        {!!order.rider_name && (
          <View style={styles.inlineRow}>
            <Bike size={ICON_SIZE.xs} color={colors.textMuted} strokeWidth={ICON_STROKE} />
            <Text style={styles.metaText} numberOfLines={1}>Rider: {order.rider_name}</Text>
          </View>
        )}
      </View>

      <View style={styles.chevron} pointerEvents="none">
        <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, paddingRight: spacing.xl, gap: spacing.sm, borderWidth: 1, borderColor: colors.border, ...shadows.xs },
  cardPressed: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  orderNumber: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary, ...tabularNums },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  dateText: { ...textStyles.caption, fontSize: 11.5, color: colors.textMuted, flexShrink: 1 },
  awaitingBadge: { backgroundColor: colors.warningTint, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  awaitingBadgeText: { ...textStyles.caption, color: colors.warning, fontFamily: 'PlusJakartaSans_700Bold' },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.surfaceSunken },
  productName: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  mutedLine: { ...textStyles.caption, color: colors.textSecondary },
  totalCol: { alignItems: 'flex-end', flexShrink: 0 },
  // Never wraps: a long amount was breaking onto two lines ("₹1,00 / 0") in the old narrow column.
  total: { ...textStyles.cardTitle, fontSize: 15, color: colors.textPrimary, ...tabularNums },
  itemCount: { ...textStyles.caption, fontSize: 11.5, color: colors.textMuted },
  divider: { height: 1, backgroundColor: colors.divider },
  metaBlock: { gap: 4 },
  metaText: { ...textStyles.caption, color: colors.textSecondary, flexShrink: 1 },
  chevron: { position: 'absolute', right: spacing.sm, top: 0, bottom: 0, justifyContent: 'center' },
});
