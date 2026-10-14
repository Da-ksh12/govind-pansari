import { Tabs } from 'expo-router';
import { RiderTabBar } from '../../components/nav/RiderTabBar';

export default function RiderOpsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <RiderTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
      <Tabs.Screen name="delivery/[id]" options={{ href: null }} />
    </Tabs>
  );
}
