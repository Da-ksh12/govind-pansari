import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_RECENT = 10;

interface RecentSearchesState {
  terms: string[];
  add: (term: string) => void;
  remove: (term: string) => void;
  clear: () => void;
}

/** Real, on-device search history — previously hardcoded to the same 3 fake terms every launch. Local only, per device, same persistence pattern as useAppStore/useLocationStore. */
export const useRecentSearchesStore = create<RecentSearchesState>()(
  persist(
    (set) => ({
      terms: [],
      add: (term) =>
        set((state) => {
          const trimmed = term.trim();
          if (!trimmed) return state;
          return { terms: [trimmed, ...state.terms.filter((t) => t.toLowerCase() !== trimmed.toLowerCase())].slice(0, MAX_RECENT) };
        }),
      remove: (term) =>
        set((state) => ({ terms: state.terms.filter((t) => t.toLowerCase() !== term.toLowerCase()) })),
      clear: () => set({ terms: [] }),
    }),
    { name: 'gp-recent-searches', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
