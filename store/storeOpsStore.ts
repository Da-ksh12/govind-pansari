import { create } from 'zustand';
import { storeOpsRepository, type MyStoreAssignment } from '../services/repositories/storeOpsRepository';

interface StoreOpsState {
  myStores: MyStoreAssignment[];
  activeStoreId: string | null;
  loading: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  setActiveStore: (storeId: string) => void;
  clearLocal: () => void;
}

/** Which store(s) the signed-in store_manager/staff user is assigned
 * to, and which one they're currently operating (section 3 — a store
 * user's access is scoped to their own store membership, never every
 * store). Most demo/seed staff belong to exactly one store, so
 * activeStoreId defaults to the first assignment; a user with more
 * than one would need a store switcher (not built this phase — no
 * seeded staff member needs one). */
export const useStoreOpsStore = create<StoreOpsState>((set, get) => ({
  myStores: [],
  activeStoreId: null,
  loading: false,
  loaded: false,

  load: async () => {
    set({ loading: true });
    try {
      const myStores = await storeOpsRepository.getMyStores();
      set((state) => ({
        myStores,
        activeStoreId: state.activeStoreId && myStores.some((s) => s.storeId === state.activeStoreId) ? state.activeStoreId : (myStores[0]?.storeId ?? null),
        loading: false,
        loaded: true,
      }));
    } catch {
      set({ loading: false });
    }
  },

  setActiveStore: (storeId) => set({ activeStoreId: storeId }),

  clearLocal: () => set({ myStores: [], activeStoreId: null, loading: false, loaded: false }),
}));
