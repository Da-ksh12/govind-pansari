import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { wishlistRepository } from '../services/repositories/wishlistRepository';
import { useUIStore } from './uiStore';
import type { WishlistItem } from '../types/models';

interface WishlistState {
  items: WishlistItem[];
  loadWishlist: () => Promise<void>;
  isWishlisted: (productId: string) => boolean;
  toggle: (productId: string) => void;
  remove: (productId: string) => void;
  clearLocal: () => void;
}

function reportError(message: string) {
  useUIStore.getState().showToast(message, 'error');
}

export const useWishlistStore = create<WishlistState>()(
  persist(
    (set, get) => ({
      items: [],

      loadWishlist: async () => {
        try {
          const products = await wishlistRepository.list();
          set({ items: products.map((p) => ({ id: `wish-${p.id}`, productId: p.id, addedAt: new Date().toISOString() })) });
        } catch {
          // keep whatever's persisted locally on a transient failure
        }
      },

      isWishlisted: (productId) => get().items.some((i) => i.productId === productId),

      toggle: (productId) => {
        const wasWishlisted = get().isWishlisted(productId);
        const previous = get().items;

        set((state) => {
          if (wasWishlisted) {
            return { items: state.items.filter((i) => i.productId !== productId) };
          }
          return {
            items: [...state.items, { id: `wish-${productId}`, productId, addedAt: new Date().toISOString() }],
          };
        });

        const sync = wasWishlisted ? wishlistRepository.remove(productId) : wishlistRepository.add(productId);
        sync.catch(() => {
          set({ items: previous });
          reportError("Couldn't update your wishlist. Please try again.");
        });
      },

      remove: (productId) => {
        const previous = get().items;
        set((state) => ({ items: state.items.filter((i) => i.productId !== productId) }));
        wishlistRepository.remove(productId).catch(() => {
          set({ items: previous });
          reportError("Couldn't remove that item. Please try again.");
        });
      },

      clearLocal: () => set({ items: [] }),
    }),
    {
      name: 'gp-wishlist',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
