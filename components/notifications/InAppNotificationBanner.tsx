import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell } from 'lucide-react-native';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { useNotificationsStore } from '../../store/notificationsStore';
import { navigateForNotification } from '../../services/notifications/navigateForNotification';
import { vibrateForPriority } from '../../services/notifications/alertVibration';

const AUTO_DISMISS_MS = 4500;

/**
 * Foreground in-app banner (section 34/36) — driven by the same
 * Realtime insert that updates the bell badge, not a duplicate push
 * listener. Slide + fade, auto-dismisses, tap navigates like any other
 * notification tap (section 12).
 */
export function InAppNotificationBanner() {
  const incoming = useNotificationsStore((s) => s.incoming);
  const dismissIncoming = useNotificationsStore((s) => s.dismissIncoming);
  const insets = useSafeAreaInsets();

  // A new delivery assignment/offer for a rider gets the full-screen
  // must-respond prompt (components/rider/NewDeliveryPrompt) instead
  // — showing both would double-fire the haptic and stack two alerts
  // for the exact same event. delivery_offer is the Final Dispatch
  // pass's multi-rider offer round; delivery_assigned is the older
  // single-candidate manual/auto assignment — both route to that same
  // full-screen prompt, so both are suppressed here.
  const suppressed = incoming?.eventType === 'delivery_assigned' || incoming?.eventType === 'delivery_offer';

  useEffect(() => {
    if (!incoming || suppressed) return;
    vibrateForPriority(incoming.priority);
    const timer = setTimeout(dismissIncoming, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [incoming, suppressed, dismissIncoming]);

  if (!incoming || suppressed) return null;

  const handlePress = () => {
    const target = navigateForNotification(incoming.eventType, incoming.data);
    dismissIncoming();
    if (target) router.push(target as never);
  };

  return (
    <Animated.View
      entering={FadeInDown.duration(300)}
      exiting={FadeOutUp.duration(220)}
      style={[styles.wrap, { top: insets.top + spacing.sm }]}
    >
      <Pressable style={styles.card} onPress={handlePress}>
        <View style={styles.iconCircle}>
          <Bell size={ICON_SIZE.sm} color={colors.primary} strokeWidth={ICON_STROKE} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {incoming.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {incoming.body}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: spacing.base, right: spacing.base, zIndex: 100 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadows.lg,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...textStyles.cardTitle, fontSize: 13, color: colors.textPrimary },
  body: { ...textStyles.caption, color: colors.textSecondary, marginTop: 1 },
});
