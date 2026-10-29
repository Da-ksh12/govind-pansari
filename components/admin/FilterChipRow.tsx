import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors, radius, spacing, textStyles } from '../../theme';

export interface ChipOption {
  key: string;
  label: string;
}

interface Props {
  options: ChipOption[];
  selected: string;
  onSelect: (key: string) => void;
}

/**
 * One line of filter chips that scrolls sideways. The old wrapping rows used three or four lines of a phone screen before the
 * first result appeared; this one always takes a single line, whatever the number of filters.
 */
export function FilterChipRow({ options, selected, onSelect }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
      {options.map((option) => {
        const active = option.key === selected;
        return (
          <Pressable
            key={option.key}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Filter: ${option.label}`}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingRight: spacing.lg },
  chip: { minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.primary },
  chipText: { ...textStyles.caption, fontSize: 12.5, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  chipTextActive: { color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
});
