import React, { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WifiOff } from 'lucide-react-native';
import { colors, spacing, textStyles } from '../../theme';
import { ICON_SIZE, ICON_STROKE } from '../../theme/icons';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';

/**
 * A single, always-visible connectivity signal — previously every
 * screen failed silently and independently on a dropped connection,
 * with nothing telling the user why. Sits above all app content
 * (mounted once at the root, like ToastHost/InAppNotificationBanner)
 * so it's visible regardless of which screen is active.
 */
export function OfflineBanner() {
  const isConnected = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const barHeight = 28;
  const height = useSharedValue(0);

  useEffect(() => {
    height.value = withTiming(isConnected ? 0 : insets.top + barHeight, { duration: 250 });
  }, [isConnected, height, insets.top]);

  const animatedStyle = useAnimatedStyle(() => ({ height: height.value }));

  if (isConnected) return null;

  return (
    <Animated.View style={[styles.banner, animatedStyle]}>
      <WifiOff size={ICON_SIZE.xs} color={colors.white} strokeWidth={ICON_STROKE} />
      <Text style={styles.text}>No internet connection</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: spacing.xs,
    backgroundColor: colors.error, overflow: 'hidden', paddingBottom: 6,
  },
  text: { ...textStyles.caption, color: colors.white, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 11.5 },
});
