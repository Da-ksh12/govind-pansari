import React, { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import { router } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { Nut, Wheat, Leaf, Gift, Sparkles, Flame } from 'lucide-react-native';
import { colors, radius } from '../theme';
import { Monogram } from '../components/brand/Wordmark';
import { useAppStore } from '../store/appStore';
import { useAuthStore } from '../store/authStore';
import { useLocationStore } from '../store/locationStore';
import { useNotificationResponseNavigation } from '../hooks/useNotificationResponseNavigation';

interface FloatingIconSpec {
  Icon: typeof Nut;
  top: DimensionValue;
  left: DimensionValue;
  delay: number;
  bobDistance: number;
  bobDuration: number;
  /** Where this icon starts relative to its resting spot — animates inward from here, so the set visually "assembles" around the logo rather than just fading in place (section 6). */
  fromX: number;
  fromY: number;
}

const FLOATING_ICONS: FloatingIconSpec[] = [
  { Icon: Nut, top: '22%', left: '16%', delay: 500, bobDistance: 8, bobDuration: 2200, fromX: -34, fromY: -28 },
  { Icon: Wheat, top: '18%', left: '72%', delay: 650, bobDistance: 7, bobDuration: 2600, fromX: 34, fromY: -28 },
  { Icon: Leaf, top: '68%', left: '14%', delay: 750, bobDistance: 9, bobDuration: 2400, fromX: -34, fromY: 28 },
  { Icon: Gift, top: '70%', left: '74%', delay: 850, bobDistance: 8, bobDuration: 2100, fromX: 34, fromY: 28 },
  { Icon: Sparkles, top: '12%', left: '44%', delay: 950, bobDistance: 6, bobDuration: 1900, fromX: 0, fromY: -38 },
  { Icon: Flame, top: '78%', left: '46%', delay: 1050, bobDistance: 7, bobDuration: 2300, fromX: 0, fromY: 38 },
];

function FloatingIcon({ Icon, top, left, delay, bobDistance, bobDuration, fromX, fromY }: FloatingIconSpec) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.4);
  const settleX = useSharedValue(fromX);
  const settleY = useSharedValue(fromY);
  const bob = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 500 }));
    scale.value = withDelay(delay, withTiming(1, { duration: 500, easing: Easing.out(Easing.back(1.4)) }));
    settleX.value = withDelay(delay, withTiming(0, { duration: 550, easing: Easing.out(Easing.cubic) }));
    settleY.value = withDelay(delay, withTiming(0, { duration: 550, easing: Easing.out(Easing.cubic) }));
    bob.value = withDelay(
      delay + 550,
      withRepeat(withSequence(withTiming(-bobDistance, { duration: bobDuration }), withTiming(bobDistance, { duration: bobDuration })), -1, true),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateX: settleX.value }, { translateY: settleY.value + bob.value }],
  }));

  return (
    <Animated.View style={[styles.floatingChip, { top, left }, style]}>
      <Icon size={16} color={colors.gold} strokeWidth={2} />
    </Animated.View>
  );
}

export default function SplashScreen() {
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.85);
  const taglineOpacity = useSharedValue(0);
  const taglineY = useSharedValue(12);

  const hasOnboarded = useAppStore((s) => s.hasOnboarded);
  const authStatus = useAuthStore((s) => s.status);
  const profile = useAuthStore((s) => s.profile);
  const selectedLocation = useLocationStore((s) => s.selected);
  // Section 47: a cold start from tapping a push notification is
  // already being routed by this same hook (mounted persistently in
  // app/_layout.tsx) — this splash screen's own redirect below must
  // never fire in that case, or it wins the race and stomps the
  // notification's target a couple seconds later.
  const hasPendingNotificationTarget = useNotificationResponseNavigation();

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    logoScale.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });
    taglineOpacity.value = withDelay(400, withTiming(1, { duration: 500 }));
    taglineY.value = withDelay(400, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, []);

  useEffect(() => {
    // Supabase session state (authStatus) is the source of truth, and
    // it starts 'loading' until the listener set up in _layout.tsx
    // resolves the restored session — never navigate on a guess before
    // that settles, or a returning user would flash through /login.
    if (authStatus === 'loading') return;
    if (hasPendingNotificationTarget) return;

    const minSplashMs = 1900;
    const timer = setTimeout(() => {
      if (hasPendingNotificationTarget) return;
      const isStoreUser = profile?.role === 'store_manager' || profile?.role === 'staff';
      const isRider = profile?.role === 'rider';
      const isAdmin = profile?.role === 'admin';
      if (!hasOnboarded) router.replace('/onboarding');
      else if (authStatus !== 'authenticated') router.replace('/login');
      // Store staff, riders, and admin all have no delivery location
      // and no customer shopping nav (section 45) — straight to their
      // own operational surface.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- app/store/**, app/rider/**, app/admin/** are new; .expo/types/router.d.ts needs a local `expo start` (network access) to regenerate. Real, valid routes.
      else if (isStoreUser) router.replace('/store' as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else if (isRider) router.replace('/rider' as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      else if (isAdmin) router.replace('/admin' as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- app/welcome.tsx is new; .expo/types/router.d.ts needs a local `expo start` (network access) to regenerate. Real, valid route.
      else if (!profile?.hasName) router.replace('/welcome' as any);
      else if (!selectedLocation) router.replace('/location');
      else router.replace('/(tabs)');
    }, minSplashMs);

    return () => clearTimeout(timer);
  }, [authStatus, hasOnboarded, selectedLocation, profile, hasPendingNotificationTarget]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
    transform: [{ translateY: taglineY.value }],
  }));

  return (
    <View style={styles.container}>
      {FLOATING_ICONS.map((spec, i) => (
        <FloatingIcon key={i} {...spec} />
      ))}
      <Animated.View style={[styles.logoBlock, logoStyle]}>
        <Monogram size={200} />
      </Animated.View>
      <Animated.Text style={[styles.tagline, taglineStyle]}>Quality You Can Taste</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primaryDarker,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBlock: { alignItems: 'center' },
  floatingChip: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(198,154,76,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagline: {
    position: 'absolute',
    bottom: 80,
    fontFamily: 'PlayfairDisplay_500Medium',
    fontSize: 16,
    letterSpacing: 0.5,
    color: colors.goldTint,
  },
});
