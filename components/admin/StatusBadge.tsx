import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, textStyles } from '../../theme';

/**
 * One shared status-color mapping for every admin list/detail screen
 * (orders, deliveries, riders, products, invites) — previously every
 * screen hand-rolled its own generic gray pill. Semantic, not
 * decorative: color communicates "needs attention" vs "in progress"
 * vs "done", matching every order_status/delivery status value that
 * actually exists in the schema (20260825000001_extensions_and_types.sql).
 */
const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  // Orders
  placed: { bg: colors.infoTint, fg: colors.info },
  confirmed: { bg: colors.goldTint, fg: colors.goldDark },
  preparing: { bg: colors.goldTint, fg: colors.goldDark },
  packed: { bg: colors.sageTint, fg: colors.sage },
  rider_assigned: { bg: colors.sageTint, fg: colors.sage },
  out_for_delivery: { bg: colors.primaryTint, fg: colors.primary },
  approaching: { bg: colors.primaryTint, fg: colors.primary },
  delivered: { bg: colors.successTint, fg: colors.success },
  cancelled: { bg: colors.errorTint, fg: colors.error },
  // Delivery assignments
  assigned: { bg: colors.infoTint, fg: colors.info },
  accepted: { bg: colors.goldTint, fg: colors.goldDark },
  at_store: { bg: colors.goldTint, fg: colors.goldDark },
  picked_up: { bg: colors.sageTint, fg: colors.sage },
  in_transit: { bg: colors.primaryTint, fg: colors.primary },
  completed: { bg: colors.successTint, fg: colors.success },
  failed: { bg: colors.errorTint, fg: colors.error },
  declined: { bg: colors.errorTint, fg: colors.error },
  expired: { bg: colors.errorTint, fg: colors.error },
  // Generic
  active: { bg: colors.successTint, fg: colors.success },
  inactive: { bg: colors.surfaceSunken, fg: colors.textSecondary },
  pending: { bg: colors.warningTint, fg: colors.warning },
  // Inventory stock levels
  in_stock: { bg: colors.successTint, fg: colors.success },
  low_stock: { bg: colors.warningTint, fg: colors.warning },
  out_of_stock: { bg: colors.errorTint, fg: colors.error },
  // Rider availability
  online: { bg: colors.successTint, fg: colors.success },
  offline: { bg: colors.surfaceSunken, fg: colors.textMuted },
  available: { bg: colors.successTint, fg: colors.success },
  busy: { bg: colors.goldTint, fg: colors.goldDark },
};

const LABEL_OVERRIDE: Record<string, string> = {
  out_for_delivery: 'On the Way',
  rider_assigned: 'Rider Assigned',
  in_transit: 'On the Way',
  at_store: 'At Store',
  picked_up: 'Picked Up',
  packed: 'Ready',
  in_stock: 'In Stock',
  low_stock: 'Low Stock',
  out_of_stock: 'Out of Stock',
};

function formatLabel(status: string): string {
  if (LABEL_OVERRIDE[status]) return LABEL_OVERRIDE[status];
  return status
    .split('_')
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const style = STATUS_STYLE[status] ?? { bg: colors.surfaceSunken, fg: colors.textSecondary };
  return (
    <View style={[styles.pill, size === 'sm' && styles.pillSmall, { backgroundColor: style.bg }]}>
      <View style={[styles.dot, { backgroundColor: style.fg }]} />
      <Text style={[styles.text, size === 'sm' && styles.textSmall, { color: style.fg }]} numberOfLines={1}>
        {formatLabel(status)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.pill,
  },
  pillSmall: { paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  text: { ...textStyles.caption, fontSize: 11.5, fontFamily: 'PlusJakartaSans_700Bold' },
  textSmall: { fontSize: 10.5 },
});
