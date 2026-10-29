import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cartRepository } from '../services/repositories/cartRepository';
import { cartLineId, reconcileWithServer, restoreLine, undoAdd } from '../services/cartSync';
import { useUIStore } from './uiStore';
import type { CartItem } from '../types/models';

interface CartState {
  items: CartItem[];
  loading: boolean;
  /** Pulls the real cart from Supabase, replacing local state — call on sign-in. Never leaves a previous account's items visible to the next one. */
  loadCart: () => Promise<void>;
  /** Reconciles local items against an already-fetched server cart (see cartRepository.list()) — used whenever something outside this store's own mutators changed the server cart (order creation, a failed/cancelled payment) so the local mirror never goes stale. "Saved for later" has no server representation, so that flag is preserved for any variant still present. */
  applyServerCart: (serverItems: { variantId: string; productId: string; quantity: number }[]) => void;
  addItem: (productId: string, variantId: string, quantity?: number) => void;
  removeItem: (cartItemId: string) => void;
  setQuantity: (cartItemId: string, quantity: number) => void;
  incrementVariant: (productId: string, variantId: string) => void;
  decrementVariant: (productId: string, variantId: string) => void;
  quantityForVariant: (variantId: string) => number;
  saveForLater: (cartItemId: string) => void;
  moveToCart: (cartItemId: string) => void;
  removeSaved: (cartItemId: string) => void;
  /** Empties the cart — locally *and* on the server (the "clear cart" UI action). */
  clear: () => void;
  /** Local-only reset, no server call — used on logout so nothing leaks to the next account on this device. */
  clearLocal: () => void;
}

const lineId = cartLineId;
const variantIdOf = (cartItemId: string) => cartItemId.replace(/^cart-/, '');

function reportError(message: string) {
  useUIStore.getState().showToast(message, 'error');
}

// Changes sent to the server that have not answered yet, per variant. A sync from the server must not overwrite a
// line the customer just changed, and a sync that started before a change finished is stale and is thrown away.
const inFlight = new Map<string, number>();
let settledChanges = 0;
const inFlightVariants = (): Set<string> => new Set([...inFlight].filter(([, n]) => n > 0).map(([id]) => id));
function track<T>(variantIds: string[], request: Promise<T>): Promise<T> {
  for (const id of variantIds) inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
  return request.finally(() => {
    settledChanges++;
    for (const id of variantIds) inFlight.set(id, Math.max(0, (inFlight.get(id) ?? 1) - 1));
  });
}

