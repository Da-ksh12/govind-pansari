import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, textStyles } from '../../theme';

export function formatINR(value: number) {
  // Defensive: a bad/missing numeric field from a jsonb RPC response
  // (TypeScript's `number` type isn't enforced at runtime) used to crash
  // this on `.toLocaleString()` with no fallback — one bad value would
  // take down whatever screen rendered it.
  if (!Number.isFinite(value)) return '₹—';
  return `₹${value.toLocaleString('en-IN')}`;
}

export function discountPercent(mrp: number, price: number) {
  if (mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

interface PriceBlockProps {
  price: number;
  mrp?: number;
  size?: 'sm' | 'lg';
}

export function PriceBlock({ price, mrp, size = 'sm' }: PriceBlockProps) {
  const showDiscount = mrp && mrp > price;
  return (
    <View>
      <View style={styles.row}>
        <Text style={size === 'lg' ? textStyles.priceLarge : textStyles.price}>{formatINR(price)}</Text>
        {showDiscount && <Text style={styles.strike}>{formatINR(mrp)}</Text>}
      </View>
      {/* Always its own line, never sharing the price row — letting it
          wrap inline with price/MRP (the previous behavior) made the
          wrap point depend on each card's available width, so some
          cards showed "% OFF" inline and others pushed it below,
          giving same-row grid cards inconsistent heights. */}
      {showDiscount && <Text style={styles.off}>{discountPercent(mrp, price)}% OFF</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  strike: {
    ...textStyles.strikePrice,
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  off: {
    ...textStyles.bodySmall,
    color: colors.error,
    fontFamily: 'PlusJakartaSans_700Bold',
    marginTop: 1,
  },
});
