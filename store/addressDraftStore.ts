import { create } from 'zustand';
import type { LatLng } from '../types/models';
import type { ResolvedAddress } from '../services/location/addressTypes';

export interface PickedMapLocation {
  /** The confirmed pin. These coordinates — not the address text — are what delivery and serviceability use. */
  position: LatLng;
  /** What the provider said about that spot. Null when nothing could be looked up (offline, no result): the customer types it. */
  address: ResolvedAddress | null;
}

interface AddressDraftState {
  pickedLocation: PickedMapLocation | null;
  setPickedLocation: (loc: PickedMapLocation) => void;
  clear: () => void;
}

/**
 * A one-shot handoff, not app state worth persisting: the map picker (app/address/map-pick.tsx) writes the confirmed pin
 * here and calls router.back() rather than push/replace, so the Add Address screen underneath keeps every field the
 * customer already typed (recipient name, phone, house number, instructions) instead of remounting fresh with only the
 * picked coordinates. Add Address reads this once on refocus and clears it immediately after applying it.
 */
export const useAddressDraftStore = create<AddressDraftState>((set) => ({
  pickedLocation: null,
  setPickedLocation: (loc) => set({ pickedLocation: loc }),
  clear: () => set({ pickedLocation: null }),
}));
