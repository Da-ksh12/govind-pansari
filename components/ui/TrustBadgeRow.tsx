import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PackageCheck, RotateCcw, ShieldCheck, Truck } from 'lucide-react-native';
import { colors, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';

const ITEMS = [
  { icon: ShieldCheck, title: '100% Quality', subtitle: 'Handpicked & fresh' },
  { icon: Truck, title: 'Fast Delivery', subtitle: '25–35 min' },
  { icon: PackageCheck, title: 'Secure Packaging', subtitle: 'Hygienic & safe' },
  { icon: RotateCcw, title: 'Easy Returns', subtitle: 'Within 7 days' },
];

export function TrustBadgeRow() {
  return (
    <View style={styles.row}>
      {ITEMS.map((item) => (
        <View key={item.title} style={styles.item}>
          <item.icon size={ICON_SIZE.lg} color={colors.primary} strokeWidth={ICON_STROKE} />
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.subtitle}>{item.subtitle}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: spacing.base, gap: spacing.sm },
  item: { flex: 1, alignItems: 'center', gap: 2 },
  title: { ...textStyles.caption, color: colors.textPrimary, fontSize: 11, textAlign: 'center', marginTop: 4 },
  subtitle: { ...textStyles.caption, color: colors.textSecondary, fontSize: 10, textAlign: 'center' },
});
