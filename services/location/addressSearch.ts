import NetInfo from '@react-native-community/netinfo';
import type { LatLng } from '../../types/models';
import { GOOGLE_ADDRESS_ENABLED } from './addressProvider';
import { addressLookup } from './addressLookup';
import { geocodingService } from './geocodingService';
import { placesSearchService, type PlaceSearchResult } from './placesSearchService';
import { AddressLookupError, canFallBack, type AddressSuggestion, type ResolvedAddress } from './addressTypes';
import { sanePostalCode, type OsmReverse } from './osmAddress';
import { enrichAddress } from './placeEnrichment';
import { getPlaceContext } from './placeData';

/**
 * Address search for the picker, with one provider chain:
 *   Google Maps Platform (via the address-lookup Edge Function)  →  OpenStreetMap search / the phone's own geocoder.
 * Google is used only when the build turns it on (see addressProvider.ts) — that is also the build that shows a Google
 * map, because Google's terms require its place data to be displayed on a Google map. If Google is not set up, refuses
 * the key or is down, the previous providers answer instead; offline and rate-limited are reported as such, never
 * papered over with an empty list.
 */

function fromOsm(result: PlaceSearchResult): AddressSuggestion {
  const resolved: ResolvedAddress = {
    position: result.position,
    formattedAddress: result.addressLine,
    placeId: null,
    placeName: result.placeName ?? null,
    parts: { street: null, locality: null, city: result.city ?? null, state: result.state ?? null, postalCode: result.postalCode ?? null, premise: null },
    source: 'osm',
    precision: null,
  };
  return { id: `osm:${result.id}`, primary: result.placeName ?? result.label, secondary: result.addressLine, source: 'osm', resolved };
}

async function offline(): Promise<boolean> {
  try {
    const s = await NetInfo.fetch();
    return s.isConnected === false || s.isInternetReachable === false;
  } catch {
    return false;
  }
}

export const addressSearch = {
  /** Shown next to results so the customer knows who supplied them. */
  attribution(source: 'google' | 'osm' | 'device'): string | null {
    return source === 'google' ? 'Google Maps' : source === 'osm' ? '© OpenStreetMap contributors' : null;
  },

  async suggest(query: string, sessionToken: string, bias: LatLng | null): Promise<AddressSuggestion[]> {
    if (GOOGLE_ADDRESS_ENABLED) {
      try {
        const list = await addressLookup.autocomplete(query, sessionToken, bias ? { lat: bias.lat, lng: bias.lng } : null);
        return list.map((s) => ({ id: `google:${s.placeId}`, primary: s.primary, secondary: s.secondary || s.description, source: 'google' as const, resolved: null }));
      } catch (e) {
        if (!(e instanceof AddressLookupError) || !canFallBack(e.kind)) throw e;
        // fall through to OpenStreetMap
      }
    }
    try {
      return (await placesSearchService.search(query)).map(fromOsm);
    } catch (e) {
      if (e instanceof AddressLookupError) throw new AddressLookupError((await offline()) ? 'offline' : e.kind);
      throw e;
    }
  },

  /** Turns a chosen suggestion into a position + address parts. Google suggestions cost one Place Details call (ends the billing session). */
  async resolve(suggestion: AddressSuggestion, sessionToken: string): Promise<ResolvedAddress> {
    if (suggestion.resolved) return suggestion.resolved;
    return addressLookup.details(suggestion.id.replace(/^google:/, ''), sessionToken, suggestion.primary);
  },

  /**
   * The address at a pin. Never throws for "no provider could say": the caller still has the coordinates and the
   * customer types the address. `error` tells it whether to explain (offline / rate limited) or stay quiet.
   */
  async reverse(position: LatLng): Promise<{ address: ResolvedAddress | null; error: AddressLookupError | null }> {
    const fromProviders = await addressSearch.reverseFromProviders(position);
    // Whatever a provider said is then checked against Agra's own place data: the closest colony / sector, the street, a landmark and a
    // pincode (an OpenStreetMap-only answer for a pin in Vijay Nagar is the big "Civil Lines" suburb). This never throws and never
    // makes an answer worse: with no local data it returns the provider's answer unchanged.
    try {
      const ctx = await getPlaceContext();
      const enriched = enrichAddress(position, fromProviders.address, ctx);
      if (enriched) return { address: enriched, error: fromProviders.address ? fromProviders.error : null };
    } catch {
      // local data unavailable: fall through to the provider's answer
    }
    return fromProviders;
  },

  /** What the online/on-device providers know about the pin, before the local Agra data is applied. */
  async reverseFromProviders(position: LatLng): Promise<{ address: ResolvedAddress | null; error: AddressLookupError | null }> {
    if (GOOGLE_ADDRESS_ENABLED) {
      try {
        return { address: await addressLookup.reverse(position.lat, position.lng), error: null };
      } catch (e) {
        if (!(e instanceof AddressLookupError)) return { address: null, error: new AddressLookupError('unavailable') };
        if (!canFallBack(e.kind)) return { address: null, error: e };
      }
    }
    // OpenStreetMap first: it knows the road and the colony where they are mapped, which the phone's own geocoder usually
    // does not ("Wazirpura Road, Swadhesi Bima Colony, Civil Lines" vs "Agra, Uttar Pradesh").
    let osm: OsmReverse | null = null;
    let osmError: AddressLookupError | null = null;
    try {
      osm = await placesSearchService.reverse(position);
    } catch (e) {
      osmError = e instanceof AddressLookupError ? e : new AddressLookupError('unavailable');
    }
    if (osm && osm.precision !== 'city') {
      return {
        address: {
          position,
          formattedAddress: osm.formattedAddress,
          placeId: null,
          placeName: osm.parts.premise,
          parts: osm.parts,
          source: 'osm',
          precision: osm.precision,
        },
        error: null,
      };
    }

    const device = await geocodingService.reverseGeocode(position);
    if (device) {
      return {
        address: {
          position,
          formattedAddress: device.addressLine,
          placeId: null,
          placeName: null,
          parts: {
            street: device.street ?? null,
            locality: device.locality ?? null,
            city: device.city ?? null,
            state: device.state ?? null,
            postalCode: sanePostalCode(device.postalCode, device.state),
            premise: null,
          },
          source: 'device',
          precision: null,
        },
        error: null,
      };
    }
    if (osm) {
      return { address: { position, formattedAddress: osm.formattedAddress, placeId: null, placeName: null, parts: osm.parts, source: 'osm', precision: osm.precision }, error: null };
    }
    // Neither could say anything about the spot. Offline or rate-limited is worth telling the customer; "nothing mapped here" is not an error.
    if (osmError && (await offline())) return { address: null, error: new AddressLookupError('offline') };
    return { address: null, error: osmError && !canFallBack(osmError.kind) ? osmError : null };
  },
};
