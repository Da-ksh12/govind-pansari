import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cartRepository } from '../services/repositories/cartRepository';
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

const lineId = (variantId: string) => `cart-${variantId}`;
const variantIdOf = (cartItemId: string) => cartItemId.replace(/^cart-/, '');

function reportError(message: string) {
  useUIStore.getState().showToast(message, 'error');
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      loading: false,

      loadCart: async () => {
        set({ loading: true });
        try {
          const enriched = await cartRepository.list();
          get().applyServerCart(enriched);
        } catch {
          // Keep whatever local state exists (e.g. from persisted
          // storage) rather than wiping the cart on a transient
          // network failure at startup.
        } finally {
          set({ loading: false });
        }
      },

      applyServerCart: (serverItems) =>
        set((state) => {
          const savedVariantIds = new Set(state.items.filter((i) => i.savedForLater).map((i) => i.variantId));
          return {
            items: serverItems.map((s) => ({
              id: lineId(s.variantId),
              productId: s.productId,
              variantId: s.variantId,
              quantity: s.quantity,
              ...(savedVariantIds.has(s.variantId) ? { savedForLater: true as const } : {}),
            })),
          };
        }),

      addItem: (productId, variantId, quantity = 1) => {
        const previous = get().items;
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

        cartRepository.addToCart(variantId, quantity).catch(() => {
          set({ items: previous });
          reportError("Couldn't add that to your cart. Please try again.");
        });
      },

      removeItem: (cartItemId) => {
        const previous = get().items;
        set((state) => ({ items: state.items.filter((i) => i.id !== cartItemId) }));

        cartRepository.remove(variantIdOf(cartItemId)).catch(() => {
          set({ items: previous });
          reportError("Couldn't remove that item. Please try again.");
        });
      },

      setQuantity: (cartItemId, quantity) => {
        const previous = get().items;
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((i) => i.id !== cartItemId)
              : state.items.map((i) => (i.id === cartItemId ? { ...i, quantity } : i)),
        }));

        cartRepository.setQuantity(variantIdOf(cartItemId), Math.max(0, quantity)).catch(() => {
          set({ items: previous });
          reportError("Couldn't update quantity. Please try again.");
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
        const previous = get().items;
        const activeVariantIds = previous.filter((i) => !i.savedForLater).map((i) => i.variantId);
        set((state) => ({ items: state.items.filter((i) => i.savedForLater) }));

        Promise.all(activeVariantIds.map((id) => cartRepository.remove(id))).catch(() => {
          set({ items: previous });
          reportError("Couldn't clear your cart. Please try again.");
        });
      },

      clearLocal: () => set({ items: [] }),
    }),
    {
      name: 'gp-cart',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
