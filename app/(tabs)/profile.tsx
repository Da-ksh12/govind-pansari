import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  Bell,
  ChevronRight,
  CreditCard,
  Crown,
  FileText,
  Gift,
  Headset,
  Heart,
  Info,
  LogOut,
  MapPin,
  Settings,
  ShieldCheck,
  Star,
  User as UserIcon,
} from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { SafeScreen } from '../../components/layout/SafeScreen';
import { Avatar } from '../../components/ui/Avatar';
import { useOrdersStore } from '../../store/ordersStore';
import { useAuthStore } from '../../store/authStore';
import { formatINR } from '../../components/ui/PriceBlock';

const SETTINGS_ITEMS = [
  { icon: UserIcon, title: 'Personal Information', subtitle: 'Manage your name, email and phone', route: '/profile/personal' as const },
  { icon: MapPin, title: 'Addresses', subtitle: 'Manage your delivery addresses', route: '/address' as const },
  { icon: CreditCard, title: 'Payment Methods', subtitle: 'Manage UPI, cards and wallets', route: '/profile/payments' as const },
  { icon: Heart, title: 'My Wishlist', subtitle: 'Your saved favourite products', route: '/wishlist' as const },
  { icon: Bell, title: 'Notification Preferences', subtitle: 'Choose which updates you receive', route: '/notification-preferences' as const },
  { icon: Headset, title: 'Help & Support', subtitle: 'FAQs, contact us and more', route: '/help' as const },
];

