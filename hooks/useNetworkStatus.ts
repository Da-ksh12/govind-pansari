import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/** True only once we've heard a real "offline" signal — starts true (assume connected) so a slow first native callback never flashes the banner on a perfectly fine connection. */
export function useNetworkStatus(): boolean {
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // isInternetReachable can be null while still determining —
      // only treat it as offline once NetInfo is confident, not on
      // every transient null during startup.
      setIsConnected(state.isConnected !== false && state.isInternetReachable !== false);
    });
    return () => unsubscribe();
  }, []);

  return isConnected;
}
