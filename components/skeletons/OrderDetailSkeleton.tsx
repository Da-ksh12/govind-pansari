import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { radius, spacing } from '../../theme';
import { Skeleton } from '../ui/Skeleton';

export function OrderDetailSkeleton() {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Skeleton width={120} height={14} />
        <Skeleton width="100%" height={40} style={{ marginTop: spacing.md }} />
      </View>
      <View style={styles.card}>
        <Skeleton width={100} height={14} />
        {Array.from({ length: 2 }).map((_, i) => (
          <View key={i} style={styles.itemRow}>
            <Skeleton width={48} height={48} borderRadius={radius.sm} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width="70%" height={12} />
              <Skeleton width="40%" height={10} />
            </View>
          </View>
        ))}
      </View>
      <View style={styles.card}>
        <Skeleton width={140} height={14} />
        <Skeleton width="90%" height={12} style={{ marginTop: spacing.sm }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.base, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  card: { backgroundColor: 'transparent', borderRadius: radius.md, marginBottom: spacing.md, gap: spacing.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
});
