import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Package, Search, ShoppingBag, User, X } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { adminRepository } from '../../services/repositories/adminRepository';
import { formatINR } from '../ui/PriceBlock';

const DEBOUNCE_MS = 300;

interface ResultGroup {
  label: string;
  icon: typeof ShoppingBag;
  items: { id: string; title: string; subtitle: string }[];
}

/**
 * Real cross-entity search — orders/products/customers, each via the
 * existing tested repository search functions (getOrders/getProducts/
 * getCustomers), run in parallel. No new backend surface; this is
 * purely a client-side fan-out over what already exists.
 */
export function CommandSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<ResultGroup[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setGroups([]);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const [orders, products, customers] = await Promise.all([
          adminRepository.getOrders({ search: q, limit: 5 }).catch(() => []),
          adminRepository.getProducts({ search: q, limit: 5 }).catch(() => []),
          adminRepository.getCustomers(q, undefined, 5).catch(() => []),
        ]);
        const next: ResultGroup[] = [];
        if (orders.length) next.push({ label: 'Orders', icon: ShoppingBag, items: orders.map((o: any) => ({ id: o.id, title: `#${o.order_number}`, subtitle: `${o.customer_name} • ${formatINR(o.total)}` })) });
        if (products.length) next.push({ label: 'Products', icon: Package, items: products.map((p: any) => ({ id: p.id, title: p.name, subtitle: p.categories?.name ?? 'Uncategorised' })) });
        if (customers.length) next.push({ label: 'Customers', icon: User, items: customers.map((c: any) => ({ id: c.id, title: c.full_name ?? c.phone, subtitle: c.phone })) });
        setGroups(next);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const goTo = (group: ResultGroup, id: string) => {
    setOpen(false);
    setQuery('');
    if (group.label === 'Orders') router.push(`/admin/orders/${id}` as never);
    else if (group.label === 'Products') router.push(`/admin/products/${id}` as never);
    else router.push(`/admin/customers/${id}` as never);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <Search size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
        <TextInput
          style={styles.input}
          placeholder="Search orders, products, customers..."
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {loading && <ActivityIndicator size="small" color={colors.primary} />}
        {!loading && query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <X size={14} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          </Pressable>
        )}
      </View>

      {open && query.trim().length >= 2 && (
        <View style={styles.dropdown}>
          {groups.length === 0 && !loading ? (
            <Text style={styles.emptyText}>No results for "{query}"</Text>
          ) : (
            groups.map((group) => (
              <View key={group.label}>
                <Text style={styles.groupLabel}>{group.label}</Text>
                {group.items.map((item) => (
                  <Pressable key={item.id} style={styles.resultRow} onPress={() => goTo(group, item.id)}>
                    <group.icon size={ICON_SIZE.xs} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.resultSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, maxWidth: 420, position: 'relative' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceSunken,
    borderRadius: radius.pill, paddingHorizontal: spacing.base, height: 42,
  },
  input: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary, outlineStyle: 'none' as never },
  dropdown: {
    position: 'absolute', top: 48, left: 0, right: 0, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, zIndex: 20, ...shadows.lg,
  },
  emptyText: { ...textStyles.bodySmall, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.lg },
  groupLabel: { ...textStyles.caption, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 4 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  resultTitle: { ...textStyles.bodySmall, color: colors.textPrimary },
  resultSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
});
