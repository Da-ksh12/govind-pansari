import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../supabase/client';
import { AddressLookupError, kindFromErrorCode, type ResolvedAddress } from './addressTypes';

/**
 * The app's only way to reach Google Maps Platform. It calls the `address-lookup` Edge Function, which holds the API key,
 * answers only signed-in customers, rate-limits them and asks Google for the cheapest field set. The key is never in the app.
 */

interface LookupPartsWire {
  streetNumber: string | null;
  premise: string | null;
  subpremise: string | null;
  street: string | null;
  locality: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}

interface LookupPlaceWire {
  placeId: string | null;
  formattedAddress: string;
  lat: number;
  lng: number;
  locationType: string | null;
  parts: LookupPartsWire;
}

export interface GoogleSuggestion {
  placeId: string;
  primary: string;
  secondary: string;
  description: string;
  distanceMeters: number | null;
}

async function isOffline(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch {
    return false;
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('address-lookup', { body });
  if (error) {
    const response = (error as { context?: Response }).context;
    if (response && typeof response.status === 'number') {
      // The function answered: take its error code (never its prose) so the app words the failure itself.
      const detail = await response.clone().json().catch(() => null);
      throw new AddressLookupError(kindFromErrorCode(detail?.error, response.status));
    }
    // No answer at all: the phone is offline, or the function could not be reached.
    throw new AddressLookupError((await isOffline()) ? 'offline' : 'unavailable');
  }
  if (!data || data.ok !== true) throw new AddressLookupError(kindFromErrorCode(data?.error));
  return data as T;
}

function toResolved(place: LookupPlaceWire, placeName: string | null): ResolvedAddress {
  return {
    position: { lat: place.lat, lng: place.lng },
    formattedAddress: place.formattedAddress,
    placeId: place.placeId,
    placeName,
    parts: {
      street: place.parts.street,
      locality: place.parts.locality,
      city: place.parts.city,
      state: place.parts.state,
      postalCode: place.parts.postalCode,
      premise: place.parts.premise,
    },
    source: 'google',
    precision: place.locationType,
  };
}

export const addressLookup = {
  async autocomplete(input: string, sessionToken: string, bias: { lat: number; lng: number } | null): Promise<GoogleSuggestion[]> {
    const res = await call<{ suggestions: GoogleSuggestion[] }>({ action: 'autocomplete', input, sessionToken, ...(bias ? { bias } : {}) });
    return res.suggestions;
  },

  async details(placeId: string, sessionToken: string, placeName: string | null): Promise<ResolvedAddress> {
    const res = await call<{ place: LookupPlaceWire }>({ action: 'details', placeId, sessionToken });
    return toResolved(res.place, placeName);
  },

  /** Null when Google has nothing at this point (open fields, water). That is an answer, not an error. */
  async reverse(lat: number, lng: number): Promise<ResolvedAddress | null> {
    const res = await call<{ place: LookupPlaceWire | null }>({ action: 'reverse', lat, lng });
    return res.place ? toResolved(res.place, null) : null;
  },
};
