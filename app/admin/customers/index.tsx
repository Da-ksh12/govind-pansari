import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ChevronRight, Search, Users } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../../theme/icons';
import { AdminShell } from '../../../components/admin/AdminShell';
import { StatusBadge } from '../../../components/admin/StatusBadge';
import { Avatar } from '../../../components/ui/Avatar';
import { EmptyState } from '../../../components/ui/EmptyState';
import { formatINR } from '../../../components/ui/PriceBlock';
import { pushAdmin } from '../../../services/adminNav';
import { adminRepository, type AdminCustomerRow } from '../../../services/repositories/adminRepository';

export default function AdminCustomersScreen() {
  const [customers, setCustomers] = useState<AdminCustomerRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    adminRepository.getCustomers(search || undefined, undefined, 25).then((rows) => {
      setCustomers(rows);
      setHasMore(rows.length === 25);
    }).catch(() => setCustomers([])).finally(() => setLoading(false));
  }, [search]);

  useFocusEffect(load);

  const loadMore = () => {
    if (!hasMore || loadingMore || customers.length === 0) return;
    setLoadingMore(true);
    adminRepository.getCustomers(search || undefined, customers[customers.length - 1].created_at, 25).then((rows) => {
      setCustomers((prev) => [...prev, ...rows]);
      setHasMore(rows.length === 25);
    }).catch(() => {}).finally(() => setLoadingMore(false));
  };

  return (
    <AdminShell title="Customers" subtitle="Browse your customer base and order history">
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Search size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          <TextInput style={styles.searchInput} placeholder="Search by name, phone or email" placeholderTextColor={colors.textMuted} value={search} onChangeText={setSearch} onSubmitEditing={load} returnKeyType="search" />
        </View>
      </View>
      <FlatList
        style={{ flex: 1 }}
        data={customers}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.listContent}
        onEndReachedThreshold={0.4}
        onEndReached={loadMore}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={!loading ? <EmptyState icon={Users} title="No customers" subtitle="No customers match this search." /> : null}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ margin: spacing.lg }} color={colors.primary} /> : null}
        renderItem={({ item }) => (
          <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={() => pushAdmin(`/admin/customers/${item.id}`)}>
            <Avatar uri={item.avatar_url} name={item.full_name ?? '?'} size="sm" />
            <View style={{ flex: 1.3 }}>
              <Text style={styles.name}>{item.full_name ?? 'Unnamed'}</Text>
              <Text style={styles.meta}>{item.phone}</Text>
            </View>
            <View style={{ flex: 0.8, alignItems: 'flex-end' }}>
              <Text style={styles.spend}>{formatINR(item.total_spend)}</Text>
              <Text style={styles.meta}>{item.order_count} orders</Text>
            </View>
            {!item.is_active && <StatusBadge status="inactive" size="sm" />}
            <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          </Pressable>
        )}
      />
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  toolbar: { padding: spacing.lg, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, height: 44, maxWidth: 480 },
  searchInput: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary, outlineStyle: 'none' as never },
  listContent: { padding: spacing.lg, paddingTop: 0, gap: spacing.sm, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, ...shadows.xs,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted, borderColor: colors.borderStrong },
  name: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
  meta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  spend: { ...textStyles.cardTitle, fontSize: 14, color: colors.textPrimary },
});
