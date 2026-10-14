import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, withSpring, useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Home, LayoutGrid, Search, ShoppingBag, User } from 'lucide-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors, radius, shadows, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { FloatingCartBar } from '../home/FloatingCartBar';

const TAB_ICONS: Record<string, React.ComponentType<{ size: number; color: string; strokeWidth: number }>> = {
  index: Home,
  categories: LayoutGrid,
  search: Search,
  orders: ShoppingBag,
  profile: User,
};

const TAB_LABELS: Record<string, string> = {
  index: 'Home',
  categories: 'Categories',
  search: 'Search',
  orders: 'Orders',
  profile: 'Profile',
};

const PILL_MARGIN = 6;

function TabItem({
  routeName,
  focused,
  onPress,
}: {
  routeName: string;
  focused: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.1 : 1, { damping: 14, stiffness: 220 });
  }, [focused, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const Icon = TAB_ICONS[routeName] ?? Home;
  const color = focused ? colors.primary : colors.textMuted;

  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={styles.item}
      hitSlop={6}
    >
      <Animated.View style={style}>
        <Icon size={ICON_SIZE.md} color={color} strokeWidth={focused ? ICON_STROKE + 0.4 : ICON_STROKE} />
      </Animated.View>
      <Text style={[styles.label, focused && styles.labelActive, { color }]} numberOfLines={1}>
        {TAB_LABELS[routeName]}
      </Text>
    </Pressable>
  );
}

export function BottomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [barWidth, setBarWidth] = useState(0);
  const numTabs = state.routes.length;
  const tabWidth = barWidth / numTabs;
  const pillX = useSharedValue(0);

  useEffect(() => {
    if (tabWidth > 0) {
      pillX.value = withSpring(state.index * tabWidth + PILL_MARGIN, { damping: 20, stiffness: 200 });
    }
  }, [state.index, tabWidth, pillX]);

  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pillX.value }] }));

  const onBarLayout = (e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width);

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <View style={styles.cartSlot} pointerEvents="box-none">
        <FloatingCartBar />
      </View>
      <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]} onLayout={onBarLayout}>
        {tabWidth > 0 && (
          <Animated.View
            pointerEvents="none"
            style={[styles.pill, { width: tabWidth - PILL_MARGIN * 2 }, pillStyle]}
          />
        )}
        {state.routes.map((route: (typeof state.routes)[number], index: number) => {
          const focused = state.index === index;
          return (
            <TabItem
              key={route.key}
              routeName={route.name}
              focused={focused}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  cartSlot: { marginBottom: spacing.sm },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.goldTint,
    ...shadows.lg,
  },
  pill: {
    position: 'absolute',
    top: spacing.xs,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryTint,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, height: 52 },
  label: { ...textStyles.navLabel, fontSize: 10.5 },
  labelActive: { fontFamily: 'PlusJakartaSans_700Bold' },
});
