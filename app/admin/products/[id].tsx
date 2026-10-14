import React, { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { colors } from '../../../theme';
import { AdminShell } from '../../../components/admin/AdminShell';
import { ProductWizard } from '../../../components/admin/ProductWizard';
import { EmptyState } from '../../../components/ui/EmptyState';
import { adminRepository, type AdminProductDetail } from '../../../services/repositories/adminRepository';

export default function AdminEditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<AdminProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(false);
    adminRepository.getProduct(id).then(setProduct).catch(() => setError(true)).finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(load);

  return (
    <AdminShell title={product?.name ?? 'Edit Product'} subtitle="Update product details, variants and inventory">
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error || !product ? (
        <EmptyState title="Couldn't load this product" subtitle="It may have been removed." ctaLabel="Retry" onPressCta={load} />
      ) : (
        <ProductWizard mode="edit" productId={product.id} initial={product} key={product.id} />
      )}
    </AdminShell>
  );
}
