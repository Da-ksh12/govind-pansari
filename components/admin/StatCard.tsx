import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles, tabularNums } from '../../theme';
import { duration } from '../../theme/motion';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AnimatedNumber } from '../motion/AnimatedNumber';
import type { LucideIcon } from 'lucide-react-native';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  tone?: 'default' | 'warning' | 'error' | 'success';
  onPress?: () => void;
  /** e.g. 12.4 for "+12.4% vs yesterday" — omit when there's no real comparison to show (never fabricate a trend). */
  trend?: number;
  trendLabel?: string;
  /** Icon beside the text instead of above it: about half the height — for list screens where the list, not the stats, is the point. */
  compact?: boolean;
}

const TONE_COLOR: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: colors.primary,
  warning: colors.warning,
  error: colors.error,
  success: colors.success,
};

export function StatCard({ label, value, icon: Icon, tone = 'default', onPress, trend, trendLabel = 'vs yesterday', compact }: StatCardProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => onPress && Animated.timing(scale, { toValue: 0.98, duration: duration.micro, useNativeDriver: true }).start();
  const pressOut = () => onPress && Animated.timing(scale, { toValue: 1, duration: duration.micro, useNativeDriver: true }).start();
  const trendPositive = (trend ?? 0) >= 0;

  return (
    <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} disabled={!onPress} style={{ flexGrow: 1, flexBasis: compact ? 140 : 160, minWidth: compact ? 140 : 160 }} accessibilityRole={onPress ? 'button' : undefined}>
      <Animated.View style={[styles.card, compact && styles.cardCompact, { transform: [{ scale }] }]}>
        {Icon && (
          <View style={[styles.iconChip, compact && styles.iconChipCompact, { backgroundColor: TONE_COLOR[tone] + '17' }]}>
            <Icon size={ICON_SIZE.sm} color={TONE_COLOR[tone]} strokeWidth={ICON_STROKE} />
          </View>
        )}
        <View style={compact ? styles.compactText : undefined}>
          <Text style={styles.label} numberOfLines={1}>{label}</Text>
          <AnimatedNumber value={String(value)} style={compact ? styles.valueCompact : styles.value} />
        </View>
        {trend !== undefined && !compact && (
          <View style={styles.trendRow}>
            {trendPositive ? (
              <ArrowUpRight size={13} color={colors.success} strokeWidth={2.5} />
            ) : (
              <ArrowDownRight size={13} color={colors.error} strokeWidth={2.5} />
            )}
            <Text style={[styles.trendText, { color: trendPositive ? colors.success : colors.error }]}>
              {Math.abs(trend).toFixed(1)}%
            </Text>
            <Text style={styles.trendLabel}>{trendLabel}</Text>
          </View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.base,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  cardCompact: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  iconChip: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  iconChipCompact: { width: 36, height: 36, marginBottom: 0 },
  compactText: { flex: 1, minWidth: 0 },
  valueCompact: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, lineHeight: 25, color: colors.textPrimary, ...tabularNums },
  label: { ...textStyles.caption, color: colors.textSecondary, fontSize: 12 },
  value: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, lineHeight: 30, color: colors.textPrimary, marginTop: 4, ...tabularNums },
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: spacing.sm },
  trendText: { ...textStyles.caption, fontSize: 11.5, fontFamily: 'PlusJakartaSans_700Bold' },
  trendLabel: { ...textStyles.caption, fontSize: 11, color: colors.textMuted },
});
