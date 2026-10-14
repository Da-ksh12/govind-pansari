import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { badgeColors, colors, radius, spacing, textStyles } from '../../theme';
import type { ProductBadge } from '../../types/models';

const LABELS: Record<ProductBadge, string> = {
  bestseller: 'BESTSELLER',
  premium: 'PREMIUM',
  new: 'NEW',
  organic: 'ORGANIC',
  limited: 'LIMITED',
};

export function ProductBadgePill({ kind }: { kind: ProductBadge }) {
  const c = badgeColors[kind];
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: c.bg, borderColor: c.border ?? c.bg, borderWidth: c.border ? 1 : 0 },
      ]}
    >
      <Text style={[styles.text, { color: c.text }]}>{LABELS[kind]}</Text>
    </View>
  );
}

export function Chip({
  label,
  tone = 'neutral',
}: {
  label: string;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  // Same semantic status-color tokens every other screen uses (StatusBadge,
  // OrderStatusPill) — was hardcoded duplicate hex before, which could
  // silently drift from the theme's real success/warning colors.
  const toneStyle =
    tone === 'success'
      ? { bg: colors.successTint, text: colors.success }
      : tone === 'warning'
        ? { bg: colors.warningTint, text: colors.warning }
        : { bg: colors.surfaceSunken, text: colors.textSecondary };
  return (
    <View style={[styles.pill, { backgroundColor: toneStyle.bg }]}>
      <Text style={[styles.text, { color: toneStyle.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    ...textStyles.caption,
    letterSpacing: 0.4,
  },
});
