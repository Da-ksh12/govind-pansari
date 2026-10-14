import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Boxes, ClipboardList, Clock, LayoutDashboard, LogOut, Store } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { useAuthStore } from '../../store/authStore';
import { useStoreOpsStore } from '../../store/storeOpsStore';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/store', icon: LayoutDashboard, match: (p: string) => p === '/store' },
  { label: 'Orders', href: '/store/orders', icon: ClipboardList, match: (p: string) => p.startsWith('/store/orders') },
  { label: 'Inventory', href: '/store/inventory', icon: Boxes, match: (p: string) => p.startsWith('/store/inventory') },
  { label: 'Activity', href: '/store/activity', icon: Clock, match: (p: string) => p.startsWith('/store/activity') },
  { label: 'Store Profile', href: '/store/profile', icon: Store, match: (p: string) => p.startsWith('/store/profile') },
];

/**
 * Desktop-first shell for the Store Manager surface (section 27/28) —
 * same layout-level swap pattern as the customer app's DesktopHeader:
 * StoreTabBar hides on wide viewports, this sidebar takes over. Same
 * `Tabs` navigator, same screens, same storeOpsRepository underneath —
 * only the navigation chrome differs by viewport, per this phase's own
 * "not a rebuild" instruction.
 */
export function StoreDesktopSidebar() {
  const pathname = usePathname();
  const profile = useAuthStore((s) => s.profile);
  const logout = useAuthStore((s) => s.logout);
  const activeStoreId = useStoreOpsStore((s) => s.activeStoreId);
  const myStores = useStoreOpsStore((s) => s.myStores);
  const storeName = myStores.find((s) => s.storeId === activeStoreId)?.storeName ?? '';

  return (
    <View style={styles.sidebar}>
      <View style={styles.header}>
        <Text style={styles.brand}>GOVIND PANSARI</Text>
        <Text style={styles.storeName} numberOfLines={1}>{storeName}</Text>
      </View>
      <View style={styles.navList}>
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          return (
            <Pressable key={item.href} style={[styles.navItem, active && styles.navItemActive]} onPress={() => router.push(item.href as never)}>
              <item.icon size={ICON_SIZE.sm} color={active ? colors.primary : colors.textSecondary} strokeWidth={ICON_STROKE} />
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.footer}>
        <Text style={styles.footerName} numberOfLines={1}>{profile?.name ?? 'Store Staff'}</Text>
        <Pressable style={styles.logoutRow} onPress={() => logout()}>
          <LogOut size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: { width: 220, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.divider },
  header: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  brand: { ...textStyles.caption, color: colors.textMuted, letterSpacing: 1.2, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11 },
  storeName: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 16, color: colors.textPrimary, marginTop: 2 },
  navList: { flex: 1, paddingVertical: spacing.sm },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  navItemActive: { backgroundColor: colors.primaryTint },
  navLabel: { ...textStyles.bodySmall, color: colors.textSecondary, fontSize: 13 },
  navLabelActive: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  footerName: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  logoutRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  logoutText: { ...textStyles.caption, color: colors.error, fontFamily: 'PlusJakartaSans_600SemiBold' },
});
