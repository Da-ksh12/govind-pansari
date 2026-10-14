import { create } from 'zustand';

interface FlyingItem {
  id: number;
  uri: string | undefined;
  startX: number;
  startY: number;
  size: number;
}

interface CartFlyState {
  flying: FlyingItem | null;
  pulseTrigger: number;
  fly: (params: { uri: string | undefined; startX: number; startY: number; size: number }) => void;
  clear: () => void;
  pulse: () => void;
}

let nextId = 1;

/**
 * Drives the "product flies into the cart" animation (Zepto/Blinkit
 * pattern) — a global store rather than prop-drilling, since the start
 * point (wherever the Add button was tapped, on any screen) and the
 * landing point (the cart bag icon, rendered once near the root) are
 * in completely unrelated parts of the component tree.
 */
export const useCartFlyStore = create<CartFlyState>((set) => ({
  flying: null,
  pulseTrigger: 0,
  fly: ({ uri, startX, startY, size }) => set({ flying: { id: nextId++, uri, startX, startY, size } }),
  clear: () => set({ flying: null }),
  pulse: () => set((s) => ({ pulseTrigger: s.pulseTrigger + 1 })),
}));
