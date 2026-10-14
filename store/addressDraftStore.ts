import { create } from 'zustand';
import type { LatLng } from '../types/models';

export interface PickedMapLocation {
  position: LatLng;
  addressLine?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  /** Set only when the pin came from selecting a named place-search
   * result (a building/business/landmark) rather than a plain manual
   * pin drop — Add Address prefers this for line 1 when present. */
  placeName?: string;
}

interface AddressDraftState {
  pickedLocation: PickedMapLocation | null;
  setPickedLocation: (loc: PickedMapLocation) => void;
  clear: () => void;
}

/**
 * A one-shot handoff, not app state worth persisting: the "Pin on Map"
 * picker (app/address/map-pick.tsx) writes the confirmed pin here and
 * calls router.back() rather than push/replace, so the Add Address
 * screen underneath keeps every field the customer already typed
 * (recipient name, phone, label, line 2) instead of remounting fresh
 * with only the picked coordinates. Add Address reads this once on
 * refocus and clears it immediately after applying it.
 */
export const useAddressDraftStore = create<AddressDraftState>((set) => ({
  pickedLocation: null,
  setPickedLocation: (loc) => set({ pickedLocation: loc }),
  clear: () => set({ pickedLocation: null }),
}));
