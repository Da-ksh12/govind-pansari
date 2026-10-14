import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { formatINR } from '../ui/PriceBlock';

interface RevenueChartProps {
  data: { day: string; revenue: number; orders: number }[];
}

/**
 * A real proportional bar chart (bar height = actual revenue / max
 * revenue in the series) — no charting library, just flex heights, so
 * there's nothing to misrepresent. Tapping a bar reveals its exact
 * figures instead of always showing dense labels.
 */
export function RevenueChart({ data }: RevenueChartProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const active = selected !== null ? data[selected] : data[data.length - 1];

  return (
    <View>
      {active && (
        <View style={styles.readout}>
          <Text style={styles.readoutValue}>{formatINR(active.revenue)}</Text>
          <Text style={styles.readoutMeta}>
            {new Date(active.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} • {active.orders} order{active.orders === 1 ? '' : 's'}
          </Text>
        </View>
      )}
      <View style={styles.chart}>
        {data.map((d, i) => {
          const heightPct = Math.max((d.revenue / max) * 100, d.revenue > 0 ? 4 : 1.5);
          const isActive = (selected === null ? i === data.length - 1 : i === selected);
          return (
            <Pressable key={d.day} style={styles.barCol} onPress={() => setSelected(i)}>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { height: `${heightPct}%` }, isActive && styles.barActive]} />
              </View>
              <Text style={[styles.barLabel, isActive && styles.barLabelActive]}>
                {new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).replace(' ', '\n')}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { marginBottom: spacing.md },
  readoutValue: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 24, color: colors.textPrimary },
  readoutMeta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 160, gap: 4 },
  barCol: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '60%', minWidth: 4, backgroundColor: colors.goldTint, borderTopLeftRadius: radius.xs, borderTopRightRadius: radius.xs },
  barActive: { backgroundColor: colors.primary },
  barLabel: { ...textStyles.caption, fontSize: 9, color: colors.textMuted, textAlign: 'center', marginTop: 6, lineHeight: 11 },
  barLabelActive: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
});
