import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Bell, ChevronDown, MapPin, ShoppingBag } from 'lucide-react-native';
import { router } from 'expo-router';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { useLocationStore } from '../../store/locationStore';
import { useCartStore } from '../../store/cartStore';
import { cartItemCount, formatBadge } from '../../services/cartSync';
import { describeServiceability } from '../../services/serviceability';

interface LocationHeaderProps {
  avatarUrl?: string;
  unreadNotifications?: number;
}

export function LocationHeader({ avatarUrl, unreadNotifications = 0 }: LocationHeaderProps) {
  const selected = useLocationStore((s) => s.selected);
  const serviceability = useLocationStore((s) => s.serviceability);
  const etaMinMin = useLocationStore((s) => s.etaMinMin);
  const etaMinMax = useLocationStore((s) => s.etaMinMax);
  // The real number of items in the cart (from the cart store itself, not a product cache): always correct after a
  // launch, a return from the background or a trip to Product Details.
  const cartCount = useCartStore((s) => cartItemCount(s.items));
  // What the server says about the selected location — the same answer Add Address and Checkout use.
  const unavailable = serviceability && !serviceability.serviceable ? describeServiceability(serviceability) : null;

  return (
    <View style={styles.row}>
      <Pressable style={styles.locationBlock} onPress={() => router.push('/location')}>
        <View style={styles.pinCircle}>
          <MapPin size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.deliveringTo}>Delivering to</Text>
          <View style={styles.addressRow}>
            <Text numberOfLines={1} style={styles.address}>
              {selected?.label ?? 'Choose delivery location'}
            </Text>
            <ChevronDown size={ICON_SIZE.sm} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
          </View>
          {!selected ? (
            <Text style={styles.eta}>Tap to set where we deliver</Text>
          ) : unavailable ? (
            <Text style={[styles.eta, styles.etaUnavailable]} numberOfLines={1}>{unavailable.title}</Text>
          ) : (
            <Text style={styles.eta}>
              Estimated delivery <Text style={styles.etaStrong}>{etaMinMin}–{etaMinMax} min</Text>
            </Text>
          )}
        </View>
      </Pressable>

      <View style={styles.actions}>
        <Pressable
          onPress={() => router.push('/cart')}
          style={styles.iconButton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cartCount > 0 ? `Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}` : 'Cart'}
          testID="home-cart-button"
        >
          <ShoppingBag size={ICON_SIZE.lg} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
          {cartCount > 0 && (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{formatBadge(cartCount)}</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={() => router.push('/notifications')} style={styles.iconButton} hitSlop={8}>
          <Bell size={ICON_SIZE.lg} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
          {unreadNotifications > 0 && <View style={styles.badgeDot} />}
        </Pressable>
        <Pressable onPress={() => router.push('/(tabs)/profile')}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} contentFit="cover" transition={200} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]}>
              <Text style={styles.avatarInitials}>GP</Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  locationBlock: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: spacing.sm },
  pinCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deliveringTo: { ...textStyles.caption, color: colors.textSecondary },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  address: { ...textStyles.cardTitle, color: colors.textPrimary, fontSize: 16 },
  eta: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
  etaStrong: { color: colors.primary, fontFamily: 'PlusJakartaSans_700Bold' },
  etaUnavailable: { color: colors.error, fontFamily: 'PlusJakartaSans_600SemiBold' },
  cartBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cartBadgeText: { fontSize: 10, lineHeight: 12, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: 4 },
  iconButton: { position: 'relative' },
  badgeDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.error,
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: colors.gold },
  avatarFallback: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarInitials: { ...textStyles.cardTitle, color: colors.white, fontSize: 14 },
});
