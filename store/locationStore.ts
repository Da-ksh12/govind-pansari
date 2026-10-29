import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LatLng } from '../types/models';
import type { ServiceabilityResult } from '../services/repositories/storeRepository';

export interface SelectedLocation {
  label: string; // e.g. "Vijay Nagar Colony, Agra" — only ever the customer's own pick, never a default
  addressLine: string;
  position: LatLng;
  /** Set when the selection came from a saved address rather than current-location/search. */
  addressId?: string;
}

interface LocationState {
  selected: SelectedLocation | null;
  serviceability: ServiceabilityResult | null;
  etaMinMin: number;
  etaMinMax: number;
  /**
   * Sets the location together with a *fresh* serviceability result —
   * there is no path to mark a location serviceable without actually
   * calling checkServiceability() first (client-side coordinates are
   * untrusted input; a cached "serviceable" from a previous session is
   * never treated as still true).
   */
  setLocation: (location: SelectedLocation, serviceability: ServiceabilityResult) => void;
  clear: () => void;
}

const DEFAULT_ETA_MIN = 25;
const DEFAULT_ETA_MAX = 35;

export const useLocationStore = create<LocationState>()(
  persist(
    (set) => ({
      selected: null,
      serviceability: null,
      etaMinMin: DEFAULT_ETA_MIN,
      etaMinMax: DEFAULT_ETA_MAX,

      setLocation: (location, serviceability) => {
        const etaMax = serviceability.serviceable ? serviceability.estimatedDeliveryMinutes : DEFAULT_ETA_MAX;
        set({
          selected: location,
          serviceability,
          etaMinMin: Math.max(10, etaMax - 10),
          etaMinMax: etaMax,
        });
      },

      clear: () => set({ selected: null, serviceability: null }),
    }),
    {
      name: 'gp-location',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
