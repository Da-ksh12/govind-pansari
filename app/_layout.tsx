// Deliberately the first import in this file — see that module's own
// comment for why: it must run before every other local module so a
// crash during their evaluation (before React even mounts) is still
// captured.
import '../services/monitoring/sentry';
import * as Sentry from '@sentry/react-native';
import { useEffect, useCallback, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts as usePlayfair, PlayfairDisplay_500Medium, PlayfairDisplay_600SemiBold, PlayfairDisplay_700Bold } from '@expo-google-fonts/playfair-display';
import {
  useFonts as useJakarta,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { colors } from '../theme';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { OptionalBoundary } from '../components/OptionalBoundary';
import { OfflineBanner } from '../components/ui/OfflineBanner';
import { ToastHost } from '../components/ui/ToastHost';
import { InAppNotificationBanner } from '../components/notifications/InAppNotificationBanner';
import { NewDeliveryPrompt } from '../components/rider/NewDeliveryPrompt';
import { CartFlyOverlay } from '../components/cart/CartFlyOverlay';
import { useAuthStore } from '../store/authStore';
import { configureNotificationHandler } from '../services/notifications/pushRegistration';
import { useNotificationResponseNavigation } from '../hooks/useNotificationResponseNavigation';

const FONT_LOAD_TIMEOUT_MS = 8000;

SplashScreen.preventAutoHideAsync().catch(() => {});
configureNotificationHandler();

function RootLayout() {
  useEffect(() => {
    useAuthStore.getState().initialize();
  }, []);

  useNotificationResponseNavigation();

  // Logging out from ANY screen (admin/store/rider/customer) only ever
  // cleared session state — nothing redirected, since every per-role
  // layout's own auth guard only checked "is this the wrong role",
  // never "did we just become unauthenticated". Only the splash screen
  // (app/index.tsx) knew how to route based on auth status, and it's
  // not mounted once you're inside the app — so logging out left the
  // user stranded on their current (now-broken) screen until they
  // force-quit and relaunched. This is the one place mounted for the
  // whole app's lifetime, so it's the one place that can catch every
  // logout regardless of where it happened.
  const authStatus = useAuthStore((s) => s.status);
  const wasAuthenticated = useRef(false);
  useEffect(() => {
    if (authStatus === 'authenticated') wasAuthenticated.current = true;
    else if (authStatus === 'unauthenticated' && wasAuthenticated.current) {
      wasAuthenticated.current = false;
      router.replace('/login');
    }
  }, [authStatus]);

  const [playfairLoaded, playfairError] = usePlayfair({
    PlayfairDisplay_500Medium,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
  });
  const [jakartaLoaded, jakartaError] = useJakarta({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  // A font that fails to load, or never settles, must not leave the
  // splash screen up forever with nothing rendered behind it: report the
  // failure and continue with the platform's fallback font instead.
  const [fontWaitExpired, setFontWaitExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFontWaitExpired(true), FONT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);
  const fontError = playfairError ?? jakartaError;
  useEffect(() => {
    if (fontError) {
      // eslint-disable-next-line no-console
      console.error('Font loading failed; continuing with system fonts:', fontError);
      Sentry.captureException(fontError);
    }
  }, [fontError]);

  const fontsReady = (playfairLoaded || !!playfairError) && (jakartaLoaded || !!jakartaError);
  const readyToRender = fontsReady || fontWaitExpired;

  useEffect(() => {
    if (readyToRender) SplashScreen.hideAsync().catch(() => {});
  }, [readyToRender]);

  const onLayoutRootView = useCallback(() => {}, []);

  if (!readyToRender) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <StatusBar style="dark" />
          <OptionalBoundary name="OfflineBanner">
            <OfflineBanner />
          </OptionalBoundary>
          <ErrorBoundary>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
                animation: 'slide_from_right',
              }}
            >
              <Stack.Screen name="index" options={{ animation: 'fade' }} />
              <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
              <Stack.Screen name="store" options={{ animation: 'fade' }} />
              <Stack.Screen name="rider" options={{ animation: 'fade' }} />
              <Stack.Screen
                name="cart"
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
              <Stack.Screen
                name="checkout"
                options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
              />
            </Stack>
            <OptionalBoundary name="InAppNotificationBanner">
              <InAppNotificationBanner />
            </OptionalBoundary>
            <OptionalBoundary name="NewDeliveryPrompt">
              <NewDeliveryPrompt />
            </OptionalBoundary>
            <OptionalBoundary name="CartFlyOverlay">
              <CartFlyOverlay />
            </OptionalBoundary>
            <OptionalBoundary name="ToastHost">
              <ToastHost />
            </OptionalBoundary>
          </ErrorBoundary>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap adds navigation/route breadcrumbs and a final top-level
// error boundary of its own (belt-and-braces alongside the app's own
// ErrorBoundary below) — a no-op if EXPO_PUBLIC_SENTRY_DSN isn't set.
export default Sentry.wrap(RootLayout);
