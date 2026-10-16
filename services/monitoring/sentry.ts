import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Called as a side effect of importing this module — see app/_layout.tsx,
 * where this is deliberately the very first import, so it runs before
 * every other local module (including services/supabase/client.ts, whose
 * own missing-config guard is exactly the class of startup crash this
 * exists to catch next time: see docs on that 2026-10-14 production
 * incident). The @sentry/react-native Expo config plugin additionally
 * installs a native-level crash handler (Android Application.onCreate /
 * iOS AppDelegate) wired up at native init — before Hermes even starts
 * evaluating the JS bundle — so even a crash earlier than this call can
 * still be captured, independent of JS import order.
 *
 * No DSN configured -> a real, declared "monitoring is off" state, not a
 * silent failure: logged once in dev, otherwise just skipped. This must
 * never be the thing that crashes the app, so every call into the SDK
 * here is defensively guarded — unlike services/supabase/client.ts's
 * deliberately loud throw on missing config, a broken monitoring setup
 * should never take the whole app down with it.
 */
export function initSentry(): void {
  if (!dsn) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[sentry] EXPO_PUBLIC_SENTRY_DSN is not set — crash reporting is off.');
    }
    return;
  }
  try {
    Sentry.init({
      dsn,
      debug: __DEV__,
      // Real release/preview builds only — never spam the Sentry project
      // with every local Metro dev session.
      enabled: !__DEV__,
      environment: __DEV__ ? 'development' : 'production',
      tracesSampleRate: 0.2,
    });
  } catch (e) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[sentry] init failed:', e);
    }
  }
}

initSentry();
