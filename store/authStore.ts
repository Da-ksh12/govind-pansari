import { create } from 'zustand';
import { AppState } from 'react-native';
import { authService } from '../services/supabase/authService';
import { userRepository, NotSignedInError } from '../services/repositories/userRepository';
import { retryWithDelays } from '../services/retry';
import { profileAfterRefetch } from '../services/profileState';
import { useCartStore } from './cartStore';
import { useWishlistStore } from './wishlistStore';
import { useOrdersStore } from './ordersStore';
import { useStoreOpsStore } from './storeOpsStore';
import { useNotificationsStore } from './notificationsStore';
import { useAdminStore } from './adminStore';
import { registerForPushNotifications, deactivateCurrentDeviceToken } from '../services/notifications/pushRegistration';
import type { UserProfile } from '../types/models';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  profile: UserProfile | null;
  /**
   * Signed in, but the profile could not be read (weak connection). The profile is then unknown, NOT empty: nothing may treat it as
   * "no name yet" — the splash screen offers a retry instead (see services/startupRoute.ts).
   */
  profileError: boolean;
  pendingPhone: string | null;
  /** Email OTP flow (added alongside phone) — mutually exclusive with pendingPhone; app/otp.tsx checks whichever is set. */
  pendingEmail: string | null;
  initialized: boolean;
  /** The user id cart/wishlist were last loaded for — avoids re-fetching on every TOKEN_REFRESHED for the same signed-in user. */
  loadedForUserId: string | null;
  /** Subscribes to Supabase's own auth state — call once, at the app root. Supabase's session is the source of truth; this store only mirrors it. */
  initialize: () => void;
  setPendingPhone: (phone: string) => void;
  setPendingEmail: (email: string) => void;
  /** Reads the profile again (a few quick retries on a weak connection). Throws only after every try failed; the profile already held is kept. */
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

/** Pauses between the tries at reading the profile: up to three tries, about 2.5 s in all, before giving up. */
const PROFILE_RETRY_DELAYS_MS = [700, 1800];

const loadProfile = (userId?: string) =>
  retryWithDelays(() => userRepository.getProfile(userId), PROFILE_RETRY_DELAYS_MS, {
    shouldRetry: (error) => !(error instanceof NotSignedInError),
  });

/**
 * What a freshly signed-in user needs loaded. What gets loaded depends on role, so it waits for the profile — store_manager/staff
 * never need a cart/wishlist/order-history fetch, and a customer never needs the store-ops assignment. Safe to call again for the
 * same user: it does nothing once that user is primed.
 */
