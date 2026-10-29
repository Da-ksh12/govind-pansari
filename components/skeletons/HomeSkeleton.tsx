import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { radius, spacing } from '../../theme';
import { Skeleton } from '../ui/Skeleton';

/** `showHeader={false}` when the real header (location + cart + bell) is already on screen above the skeleton. */
export function HomeSkeleton({ showHeader = true }: { showHeader?: boolean }) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {showHeader && (
        <View style={styles.headerRow}>
          <Skeleton width={36} height={36} borderRadius={18} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width={100} height={10} />
            <Skeleton width={160} height={14} />
          </View>
          <Skeleton width={40} height={40} borderRadius={20} />
        </View>
      )}
      <Skeleton height={48} borderRadius={radius.pill} style={{ marginTop: spacing.md }} />
      <Skeleton height={190} borderRadius={radius.lg} style={{ marginTop: spacing.lg }} />
      <View style={styles.circleRow}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width={64} height={64} borderRadius={32} />
        ))}
      </View>
      <View style={styles.cardRow}>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} width={168} height={260} borderRadius={radius.md} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.base, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  circleRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg },
  cardRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
});
