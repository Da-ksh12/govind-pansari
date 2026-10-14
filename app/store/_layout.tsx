import { View, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { StoreTabBar } from '../../components/nav/StoreTabBar';
import { StoreDesktopSidebar } from '../../components/nav/StoreDesktopSidebar';

const WIDE_BREAKPOINT = 900;

export default function StoreOpsLayout() {
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_BREAKPOINT;

  return (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {isWide && <StoreDesktopSidebar />}
      <View style={{ flex: 1 }}>
        <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => (isWide ? null : <StoreTabBar {...props} />)}>
          <Tabs.Screen name="index" options={{ title: 'Dashboard' }} />
          <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
          <Tabs.Screen name="inventory" options={{ title: 'Inventory' }} />
          <Tabs.Screen name="profile" options={{ title: 'Store' }} />
          <Tabs.Screen name="activity" options={{ href: null }} />
        </Tabs>
      </View>
    </View>
  );
}
