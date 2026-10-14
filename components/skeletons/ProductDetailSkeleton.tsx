import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { radius, spacing } from '../../theme';
import { Skeleton } from '../ui/Skeleton';

export function ProductDetailSkeleton() {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Skeleton height={340} borderRadius={0} />
      <View style={styles.body}>
        <Skeleton width={90} height={12} />
        <Skeleton width="80%" height={22} style={{ marginTop: spacing.sm }} />
        <Skeleton width={140} height={16} style={{ marginTop: spacing.sm }} />
        <View style={styles.pillRow}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} width={72} height={40} borderRadius={radius.md} />
          ))}
        </View>
        <Skeleton width="100%" height={52} borderRadius={radius.md} style={{ marginTop: spacing.xl }} />
        <Skeleton width="100%" height={14} style={{ marginTop: spacing.xl }} />
        <Skeleton width="90%" height={14} style={{ marginTop: spacing.sm }} />
        <Skeleton width="60%" height={14} style={{ marginTop: spacing.sm }} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xxl },
  body: { paddingHorizontal: spacing.base, paddingTop: spacing.lg },
  pillRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
});
