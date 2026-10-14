import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { colors, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';

interface RatingProps {
  value: number;
  count?: number;
  size?: number;
  showCount?: boolean;
}

export function Rating({ value, count, size = ICON_SIZE.xs, showCount = true }: RatingProps) {
  // A product with genuinely zero reviews rendered "0.0 (0)" — reads
  // as a real bad rating, not "no reviews yet". Only show a rating
  // once real review data exists (search/discovery brief: "rating if
  // real data exists" — never a fabricated-looking placeholder score).
  if (count === 0) return null;
  return (
    <View style={styles.row}>
      <Star size={size} color={colors.gold} strokeWidth={ICON_STROKE} fill={colors.gold} />
      <Text style={styles.value}>{value.toFixed(1)}</Text>
      {showCount && count !== undefined && (
        <Text style={styles.count}>({count >= 1000 ? `${(count / 1000).toFixed(1)}K` : count})</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  value: { ...textStyles.caption, color: colors.textPrimary, fontSize: 12 },
  count: { ...textStyles.caption, color: colors.textSecondary, fontSize: 12 },
});
