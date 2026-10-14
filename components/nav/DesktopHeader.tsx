import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Bell, ChevronDown, MapPin, Search, ShoppingBag, User } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { Monogram } from '../brand/Wordmark';
import { useLocationStore } from '../../store/locationStore';
import { useCartStore } from '../../store/cartStore';
import { useNotificationsStore } from '../../store/notificationsStore';

const NAV_LINKS: { label: string; href: string; match: string }[] = [
  { label: 'Categories', href: '/(tabs)/categories', match: '/categories' },
  { label: 'Orders', href: '/(tabs)/orders', match: '/orders' },
];

/**
 * Desktop-first navigation chrome (section 5) — a persistent top header
 * replacing the mobile bottom tab bar on wide viewports. Same routes,
 * same screens, same data underneath (section 46/48) — this only
 * changes how a wide viewport gets to them. Mounted alongside
 * `Tabs`/`BottomTabBar` in `app/(tabs)/_layout.tsx`, not a parallel
 * navigation stack.
 */
export function DesktopHeader() {
  const selected = useLocationStore((s) => s.selected);
  const cartCount = useCartStore((s) => s.items.filter((i) => !i.savedForLater).reduce((sum, i) => sum + i.quantity, 0));
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const pathname = usePathname();
  const [query, setQuery] = useState('');

  const submitSearch = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- query param on an existing typed route
    router.push({ pathname: '/(tabs)/search', params: query.trim() ? { q: query.trim() } : undefined } as any);
  };

  return (
    <View style={styles.header}>
      <View style={styles.inner}>
        <Pressable onPress={() => router.push('/(tabs)')} style={styles.logoWrap}>
          <Monogram size={44} onDark={false} />
        </Pressable>

        <Pressable style={styles.locationBlock} onPress={() => router.push('/location')}>
          <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
          <View>
            <Text style={styles.deliverToLabel}>Deliver to</Text>
            <View style={styles.deliverToRow}>
              <Text style={styles.deliverToValue} numberOfLines={1}>{selected?.label ?? 'Select location'}</Text>
              <ChevronDown size={14} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
            </View>
          </View>
        </Pressable>

        <View style={styles.searchBox}>
          <Search size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search dry fruits, snacks & more..."
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.primary}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submitSearch}
            returnKeyType="search"
          />
        </View>

        <View style={styles.navLinks}>
          {NAV_LINKS.map((link) => (
            <Pressable key={link.href} onPress={() => router.push(link.href as never)}>
              <Text style={[styles.navLinkText, pathname.startsWith(link.match) && styles.navLinkTextActive]}>{link.label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable style={styles.bellBtn} onPress={() => router.push('/notifications')} hitSlop={8}>
          <Bell size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
          {unreadCount > 0 && <View style={styles.bellBadge} />}
        </Pressable>

        <Pressable style={styles.iconLink} onPress={() => router.push('/(tabs)/profile')}>
          <User size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
          <Text style={styles.iconLinkText}>Account</Text>
        </Pressable>

        <Pressable style={styles.cartBtn} onPress={() => router.push('/cart')}>
          <ShoppingBag size={ICON_SIZE.md} color={colors.white} strokeWidth={ICON_STROKE} />
          <Text style={styles.cartBtnText}>Cart</Text>
          {cartCount > 0 && (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{cartCount}</Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, ...shadows.xs },
  inner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.lg,
    maxWidth: 1280, width: '100%', alignSelf: 'center',
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
  logoWrap: { marginRight: spacing.sm },
  locationBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: 180 },
  deliverToLabel: { ...textStyles.caption, color: colors.textSecondary, fontSize: 10.5 },
  deliverToRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  deliverToValue: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold', maxWidth: 150 },
  searchBox: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surfaceSunken, borderRadius: radius.pill,
    paddingHorizontal: spacing.base, height: 44, maxWidth: 480,
  },
  searchInput: { flex: 1, ...textStyles.bodySmall, color: colors.textPrimary, outlineStyle: 'none' as never },
  navLinks: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  navLinkText: { ...textStyles.bodySmall, color: colors.textSecondary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  navLinkTextActive: { color: colors.primary },
  bellBtn: { position: 'relative' },
  bellBadge: {
    position: 'absolute', top: -3, right: -3, width: 9, height: 9, borderRadius: 5,
    backgroundColor: colors.error, borderWidth: 1.5, borderColor: colors.surface,
  },
  iconLink: { alignItems: 'center', gap: 2 },
  iconLinkText: { ...textStyles.caption, color: colors.textPrimary, fontSize: 11 },
  cartBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.base, height: 42, position: 'relative' },
  cartBtnText: { ...textStyles.button, color: colors.white, fontSize: 13 },
  cartBadge: { position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  cartBadgeText: { fontSize: 10, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
});
