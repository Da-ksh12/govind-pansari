import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, Bookmark, Minus, Plus, RotateCcw, X } from 'lucide-react-native';
import Animated, { FadeOutRight } from 'react-native-reanimated';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AppImage } from '../ui/AppImage';
import { discountPercent, formatINR } from '../ui/PriceBlock';
import { useCartStore } from '../../store/cartStore';
import { AnimatedPressable } from '../motion/AnimatedPressable';
import { AnimatedNumber } from '../motion/AnimatedNumber';
import { GPConfirmModal } from '../ui/modals/GPModal';
import type { CartLine } from '../../hooks/useCartLines';

interface CartLineRowProps {
  line: CartLine;
  savedForLater?: boolean;
  /** Freshly checked against the live catalogue (see app/cart.tsx) — undefined while that check hasn't loaded yet. */
  unavailable?: boolean;
  priceChange?: { oldPrice: number; newPrice: number };
}

export function CartLineRow({ line, savedForLater = false, unavailable, priceChange }: CartLineRowProps) {
  const setQuantity = useCartStore((s) => s.setQuantity);
  const removeItem = useCartStore((s) => s.removeItem);
  const saveForLater = useCartStore((s) => s.saveForLater);
  const moveToCart = useCartStore((s) => s.moveToCart);
  const removeSaved = useCartStore((s) => s.removeSaved);
  const [rollDirection, setRollDirection] = React.useState<'up' | 'down'>('up');
  const [removeModalOpen, setRemoveModalOpen] = useState(false);

  const pct = discountPercent(line.variant.mrp, line.variant.price);

  const confirmRemove = () => {
    setRemoveModalOpen(false);
    if (savedForLater) removeSaved(line.cartItemId);
    else removeItem(line.cartItemId);
  };

  const removeConfirmModal = (
    <GPConfirmModal
      visible={removeModalOpen}
      onClose={() => setRemoveModalOpen(false)}
      destructive
      image={line.product.images[0]}
      title={`Remove ${line.product.name}?`}
      message={`${line.variant.label} · ${formatINR(line.variant.price)}`}
      primaryLabel="Remove"
      onPressPrimary={confirmRemove}
      secondaryLabel="Keep Item"
      onPressSecondary={() => setRemoveModalOpen(false)}
    />
  );

  if (unavailable) {
    return (
      <Animated.View exiting={FadeOutRight.duration(200)} style={styles.row}>
        <AppImage uri={line.product.images[0]} style={[styles.image, styles.imageDimmed]} contentFit="cover" kind="product" />
        <View style={styles.info}>
          <Text numberOfLines={1} style={[styles.name, styles.dimmedText]}>
            {line.product.name}
          </Text>
          <Text style={styles.variant}>{line.variant.label}</Text>
          <View style={styles.unavailableChip}>
            <AlertTriangle size={12} color={colors.error} strokeWidth={ICON_STROKE} />
            <Text style={styles.unavailableChipText}>Currently unavailable</Text>
          </View>
        </View>
        <Pressable onPress={() => removeItem(line.cartItemId)} hitSlop={8} style={styles.removeBtn}>
          <X size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Animated.View exiting={FadeOutRight.duration(200)} style={styles.row}>
      {removeConfirmModal}
      <AppImage uri={line.product.images[0]} style={styles.image} contentFit="cover" kind="product" />
      <View style={styles.info}>
        <Text numberOfLines={1} style={styles.name}>
          {line.product.name}
        </Text>
        <Text style={styles.variant}>{line.variant.label}</Text>
        {priceChange && (
          <View style={styles.priceChangeRow}>
            <AlertTriangle size={11} color={colors.gold} strokeWidth={ICON_STROKE} />
            <Text style={styles.priceChangeText}>
              Price updated: {formatINR(priceChange.oldPrice)} → {formatINR(priceChange.newPrice)}
            </Text>
          </View>
        )}
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatINR(line.variant.price)}</Text>
          {pct > 0 && <Text style={styles.mrp}>{formatINR(line.variant.mrp)}</Text>}
          {pct > 0 && <Text style={styles.discount}>{pct}% OFF</Text>}
        </View>

        {!savedForLater ? (
          <View style={styles.bottomRow}>
            <View style={styles.stepper}>
              <AnimatedPressable
                onPress={() => {
                  setRollDirection('down');
                  setQuantity(line.cartItemId, line.quantity - 1);
                }}
                hitSlop={8}
                pressScale={0.85}
                style={styles.stepBtn}
              >
                <Minus size={14} color={colors.primary} strokeWidth={ICON_STROKE} />
              </AnimatedPressable>
              <AnimatedNumber value={String(line.quantity)} direction={rollDirection} style={styles.qty} />
              <AnimatedPressable
                onPress={() => {
                  setRollDirection('up');
                  setQuantity(line.cartItemId, line.quantity + 1);
                }}
                hitSlop={8}
                pressScale={0.85}
                style={styles.stepBtn}
              >
                <Plus size={14} color={colors.primary} strokeWidth={ICON_STROKE} />
              </AnimatedPressable>
            </View>
            <Pressable style={styles.saveBtn} onPress={() => saveForLater(line.cartItemId)}>
              <Bookmark size={13} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
              <Text style={styles.saveBtnText}>Save for later</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.bottomRow}>
            <Pressable style={styles.moveBtn} onPress={() => moveToCart(line.cartItemId)}>
              <RotateCcw size={13} color={colors.primary} strokeWidth={ICON_STROKE} />
              <Text style={styles.moveBtnText}>Move to cart</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Pressable onPress={() => setRemoveModalOpen(true)} hitSlop={8} style={styles.removeBtn}>
        <X size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  image: { width: 76, height: 76, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  imageDimmed: { opacity: 0.4 },
  dimmedText: { color: colors.textMuted },
  info: { flex: 1 },
  name: { ...textStyles.cardTitle, color: colors.textPrimary },
  variant: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  unavailableChip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
  unavailableChipText: { ...textStyles.caption, color: colors.error, fontFamily: 'PlusJakartaSans_600SemiBold' },
  priceChangeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  priceChangeText: { ...textStyles.caption, color: colors.goldDark, fontSize: 11 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs, marginTop: 4 },
  price: { ...textStyles.cardTitle, color: colors.textPrimary },
  mrp: { ...textStyles.caption, color: colors.textMuted, textDecorationLine: 'line-through' },
  discount: { ...textStyles.caption, color: colors.error, fontFamily: 'PlusJakartaSans_700Bold' },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  stepBtn: { padding: 2 },
  qty: { ...textStyles.cardTitle, color: colors.primary, minWidth: 16, textAlign: 'center' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  saveBtnText: { ...textStyles.caption, color: colors.textSecondary },
  moveBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  moveBtnText: { ...textStyles.caption, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  removeBtn: { alignSelf: 'flex-start' },
});
