import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import type { OrderStatus } from '../../types/models';

const STATUS_META: Record<OrderStatus, { label: string; bg: string; text: string }> = {
  placed: { label: 'Order Placed', bg: colors.infoTint, text: colors.info },
  confirmed: { label: 'Confirmed', bg: colors.infoTint, text: colors.info },
  preparing: { label: 'Preparing', bg: colors.warningTint, text: colors.warning },
  // Store-internal sub-phases (Phase 07) — shown to the customer with
  // the same "Preparing" copy as `preparing`, no new customer-visible
  // status language per section 39.
  picking: { label: 'Preparing', bg: colors.warningTint, text: colors.warning },
  packing: { label: 'Preparing', bg: colors.warningTint, text: colors.warning },
  packed: { label: 'Packed', bg: colors.warningTint, text: colors.warning },
  rider_assigned: { label: 'Rider Assigned', bg: colors.primaryTint, text: colors.primary },
  out_for_delivery: { label: 'Out for Delivery', bg: colors.primaryTint, text: colors.primary },
  arriving: { label: 'Arriving Soon', bg: colors.primaryTint, text: colors.primary },
  delivered: { label: 'Delivered', bg: colors.successTint, text: colors.success },
  cancelled: { label: 'Cancelled', bg: colors.errorTint, text: colors.error },
};

export function OrderStatusPill({ status }: { status: OrderStatus }) {
  // Defensive fallback — a status this map doesn't recognize (a
  // future enum value, or a raw DB spelling that slipped through
  // untranslated) must never crash this component, just show plainly.
  const meta = STATUS_META[status] ?? { label: status, bg: colors.surfaceSunken, text: colors.textSecondary };
  return (
    <View style={[styles.pill, { backgroundColor: meta.bg }]}>
      <Text style={[styles.text, { color: meta.text }]}>{meta.label}</Text>
    </View>
  );
}

export { STATUS_META };

const styles = StyleSheet.create({
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  text: { ...textStyles.caption, fontFamily: 'PlusJakartaSans_700Bold' },
});
