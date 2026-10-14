import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, usePathname } from 'expo-router';
import {
  LayoutDashboard, ShoppingBag, Package, FolderTree, Boxes, Store as StoreIcon,
  Bike, Truck, Users, UserCog, ScrollText, Settings as SettingsIcon, LogOut, Bell,
  PanelLeftClose, PanelLeftOpen, BarChart3, MoreHorizontal, X, FlaskConical,
} from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { duration } from '../../theme/motion';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { useAdminStore } from '../../store/adminStore';
import { useAuthStore } from '../../store/authStore';
import { useNotificationsStore } from '../../store/notificationsStore';
import { CommandSearch } from './CommandSearch';
import { Monogram } from '../brand/Wordmark';
import { adminRepository, type AdminPermission } from '../../services/repositories/adminRepository';

const WIDE_BREAKPOINT = 900;
const SIDEBAR_WIDE = 240;
const SIDEBAR_NARROW = 76;

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  permission: AdminPermission;
  /** Groups the "More" sheet into named sections (redesign section 38) — unused by the wide sidebar, which stays one flat list. */
  section: 'Operations' | 'Catalogue' | 'Business' | 'Administration';
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, permission: 'dashboard.view', section: 'Operations' },
  { label: 'Orders', href: '/admin/orders', icon: ShoppingBag, permission: 'orders.view', section: 'Operations' },
  { label: 'Deliveries', href: '/admin/deliveries', icon: Truck, permission: 'deliveries.view', section: 'Operations' },
  { label: 'Riders', href: '/admin/riders', icon: Bike, permission: 'riders.view', section: 'Operations' },
  { label: 'Stores', href: '/admin/stores', icon: StoreIcon, permission: 'stores.view', section: 'Operations' },
  { label: 'Products', href: '/admin/products', icon: Package, permission: 'products.view', section: 'Catalogue' },
  { label: 'Categories', href: '/admin/categories', icon: FolderTree, permission: 'categories.manage', section: 'Catalogue' },
  { label: 'Inventory', href: '/admin/inventory', icon: Boxes, permission: 'inventory.view', section: 'Catalogue' },
  { label: 'Customers', href: '/admin/customers', icon: Users, permission: 'customers.view', section: 'Business' },
  { label: 'Analytics', href: '/admin/analytics', icon: BarChart3, permission: 'analytics.view', section: 'Business' },
  { label: 'Staff & Roles', href: '/admin/staff', icon: UserCog, permission: 'users.view', section: 'Administration' },
  { label: 'Notifications', href: '/admin/notifications', icon: Bell, permission: 'notifications.view', section: 'Administration' },
  { label: 'Audit Logs', href: '/admin/audit-logs', icon: ScrollText, permission: 'audit_logs.view', section: 'Administration' },
  { label: 'Settings', href: '/admin/settings', icon: SettingsIcon, permission: 'settings.view', section: 'Administration' },
  // QA/demo-only tooling (section 33) — gated on settings.manage, the
  // same permission its RPCs enforce server-side, so it only ever
  // appears for an admin who could already flip feature flags/reset
  // inventory. Never reachable by a customer, store, or rider session.
  { label: 'QA / Demo Panel', href: '/admin/qa-panel', icon: FlaskConical, permission: 'settings.manage', section: 'Administration' },
];

/** The bottom tab bar (phone width) can only fit ~4 items before "More" — these are the ones an admin checks most, matching Blinkit/Zepto-style ops apps. Everything else lives in the More sheet. */
const PRIMARY_TAB_HREFS = ['/admin', '/admin/orders', '/admin/products', '/admin/inventory'];

interface AdminShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

