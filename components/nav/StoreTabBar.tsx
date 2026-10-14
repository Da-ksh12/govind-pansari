import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LayoutDashboard, ClipboardList, Boxes, Store } from 'lucide-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';

const TAB_ICONS: Record<string, React.ComponentType<{ size: number; color: string; strokeWidth: number }>> = {
  index: LayoutDashboard,
  orders: ClipboardList,
  inventory: Boxes,
  profile: Store,
};

const TAB_LABELS: Record<string, string> = {
  index: 'Dashboard',
  orders: 'Orders',
  inventory: 'Inventory',
  profile: 'Store',
};

/** Store Operations' own tab bar — deliberately separate from
 * BottomTabBar (customer navigation), no shared route names, no
 * FloatingCartBar. Same visual language (theme tokens), different
 * navigation surface, per section 45's "own navigation" requirement. */
export function StoreTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {state.routes.map((route: (typeof state.routes)[number], index: number) => {
        const focused = state.index === index;
        const Icon = TAB_ICONS[route.name] ?? LayoutDashboard;
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
            <Text style={[styles.label, { color }]}>{TAB_LABELS[route.name]}</Text>
            <View style={[styles.dot, { opacity: focused ? 1 : 0 }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    ...shadows.md,
  },
  item: { flex: 1, alignItems: 'center', gap: 3 },
  label: { ...textStyles.navLabel },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary, marginTop: 1 },
});
