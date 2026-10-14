import { View, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { BottomTabBar } from '../../components/nav/BottomTabBar';
import { DesktopHeader } from '../../components/nav/DesktopHeader';

const WIDE_BREAKPOINT = 900;

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  return (
    <View style={{ flex: 1 }}>
      {isWide && <DesktopHeader />}
      <Tabs
        screenOptions={{ headerShown: false }}
        tabBar={(props) => (isWide ? null : <BottomTabBar {...props} />)}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="categories" options={{ title: 'Categories' }} />
        <Tabs.Screen name="search" options={{ title: 'Search' }} />
        <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
        <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      </Tabs>
    </View>
  );
}
