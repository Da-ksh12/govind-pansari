import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { colors, spacing } from '../../theme';

interface StarRatingInputProps {
  value: number;
  onChange: (value: number) => void;
  size?: number;
  disabled?: boolean;
}

/** The tappable counterpart to the read-only `Rating` display component — five real hitboxes, not five decorative icons. */
export function StarRatingInput({ value, onChange, size = 28, disabled }: StarRatingInputProps) {
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} onPress={() => !disabled && onChange(n)} hitSlop={6} disabled={disabled}>
          <Star size={size} color={colors.gold} strokeWidth={1.8} fill={n <= value ? colors.gold : 'transparent'} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.xs },
});
