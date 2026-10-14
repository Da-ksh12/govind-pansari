import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Bell, ChevronDown, MapPin } from 'lucide-react-native';
import { router } from 'expo-router';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { useLocationStore } from '../../store/locationStore';

interface LocationHeaderProps {
  avatarUrl?: string;
  unreadNotifications?: number;
}

export function LocationHeader({ avatarUrl, unreadNotifications = 0 }: LocationHeaderProps) {
  const selected = useLocationStore((s) => s.selected);
  const etaMinMin = useLocationStore((s) => s.etaMinMin);
  const etaMinMax = useLocationStore((s) => s.etaMinMax);

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
              {selected?.label ?? 'Sanjay Place, Agra'}
            </Text>
            <ChevronDown size={ICON_SIZE.sm} color={colors.textPrimary} strokeWidth={ICON_STROKE} />
          </View>
          <Text style={styles.eta}>
            Estimated delivery <Text style={styles.etaStrong}>{etaMinMin}–{etaMinMax} min</Text>
          </Text>
        </View>
      </Pressable>

      <View style={styles.actions}>
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
