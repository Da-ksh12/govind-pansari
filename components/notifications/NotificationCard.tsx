import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, CreditCard, Gift, Package, ShieldAlert, Tag, Truck, type LucideIcon } from 'lucide-react-native';
import { colors, radius, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { AppImage } from '../ui/AppImage';
import type { NotificationType } from '../../types/models';

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  order: Package,
  delivery: Truck,
  offer: Tag,
  payment: CreditCard,
  product: Gift,
  promotional: Bell,
  system: ShieldAlert,
};

interface NotificationCardProps {
  type: NotificationType;
  title: string;
  body: string;
  timeAgo: string;
  unread: boolean;
  /**
   * A real photo when one genuinely exists and is worth showing (an
   * order's product thumbnail, a rider's profile photo) — never a
   * placeholder or invented image. Falls back to the category icon
   * when absent, which is every notification type until a caller
   * fetches and passes a real one (see app/notifications.tsx).
   */
  imageUrl?: string | null;
  onPress: () => void;
}

/**
 * The one reusable notification row — every category renders through
 * this same component with different icon/image, never a bespoke
 * layout per type (section 27: "one reusable notification-card system
 * with variants", not five different UIs).
 */
export function NotificationCard({ type, title, body, timeAgo, unread, imageUrl, onPress }: NotificationCardProps) {
  const Icon = TYPE_ICON[type];
  return (
    <Pressable style={[styles.row, unread && styles.rowUnread]} onPress={onPress}>
      {imageUrl ? (
        <AppImage uri={imageUrl} style={styles.thumb} contentFit="cover" kind="product" />
      ) : (
        <View style={[styles.iconCircle, unread && styles.iconCircleUnread]}>
          <Icon size={ICON_SIZE.md} color={unread ? colors.primary : colors.textSecondary} strokeWidth={ICON_STROKE} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>{title}</Text>
        <Text style={styles.body} numberOfLines={2}>{body}</Text>
        <Text style={styles.time}>{timeAgo}</Text>
      </View>
      {unread && <View style={styles.unreadDot} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider, alignItems: 'flex-start' },
  rowUnread: {},
  iconCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' },
  iconCircleUnread: { backgroundColor: colors.primaryTint },
  thumb: { width: 42, height: 42, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken },
  title: { ...textStyles.cardTitle, fontSize: 14, color: colors.textSecondary },
  titleUnread: { color: colors.textPrimary },
  body: { ...textStyles.caption, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  time: { ...textStyles.caption, color: colors.textMuted, marginTop: 4, fontSize: 10.5 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
});