/**
 * Responsive shell (section 6/41): a persistent, collapsible left
 * sidebar on wide viewports; on phone-width screens, a real bottom
 * tab bar (Dashboard/Orders/Products/Inventory + a "More" sheet for
 * everything else) matching the mobile-ops-app reference screenshots,
 * not a desktop nav squeezed into a scroll strip. Every item is
 * filtered by the signed-in admin's actual permissions (section 44)
 * — this is a display convenience only, every route/action underneath
 * still enforces the same permission server-side regardless of what
 * this shell chose to show.
 */
export function AdminShell({ title, subtitle, children }: AdminShellProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;
  const insets = useSafeAreaInsets();
  const context = useAdminStore((s) => s.context);
  const loaded = useAdminStore((s) => s.loaded);
  const loadAdmin = useAdminStore((s) => s.load);
  const hasPermission = useAdminStore((s) => s.hasPermission);
  const profile = useAuthStore((s) => s.profile);
  const logout = useAuthStore((s) => s.logout);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [qaTestMode, setQaTestMode] = useState(false);
  const sidebarWidth = useRef(new Animated.Value(SIDEBAR_WIDE)).current;

  useEffect(() => {
    if (!loaded) loadAdmin();
  }, [loaded, loadAdmin]);

  // Section 9/15 (QA testing mode) — a hard-to-miss reminder wherever
  // an admin is working, not just buried in the Settings list, so it's
  // difficult to accidentally leave enabled before production.
  useEffect(() => {
    adminRepository
      .getFeatureFlags()
      .then((flags) => setQaTestMode(!!flags.find((f) => f.key === 'qa_test_mode')?.enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Animated.timing(sidebarWidth, {
      toValue: collapsed ? SIDEBAR_NARROW : SIDEBAR_WIDE,
      duration: duration.standard,
      useNativeDriver: false,
    }).start();
  }, [collapsed, sidebarWidth]);

  const visibleItems = NAV_ITEMS.filter((item) => hasPermission(item.permission));
  const primaryTabs = PRIMARY_TAB_HREFS.map((href) => visibleItems.find((i) => i.href === href)).filter((i): i is NavItem => !!i);
  const moreItems = visibleItems.filter((item) => !PRIMARY_TAB_HREFS.includes(item.href));
  const moreSections = (['Operations', 'Catalogue', 'Business', 'Administration'] as const)
    .map((section) => ({ section, items: moreItems.filter((i) => i.section === section) }))
    .filter((s) => s.items.length > 0);
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname.startsWith(href));

  const NavList = () => (
    <View style={styles.navListVertical}>
      {visibleItems.map((item) => {
        const active = isActive(item.href);
        return (
          <Pressable
            key={item.href}
            style={[styles.navItemVertical, active && styles.navItemActive]}
            onPress={() => router.push(item.href as never)}
          >
            {active && <View style={styles.activeBar} />}
            <item.icon size={ICON_SIZE.sm} color={active ? colors.primary : colors.textSecondary} strokeWidth={ICON_STROKE} />
            {!collapsed && (
              <Text style={[styles.navLabel, active && styles.navLabelActive]} numberOfLines={1}>{item.label}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );

  const goTo = (href: string) => {
    setMoreOpen(false);
    router.push(href as never);
  };

  return (
    <View style={styles.root}>
      {isWide && (
        <Animated.View style={[styles.sidebar, { width: sidebarWidth }]}>
          <View style={styles.sidebarHeader}>
            {!collapsed ? (
              <>
                <Text style={styles.brand}>GOVIND PANSARI</Text>
                <Text style={styles.brandSub}>Admin Control Center</Text>
              </>
            ) : (
              <Monogram size={36} onDark={false} />
            )}
          </View>
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
            <NavList />
          </ScrollView>
          <Pressable style={styles.collapseBtn} onPress={() => setCollapsed((c) => !c)} hitSlop={8}>
            {collapsed ? (
              <PanelLeftOpen size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
            ) : (
              <>
                <PanelLeftClose size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                <Text style={styles.collapseText}>Collapse</Text>
              </>
            )}
          </Pressable>
          <View style={styles.sidebarFooter}>
            {!collapsed ? (
              <>
                <Text style={styles.footerName} numberOfLines={1}>{profile?.name ?? 'Admin'}</Text>
                <Text style={styles.footerRole}>{context?.adminRole?.replace(/_/g, ' ') ?? '—'}</Text>
                <Pressable style={styles.logoutRow} onPress={() => logout()}>
                  <LogOut size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
                  <Text style={styles.logoutText}>Sign out</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => logout()} hitSlop={8} style={{ alignItems: 'center' }}>
                <LogOut size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}

      <View style={styles.main}>
        <View style={[styles.topBar, !isWide && { paddingTop: insets.top + spacing.sm }]}>
          <View style={{ flex: isWide ? 0 : 1 }}>
            <Text style={styles.pageTitle}>{title}</Text>
            {subtitle && isWide && <Text style={styles.pageSubtitle}>{subtitle}</Text>}
          </View>
          {isWide && <CommandSearch />}
          <View style={styles.topBarActions}>
            <Pressable onPress={() => router.push('/admin/notifications' as never)} style={styles.bellBtn} hitSlop={8}>
              <Bell size={ICON_SIZE.md} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
              {unreadCount > 0 && <View style={styles.bellDot} />}
            </Pressable>
          </View>
        </View>
        {qaTestMode && (
          <View style={styles.qaBanner}>
            <Text style={styles.qaBannerText}>QA TEST MODE — Orders 24/7 • Every product fully stocked</Text>
          </View>
        )}
        <View style={styles.content}>{children}</View>

        {!isWide && (
          <View style={[styles.bottomTabBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
            {primaryTabs.map((item) => {
              const active = isActive(item.href);
              return (
                <Pressable key={item.href} style={styles.bottomTabItem} onPress={() => goTo(item.href)}>
                  <item.icon size={ICON_SIZE.md} color={active ? colors.primary : colors.textMuted} strokeWidth={ICON_STROKE} />
                  <Text style={[styles.bottomTabLabel, active && styles.bottomTabLabelActive]} numberOfLines={1}>{item.label}</Text>
                </Pressable>
              );
            })}
            <Pressable style={styles.bottomTabItem} onPress={() => setMoreOpen(true)}>
              <View>
                <MoreHorizontal size={ICON_SIZE.md} color={colors.textMuted} strokeWidth={ICON_STROKE} />
                {unreadCount > 0 && <View style={styles.bottomTabDot} />}
              </View>
              <Text style={styles.bottomTabLabel} numberOfLines={1}>More</Text>
            </Pressable>
          </View>
        )}
      </View>

      {!isWide && (
        <Modal visible={moreOpen} transparent animationType="slide" onRequestClose={() => setMoreOpen(false)}>
          <Pressable style={styles.moreOverlay} onPress={() => setMoreOpen(false)}>
            <Pressable style={[styles.moreSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} onPress={(e) => e.stopPropagation()}>
              <View style={styles.moreHeader}>
                <Text style={styles.moreTitle}>More</Text>
                <Pressable onPress={() => setMoreOpen(false)} hitSlop={8}>
                  <X size={ICON_SIZE.sm} color={colors.textSecondary} strokeWidth={ICON_STROKE} />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {moreSections.map(({ section, items }) => (
                  <View key={section} style={styles.moreSectionBlock}>
                    <Text style={styles.moreSectionLabel}>{section}</Text>
                    <View style={styles.moreGrid}>
                      {items.map((item) => {
                        const active = isActive(item.href);
                        return (
                          <Pressable key={item.href} style={({ pressed }) => [styles.moreItem, pressed && styles.moreItemPressed]} onPress={() => goTo(item.href)}>
                            <View style={[styles.moreIconChip, active && styles.moreIconChipActive]}>
                              <item.icon size={ICON_SIZE.md} color={active ? colors.primary : colors.textSecondary} strokeWidth={ICON_STROKE} />
                            </View>
                            <Text style={[styles.moreItemLabel, active && styles.moreItemLabelActive]} numberOfLines={2}>{item.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </ScrollView>
              <View style={styles.moreFooter}>
                <Text style={styles.footerName} numberOfLines={1}>{profile?.name ?? 'Admin'}</Text>
                <Text style={styles.footerRole}>{context?.adminRole?.replace(/_/g, ' ') ?? '—'}</Text>
                <Pressable style={styles.logoutRow} onPress={() => { setMoreOpen(false); logout(); }}>
                  <LogOut size={ICON_SIZE.sm} color={colors.error} strokeWidth={ICON_STROKE} />
                  <Text style={styles.logoutText}>Sign out</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  qaBanner: { backgroundColor: colors.warning, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
  qaBannerText: { ...textStyles.caption, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold', letterSpacing: 0.4 },
  sidebar: { backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.divider, overflow: 'hidden' },
  sidebarHeader: { padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider, minHeight: 68, justifyContent: 'center' },
  brand: { ...textStyles.caption, color: colors.textMuted, letterSpacing: 1.2, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11 },
  brandSub: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 16, color: colors.textPrimary, marginTop: 2 },
  navListVertical: { paddingVertical: spacing.sm },
  navItemVertical: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, position: 'relative' },
  navItemActive: { backgroundColor: colors.primaryTint },
  activeBar: { position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: colors.primary },
  navLabel: { ...textStyles.bodySmall, color: colors.textSecondary, fontSize: 13, flexShrink: 1 },
  navLabelActive: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  collapseBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  collapseText: { ...textStyles.caption, color: colors.textSecondary },
  sidebarFooter: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider },
  footerName: { ...textStyles.bodySmall, color: colors.textPrimary, fontFamily: 'PlusJakartaSans_600SemiBold' },
  footerRole: { ...textStyles.caption, color: colors.textMuted, marginTop: 1, textTransform: 'capitalize' },
  logoutRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  logoutText: { ...textStyles.caption, color: colors.error, fontFamily: 'PlusJakartaSans_600SemiBold' },
  main: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.lg,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface,
    borderBottomWidth: 1, borderBottomColor: colors.divider, minHeight: 68,
  },
  pageTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 20, color: colors.textPrimary },
  pageSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  topBarActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bellBtn: { position: 'relative', padding: 2 },
  bellDot: { position: 'absolute', top: 0, right: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error, borderWidth: 1.5, borderColor: colors.surface },
  content: { flex: 1, ...shadows.xs },
  bottomTabBar: {
    flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider,
    paddingTop: spacing.sm, ...shadows.md,
  },
  bottomTabItem: { flex: 1, alignItems: 'center', gap: 3, paddingHorizontal: 4 },
  bottomTabLabel: { ...textStyles.caption, fontSize: 10.5, color: colors.textMuted },
  bottomTabLabelActive: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  bottomTabDot: { position: 'absolute', top: -2, right: -4, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.error, borderWidth: 1.5, borderColor: colors.surface },
  moreOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  moreSheet: {
    backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg, paddingHorizontal: spacing.lg, maxHeight: '80%',
  },
  moreHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  moreTitle: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 18, color: colors.textPrimary },
  moreSectionBlock: { marginBottom: spacing.sm },
  moreSectionLabel: { ...textStyles.caption, fontSize: 11, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing.sm },
  moreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingBottom: spacing.md },
  moreItem: { width: '22%', alignItems: 'center', gap: 6 },
  moreItemPressed: { opacity: 0.65 },
  moreIconChip: { width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', ...shadows.xs },
  moreIconChipActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  moreItemLabel: { ...textStyles.caption, fontSize: 10.5, color: colors.textSecondary, textAlign: 'center' },
  moreItemLabelActive: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  moreFooter: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md, paddingBottom: spacing.sm },
});
