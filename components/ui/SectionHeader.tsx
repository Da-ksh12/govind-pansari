import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { colors, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';

interface SectionHeaderProps {
  title: string;
  onPressViewAll?: () => void;
}

export function SectionHeader({ title, onPressViewAll }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {onPressViewAll && (
        <Pressable onPress={onPressViewAll} style={styles.viewAll} hitSlop={8}>
          <Text style={styles.viewAllText}>View all</Text>
          <ChevronRight size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    marginBottom: spacing.md,
  },
  title: { ...textStyles.sectionTitle, color: colors.textPrimary },
  viewAll: { flexDirection: 'row', alignItems: 'center' },
  viewAllText: { ...textStyles.bodySmall, color: colors.primary, fontFamily: 'PlusJakartaSans_600SemiBold' },
});
