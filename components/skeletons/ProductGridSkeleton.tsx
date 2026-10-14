import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { radius, spacing } from '../../theme';
import { Skeleton } from '../ui/Skeleton';

interface ProductGridSkeletonProps {
  /** Category screens show a hero banner above the grid; needs/tag screens don't. */
  withHero?: boolean;
}

export function ProductGridSkeleton({ withHero = false }: ProductGridSkeletonProps) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      {withHero && <Skeleton height={200} borderRadius={0} />}
      <View style={styles.grid}>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} width={168} height={260} borderRadius={radius.md} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingBottom: spacing.xxl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, padding: spacing.base },
});
