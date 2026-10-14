import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Home, History, UserCircle } from 'lucide-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';

/**
 * The rider's visible tabs, declared explicitly. Only these render.
 *
 * Why not "render every route in state.routes": the rider navigator also
 * contains `delivery/[id]`, the delivery-detail screen, registered with
 * `href: null` so it is never a tab. expo-router's own tab bar honours
 * that flag, but this custom bar used to map over every route, so the
 * detail screen showed up as an extra, unlabeled house-icon "tab" on the
 * far right that did nothing useful. Driving the bar from this list
 * means a non-tab route can never leak into it again, and the detail
 * screen itself stays reachable from History, Home and notifications.
 */
const RIDER_TABS = [
  { name: 'index', label: 'Home', Icon: Home },
  { name: 'history', label: 'History', Icon: History },
  { name: 'profile', label: 'Profile', Icon: UserCircle },
] as const;

/** Rider Operations' own tab bar — separate from both the customer
 * BottomTabBar and StoreTabBar, no shared routes/components (section
 * 45's "own navigation" applied to the rider surface too). Three tabs,
 * not four: with the default capacity of one active delivery at a
 * time (section 34), a dedicated "Deliveries" list tab would just
 * re-show the same single card Home already surfaces prominently —
 * the delivery detail screen is a push target from Home, not its own
 * tab. Worth a real "Deliveries" tab once capacity > 1 is actually used. */
export function RiderTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // Focus is keyed by route key, not by position: state.routes includes
  // non-tab routes, so the index of the active route is not the tab index.
  const activeKey = state.routes[state.index]?.key;
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {RIDER_TABS.map(({ name, label, Icon }) => {
        const route = state.routes.find((r) => r.name === name);
        if (!route) return null;
        const focused = route.key === activeKey;
        const color = focused ? colors.primary : colors.textSecondary;
        return (
          <Pressable
            key={route.key}
            style={styles.item}
            hitSlop={6}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
          >
            <Icon size={ICON_SIZE.lg} color={color} strokeWidth={focused ? ICON_STROKE + 0.35 : ICON_STROKE} />
            <Text style={[styles.label, { color }]}>{label}</Text>
            <View style={[styles.dot, { opacity: focused ? 1 : 0 }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, ...shadows.md },
  item: { flex: 1, alignItems: 'center', gap: 3 },
  label: { ...textStyles.navLabel },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary, marginTop: 1 },
});
