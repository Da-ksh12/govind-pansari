import React from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Grid2x2 } from 'lucide-react-native';
import { router } from 'expo-router';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import type { Category } from '../../types/models';

interface CategoryRailProps {
  categories: Category[];
}

const CIRCLE = 64;

export function CategoryRail({ categories }: CategoryRailProps) {
  const data = [...categories, null]; // null renders the trailing "All" tile

  return (
    <FlatList
      horizontal
      data={data}
      keyExtractor={(item, index) => item?.id ?? `all-${index}`}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      renderItem={({ item }) =>
        item ? (
          <Pressable style={styles.item} onPress={() => router.push(`/category/${item.slug}`)}>
            <View style={styles.circle}>
              <Image source={{ uri: item.thumbnail }} style={styles.image} contentFit="cover" />
            </View>
            <Text numberOfLines={1} style={styles.label}>
              {item.name}
            </Text>
          </Pressable>
        ) : (
          <Pressable style={styles.item} onPress={() => router.push('/(tabs)/categories')}>
            <View style={[styles.circle, styles.moreCircle]}>
              <Grid2x2 size={ICON_SIZE.lg} color={colors.primary} strokeWidth={ICON_STROKE} />
            </View>
            <Text numberOfLines={1} style={styles.label}>
              More
            </Text>
          </Pressable>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.base, gap: spacing.lg },
  item: { alignItems: 'center', width: CIRCLE + 8 },
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    borderRadius: CIRCLE / 2,
    overflow: 'hidden',
    backgroundColor: colors.surfaceSunken,
  },
  moreCircle: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryTint },
  image: { width: '100%', height: '100%' },
  label: { ...textStyles.caption, color: colors.textPrimary, marginTop: spacing.xs, textAlign: 'center' },
});