export default function ProfileScreen() {
  const profile = useAuthStore((s) => s.profile);
  const orders = useOrdersStore((s) => s.orders);
  const logout = useAuthStore((s) => s.logout);

  const stats = {
    all: orders.length,
    processing: orders.filter((o) => ['confirmed', 'preparing', 'packed'].includes(o.status)).length,
    shipped: orders.filter((o) => ['rider_assigned', 'out_for_delivery', 'arriving'].includes(o.status)).length,
    delivered: orders.filter((o) => o.status === 'delivered').length,
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  if (!profile) return <SafeScreen />;

  return (
    <SafeScreen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>My Profile</Text>
          <View style={styles.headerIcons}>
            <Pressable onPress={() => router.push('/notifications')} hitSlop={8}>
              <Bell size={ICON_SIZE.lg} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
            </Pressable>
            <Settings size={ICON_SIZE.lg} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
          </View>
        </View>

        <View style={styles.userCard}>
          <Avatar uri={profile.avatarUrl} name={profile.name} size="lg" />
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{profile.name}</Text>
              {profile.isPremium && (
                <View style={styles.premiumTag}>
                  <Crown size={11} color={colors.goldDark} strokeWidth={ICON_STROKE} />
                  <Text style={styles.premiumTagText}>Premium</Text>
                </View>
              )}
            </View>
            <Text style={styles.contactText}>{profile.phone}</Text>
            {profile.email && <Text style={styles.contactText}>{profile.email}</Text>}
          </View>
        </View>

        <View style={styles.walletRow}>
          <View style={styles.walletCard}>
            <Star size={ICON_SIZE.sm} color={colors.gold} strokeWidth={ICON_STROKE} fill={colors.gold} />
            <View>
              <Text style={styles.walletLabel}>Loyalty Points</Text>
              <Text style={styles.walletValue}>{profile.loyaltyPoints.toLocaleString('en-IN')}</Text>
            </View>
          </View>
          <View style={styles.walletCard}>
            <CreditCard size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
            <View>
              <Text style={styles.walletLabel}>Wallet</Text>
              <Text style={styles.walletValue}>{formatINR(profile.walletBalance)}</Text>
            </View>
          </View>
        </View>

        {profile.isPremium && (
          <View style={styles.premiumBanner}>
            <Crown size={ICON_SIZE.lg} color={colors.gold} strokeWidth={ICON_STROKE} />
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumBannerTitle}>You are a Premium Member!</Text>
              <Text style={styles.premiumBannerSubtitle}>Enjoy free delivery, exclusive offers & more.</Text>
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>My Orders</Text>
        <View style={styles.statsRow}>
          {[
            { label: 'All Orders', value: stats.all },
            { label: 'Processing', value: stats.processing },
            { label: 'Shipped', value: stats.shipped },
            { label: 'Delivered', value: stats.delivered },
            { label: 'Cancelled', value: stats.cancelled },
          ].map((s) => (
            <Pressable key={s.label} style={styles.statItem} onPress={() => router.push('/(tabs)/orders')}>
              <Text style={styles.statValue}>{s.value}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Account Settings</Text>
        <View style={styles.list}>
          {SETTINGS_ITEMS.map((item, i) => (
            <Pressable
              key={item.title}
              style={[styles.listRow, i === SETTINGS_ITEMS.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => router.push(item.route as never)}
            >
              <View style={styles.listIcon}>
                <item.icon size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.listTitle}>{item.title}</Text>
                <Text style={styles.listSubtitle}>{item.subtitle}</Text>
              </View>
              <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>More</Text>
        <View style={styles.list}>
          <Pressable style={styles.listRow} onPress={() => router.push('/gifting')}>
            <View style={styles.listIcon}>
              <Gift size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            </View>
            <Text style={[styles.listTitle, { flex: 1 }]}>Gift Hampers</Text>
            <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          </Pressable>
          <Pressable style={styles.listRow} onPress={() => router.push('/about' as never)}>
            <View style={styles.listIcon}>
              <Info size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            </View>
            <Text style={[styles.listTitle, { flex: 1 }]}>About Govind Pansari</Text>
            <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          </Pressable>
          <Pressable style={styles.listRow} onPress={() => router.push('/terms-of-service' as never)}>
            <View style={styles.listIcon}>
              <FileText size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            </View>
            <Text style={[styles.listTitle, { flex: 1 }]}>Terms of Service</Text>
            <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          </Pressable>
          <Pressable style={[styles.listRow, { borderBottomWidth: 0 }]} onPress={() => router.push('/privacy-policy' as never)}>
            <View style={styles.listIcon}>
              <ShieldCheck size={ICON_SIZE.md} color={colors.primary} strokeWidth={ICON_STROKE} />
            </View>
            <Text style={[styles.listTitle, { flex: 1 }]}>Privacy Policy</Text>
            <ChevronRight size={ICON_SIZE.sm} color={colors.textMuted} strokeWidth={ICON_STROKE} />
          </Pressable>
        </View>

        <Pressable style={styles.logoutRow} onPress={handleLogout}>
          <LogOut size={ICON_SIZE.md} color={colors.error} strokeWidth={ICON_STROKE} />
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>

        <View style={{ height: 140 }} />
      </ScrollView>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.base, paddingTop: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 26, color: colors.textPrimary },
  headerIcons: { flexDirection: 'row', gap: spacing.lg },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.base,
    marginTop: spacing.lg,
    ...shadows.sm,
  },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.surfaceSunken },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { ...textStyles.cardTitle, fontSize: 17, color: colors.textPrimary },
  premiumTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.goldTint,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  premiumTagText: { fontSize: 10.5, fontFamily: 'PlusJakartaSans_700Bold', color: colors.goldDark },
  contactText: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2 },
  walletRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  walletCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadows.sm,
  },
  walletLabel: { ...textStyles.caption, color: colors.textSecondary },
  walletValue: { ...textStyles.cardTitle, color: colors.textPrimary, fontSize: 15 },
  premiumBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryDarker,
    borderRadius: radius.md,
    padding: spacing.base,
    marginTop: spacing.md,
  },
  premiumBannerTitle: { ...textStyles.cardTitle, color: colors.white },
  premiumBannerSubtitle: { ...textStyles.caption, color: 'rgba(255,255,255,0.75)', marginTop: 2 },
  sectionTitle: { ...textStyles.sectionTitle, fontSize: 16, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, ...shadows.sm },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { ...textStyles.cardTitle, fontSize: 18, color: colors.textPrimary },
  statLabel: { ...textStyles.caption, color: colors.textSecondary, textAlign: 'center', marginTop: 2, fontSize: 10.5 },
  list: { backgroundColor: colors.surface, borderRadius: radius.md, ...shadows.sm },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  listIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center' },
  listTitle: { ...textStyles.cardTitle, fontSize: 14.5, color: colors.textPrimary },
  listSubtitle: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  logoutRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'center', marginTop: spacing.xl, padding: spacing.md },
  logoutText: { ...textStyles.button, color: colors.error, fontSize: 15 },
});