/** The persisted cart is read back asynchronously at startup; a server sync must not race it (the old copy would land on top of the new one). */
function whenHydrated(): Promise<void> {
  const persistApi = (useCartStore as unknown as { persist?: { hasHydrated: () => boolean; onFinishHydration: (fn: () => void) => () => void } }).persist;
  if (!persistApi || persistApi.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = persistApi.onFinishHydration(() => {
      off();
      resolve();
    });
  });
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      loading: false,

      loadCart: async () => {
        set({ loading: true });
        try {
          await whenHydrated();
          // A change that settles while the cart is being fetched makes that answer stale: ask again (a few times at most).
          for (let attempt = 0; attempt < 3; attempt++) {
            const settledBefore = settledChanges;
            const enriched = await cartRepository.list();
            if (settledChanges === settledBefore || attempt === 2) {
              get().applyServerCart(enriched);
              break;
            }
          }
        } catch {
          // The cart could not be read (offline, server error). Keep what is on the device — never replace a real cart
          // with an empty one because of a failed request.
        } finally {
          set({ loading: false });
        }
      },

      applyServerCart: (serverItems) =>
        set((state) => ({ items: reconcileWithServer(state.items, serverItems, inFlightVariants()) as CartItem[] })),

      addItem: (productId, variantId, quantity = 1) => {
        set((state) => {
          const existing = state.items.find((i) => i.variantId === variantId && !i.savedForLater);
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.id === existing.id ? { ...i, quantity: i.quantity + quantity } : i,
              ),
            };
          }
          const newItem: CartItem = { id: lineId(variantId), productId, variantId, quantity };
          return { items: [...state.items, newItem] };
        });

        // A refused add takes back exactly that quantity from that variant — never a snapshot of the whole cart, which
        // would also undo other taps made in the meantime.
        track([variantId], cartRepository.addToCart(variantId, quantity)).catch(() => {
          set((state) => ({ items: undoAdd(state.items, variantId, quantity) as CartItem[] }));
          reportError("Couldn't add that to your cart. Please try again.");
          get().loadCart();
        });
      },

      removeItem: (cartItemId) => {
        const variantId = variantIdOf(cartItemId);
        const previousLine = get().items.find((i) => i.id === cartItemId);
        set((state) => ({ items: state.items.filter((i) => i.id !== cartItemId) }));

        track([variantId], cartRepository.remove(variantId)).catch(() => {
          set((state) => ({ items: restoreLine(state.items, variantId, previousLine) as CartItem[] }));
          reportError("Couldn't remove that item. Please try again.");
          get().loadCart();
        });
      },

      setQuantity: (cartItemId, quantity) => {
        const variantId = variantIdOf(cartItemId);
        const previousLine = get().items.find((i) => i.id === cartItemId);
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.id !== cartItemId)
              : state.items.map((i) => (i.id === cartItemId ? { ...i, quantity } : i)),
        }));

        track([variantId], cartRepository.setQuantity(variantId, Math.max(0, quantity))).catch(() => {
          set((state) => ({ items: restoreLine(state.items, variantId, previousLine) as CartItem[] }));
          reportError("Couldn't update quantity. Please try again.");
          get().loadCart();
        });
      },

      incrementVariant: (productId, variantId) => get().addItem(productId, variantId, 1),

      decrementVariant: (productId, variantId) => {
        const id = lineId(variantId);
        const existing = get().items.find((i) => i.id === id);
        if (!existing) return;
        get().setQuantity(id, existing.quantity - 1);
      },

      quantityForVariant: (variantId) => {
        const item = get().items.find((i) => i.variantId === variantId && !i.savedForLater);
        return item?.quantity ?? 0;
      },

      // "Saved for later" has no server-side table yet (out of Phase
      // 04's explicit scope — cart_items has no such column) — stays
      // local-only/session-scoped, same as before this phase.
      saveForLater: (cartItemId) =>
        set((state) => ({
          items: state.items.map((i) => (i.id === cartItemId ? { ...i, savedForLater: true } : i)),
        })),

      moveToCart: (cartItemId) =>
        set((state) => ({
          items: state.items.map((i) => (i.id === cartItemId ? { ...i, savedForLater: false } : i)),
        })),

      removeSaved: (cartItemId) =>
        set((state) => ({ items: state.items.filter((i) => i.id !== cartItemId) })),

      clear: () => {
        const cleared = get().items.filter((i) => !i.savedForLater);
        const activeVariantIds = cleared.map((i) => i.variantId);
        set((state) => ({ items: state.items.filter((i) => i.savedForLater) }));

        track(activeVariantIds, Promise.all(activeVariantIds.map((id) => cartRepository.remove(id)))).catch(() => {
          // Put back only the lines that were cleared (anything added since is kept).
          set((state) => {
            let items: CartItem[] = state.items;
            for (const line of cleared) if (!items.some((i) => i.variantId === line.variantId)) items = restoreLine(items, line.variantId, line) as CartItem[];
            return { items };
          });
          reportError("Couldn't clear your cart. Please try again.");
          get().loadCart();
        });
      },

      clearLocal: () => set({ items: [] }),
    }),
    {
      name: 'gp-cart',
      storage: createJSONStorage(() => AsyncStorage),
      // Only the lines are stored: no loading flags, no tokens, no payment details.
      partialize: (state) => ({ items: state.items }),
    },
  ),
);
