import React from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { spacing } from '../../theme';
import { SectionHeader } from '../ui/SectionHeader';
import { ProductCard } from './ProductCard';
import type { Product } from '../../types/models';

interface ProductRailProps {
  title: string;
  products: Product[];
  onPressViewAll?: () => void;
}

export function ProductRail({ title, products, onPressViewAll }: ProductRailProps) {
  if (products.length === 0) return null;
  return (
    <>
      <SectionHeader title={title} onPressViewAll={onPressViewAll} />
      <FlatList
        horizontal
        data={products}
        keyExtractor={(item) => item.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.content}
        renderItem={({ item }) => <ProductCard product={item} />}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.base, gap: spacing.md },
});