function primeSession(userId: string, profile: UserProfile) {
  if (useAuthStore.getState().loadedForUserId === userId) return;
  if (profile.role === 'store_manager' || profile.role === 'staff') {
    useStoreOpsStore.getState().load();
  } else if (profile.role === 'rider') {
    // Rider screens fetch their own data per-screen
    // (get_rider_dashboard() etc.) — no shared store to prime.
  } else if (profile.role === 'admin') {
    useAdminStore.getState().load();
  } else {
    useCartStore.getState().loadCart();
    useWishlistStore.getState().loadWishlist();
    useOrdersStore.getState().loadOrders();
    useOrdersStore.getState().startRealtime(userId);
  }
  // Notifications matter to every role — customer, rider, store
  // staff, and admin alike.
  useNotificationsStore.getState().refreshUnreadCount();
  useNotificationsStore.getState().startRealtime(userId);
  registerForPushNotifications().catch(() => {
    // Best-effort — a customer who denies the permission prompt,
    // or a simulator with no push capability, must never block
    // sign-in (section 53).
  });
  useAuthStore.setState({ loadedForUserId: userId });
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: 'loading',
  profile: null,
  profileError: false,
  pendingPhone: null,
  pendingEmail: null,
  initialized: false,
  loadedForUserId: null,

  initialize: () => {
    if (get().initialized) return;
    set({ initialized: true });

    // onAuthStateChange fires immediately with INITIAL_SESSION on
    // subscribe (session restore), then again on every SIGNED_IN /
    // SIGNED_OUT / TOKEN_REFRESHED / USER_UPDATED — one listener
    // covers session restore and every subsequent change.
    authService.onAuthStateChange(async (_event, session) => {
      if (!session?.user) {
        set({ status: 'unauthenticated', profile: null, profileError: false, loadedForUserId: null });
        return;
      }

      // The user id comes from the session itself: no extra request to learn it.
      const userId = session.user.id;
      let profile: UserProfile | null = null;
      try {
        profile = await loadProfile(userId);
      } catch {
        // Session exists but the profile query failed on every try (a weak
        // connection) — still authenticated, and the profile is UNKNOWN, not empty.
      }

      // A profile that could not be read this time does not erase the one already loaded for this same user (a failed refetch on a
      // routine token refresh used to blank it, which the splash then read as "no name yet").
      const known = profileAfterRefetch(profile, get().profile, userId);

      // Loaded once per actual sign-in — not on every TOKEN_REFRESHED for
      // the same already-loaded user (section 22: "never leak one
      // customer's cart to another" cuts both ways — also don't thrash
      // already-loaded state on a routine token refresh). Without a profile
      // the role is unknown, so this waits for the next successful read.
      if (known) primeSession(userId, known);

      set({ status: 'authenticated', profile: known, profileError: !known, pendingPhone: null, pendingEmail: null });
    });

    // Priority 8 (pre-production hardening) + rider-offer-popup root
    // cause fix: the notifications Realtime *socket* itself suspends
    // while the app is backgrounded (a mobile OS routinely throttles or
    // drops background WebSocket connections) and does not silently
    // reconnect on its own. Refreshing counts/lists on foreground (as
    // this already did) masked the symptom for the notification bell,
    // but never actually revived the dead subscription — so a rider who
    // backgrounded the app even briefly would keep receiving push
    // notifications (a fully separate delivery path through Expo Push,
    // which is why vibration still worked) while the in-app
    // Realtime-driven NewDeliveryPrompt popup silently stopped updating
    // until the next full app relaunch. startRealtime() is idempotent
    // (it always tears down any existing channel before opening a new
    // one — see notificationsStore.ts), so re-calling it on every
    // foreground transition is always safe and is what actually
    // re-establishes a live connection. The existing
    // getMyOpenOffer()/useRefetchOnForeground fallback in
    // NewDeliveryPrompt still separately covers the case where an offer
    // was created and already expired-or-answered entirely while
    // backgrounded (Postgres Changes has no replay/backlog); this fix
    // covers the much more common case — the rider is looking at the
    // app, or just glanced away and back, when a new offer comes in.
    AppState.addEventListener('change', (state) => {
      if (state === 'active' && get().status === 'authenticated') {
        // Signed in but the profile never loaded (offline at launch): try again now that the app is back in front.
        if (get().profileError) get().refreshProfile().catch(() => {});
        const userId = get().profile?.id;
        if (userId) useNotificationsStore.getState().startRealtime(userId);
        useNotificationsStore.getState().refreshUnreadCount();
        if (useNotificationsStore.getState().loaded) useNotificationsStore.getState().refresh();
        if (useOrdersStore.getState().loaded) useOrdersStore.getState().loadOrders();
      }
    });
  },

  setPendingPhone: (phone) => set({ pendingPhone: phone, pendingEmail: null }),
  setPendingEmail: (email) => set({ pendingEmail: email, pendingPhone: null }),

  refreshProfile: async () => {
    try {
      const profile = await loadProfile();
      primeSession(profile.id, profile);
      set({ profile, profileError: false });
    } catch (error) {
      if (!(error instanceof NotSignedInError) && !get().profile) set({ profileError: true });
      throw error;
    }
  },

  logout: async () => {
    // Deactivate this device's own push token while the session is
    // still valid (section 55) — never another device (section 56),
    // and best-effort only: a failed deactivate must not block sign-out.
    await deactivateCurrentDeviceToken().catch(() => {});
    await authService.signOut();
    // onAuthStateChange's SIGNED_OUT event will flip status/profile,
    // but private local state needs an explicit clear here so it
    // can't leak to the next account signed in on this device. Local
    // only — logging out must never empty the server-side cart (the
    // customer's items are still there next time they sign in).
    useCartStore.getState().clearLocal();
    useWishlistStore.getState().clearLocal();
    useOrdersStore.getState().clearLocal();
    useStoreOpsStore.getState().clearLocal();
    useNotificationsStore.getState().clearLocal();
    useAdminStore.getState().clearLocal();
    set({ loadedForUserId: null, profileError: false });
  },
}));
