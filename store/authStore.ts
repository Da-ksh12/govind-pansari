import { create } from 'zustand';
import { AppState } from 'react-native';
import { authService } from '../services/supabase/authService';
import { userRepository } from '../services/repositories/userRepository';
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
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  status: 'loading',
  profile: null,
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
        set({ status: 'unauthenticated', profile: null, loadedForUserId: null });
        return;
      }

      // Load once per actual sign-in — not on every TOKEN_REFRESHED for
      // the same already-loaded user (section 22: "never leak one
      // customer's cart to another" cuts both ways — also don't thrash
      // already-loaded state on a routine token refresh). What gets
      // loaded depends on role, so the profile is fetched first —
      // store_manager/staff never need a cart/wishlist/order-history
      // fetch, and a customer never needs the store-ops assignment.
      const isNewSignIn = get().loadedForUserId !== session.user.id;

      let profile: UserProfile | null = null;
      try {
        profile = await userRepository.getProfile();
      } catch {
        // Session exists but the profile row/query failed (transient
        // network issue) — still authenticated, profile can be
        // refetched by whichever screen needs it.
      }

      if (isNewSignIn) {
        if (profile?.role === 'store_manager' || profile?.role === 'staff') {
          useStoreOpsStore.getState().load();
        } else if (profile?.role === 'rider') {
          // Rider screens fetch their own data per-screen
          // (get_rider_dashboard() etc.) — no shared store to prime.
        } else if (profile?.role === 'admin') {
          useAdminStore.getState().load();
        } else {
          useCartStore.getState().loadCart();
          useWishlistStore.getState().loadWishlist();
          useOrdersStore.getState().loadOrders();
          useOrdersStore.getState().startRealtime(session.user.id);
        }
        // Notifications matter to every role — customer, rider, store
        // staff, and admin alike.
        useNotificationsStore.getState().refreshUnreadCount();
        useNotificationsStore.getState().startRealtime(session.user.id);
        registerForPushNotifications().catch(() => {
          // Best-effort — a customer who denies the permission prompt,
          // or a simulator with no push capability, must never block
          // sign-in (section 53).
        });
        set({ loadedForUserId: session.user.id });
      }

      set({ status: 'authenticated', profile, pendingPhone: null, pendingEmail: null });
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
    const profile = await userRepository.getProfile();
    set({ profile });
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
    set({ loadedForUserId: null });
  },
}));
