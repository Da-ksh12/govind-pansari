// Merges what a provider said about a pin (OpenStreetMap / Google / the phone) with the local Agra place data, so a pin in Vijay Nagar
// reads "Vijay Nagar Colony", not "Civil Lines". Pure: the provider's answer and the place index go in, a better answer comes out.
import type { LatLng } from '../../types/models';
import type { ResolvedAddress } from './addressTypes';
import { describePlace, normalizeName, type IndexedPlaces } from './placeIndex';
import { BROAD_AREA_METERS } from './localityIndex';
import { sanePostalCode } from './osmAddress';

/** The locality the local data may replace: the pin must be inside the block, or close to a store/colony anchor. */
const REPLACE_WITHIN_METERS = 800;
/** A specific colony this close replaces a provider's whole-suburb answer even when the pin is just outside the colony. */
const SPECIFIC_NEAR_METERS = 600;

export interface EnrichContext {
  places: IndexedPlaces;
  /** City to use when the provider gave none (the nearest store's city, within service range). */
  fallbackCity?: string | null;
}

const joinLine = (parts: (string | null | undefined)[]) => parts.map((p) => (p ?? '').trim()).filter(Boolean).join(', ');

/** The provider's answer with the closest block, street, a landmark and a pincode filled in from local data — each only with evidence. */
export function enrichAddress(position: LatLng, base: ResolvedAddress | null, ctx: EnrichContext): ResolvedAddress | null {
  const found = describePlace(position, ctx.places);
  const baseParts = base?.parts ?? { street: null, locality: null, city: null, state: null, postalCode: null, premise: null };

  // street: the provider's own is kept; the local list only fills a gap
  const street = baseParts.street ?? found.street?.name ?? null;

  // locality: the closest block beats the provider's when the pin is inside it (or close to a store's own colony); a provider answer
  // that says nothing at all is replaced by the nearest block, shown as "near" so it never claims more than it knows.
  let locality = baseParts.locality;
  const loc = found.locality;
  const localWins = !!loc && (loc.inside || (loc.kind === 'store' && loc.distanceM <= REPLACE_WITHIN_METERS));
  // The provider's answer is a whole suburb ("Civil Lines"): it says almost nothing, so a specific colony close by replaces it.
  const firstPart = (baseParts.locality ?? '').split(',')[0]?.trim() ?? '';
  const providerIsBroad =
    !!firstPart && ctx.places.localities.some((l) => l.kind === 'area' && l.radiusM >= BROAD_AREA_METERS && normalizeName(l.name) === normalizeName(firstPart));
  if (loc && (localWins || !locality || (providerIsBroad && loc.name !== firstPart && loc.distanceM <= SPECIFIC_NEAR_METERS))) locality = loc.name;

  // pincode: an India Post area-name match is authoritative; otherwise the provider's (already sanity-checked), otherwise nearby map tags
  const providerPin = sanePostalCode(baseParts.postalCode, baseParts.state);
  let postalCode = providerPin;
  let pinInfo: NonNullable<ResolvedAddress['local']>['pin'] = providerPin ? { value: providerPin, basis: 'map', from: base?.source === 'google' ? 'Google Maps' : 'the map' } : null;
  // The local answer describes THIS spot (nearby addresses) or this neighbourhood's post office (India Post); a provider's pincode is
  // often a whole suburb's (OpenStreetMap gives every part of Civil Lines 282003). Only Google's own pincode is allowed to stand.
  if (found.pincode && (base?.source !== 'google' || !providerPin)) {
    postalCode = found.pincode.pin;
    pinInfo = { value: found.pincode.pin, basis: found.pincode.basis, from: found.pincode.from };
  }

  const city = baseParts.city ?? ctx.fallbackCity ?? null;
  const landmark = found.landmarks[0] ?? null;

  const nothingLocal = !found.street && !loc && !landmark && !found.pincode;
  if (!base && nothingLocal) return null;

  const parts = { ...baseParts, street, locality, city, postalCode };
  const formattedAddress = base && !localWins && base.formattedAddress && !loc
    ? base.formattedAddress
    : joinLine([baseParts.premise, street, locality, city, joinLine([baseParts.state, postalCode]).replace(', ', ' ')]);

  return {
    position: base?.position ?? position,
    formattedAddress: formattedAddress || base?.formattedAddress || '',
    placeId: base?.placeId ?? null,
    placeName: base?.placeName ?? null,
    parts,
    source: base?.source ?? 'osm',
    precision: base?.precision ?? null,
    local: { locality: loc ? { name: loc.name, inside: loc.inside, distanceM: loc.distanceM } : null, landmark, pin: pinInfo },
  };
}

/** One readable line about where the pin is, for the picker panel: "In Vijay Nagar Colony", "Near Kamla Nagar · 650 m". */
export function describeLocalPlace(local: NonNullable<ResolvedAddress['local']>): string | null {
  const parts: string[] = [];
  if (local.locality) {
    const { name, inside, distanceM } = local.locality;
    parts.push(inside ? `In ${name}` : `Near ${name} · ${distanceM >= 950 ? `${(Math.round(distanceM / 100) / 10).toFixed(1)} km` : `${Math.round(distanceM / 50) * 50} m`}`);
  }
  if (local.landmark) parts.push(`Near ${local.landmark.name} · ${Math.max(10, Math.round(local.landmark.distanceM / 10) * 10)} m`);
  return parts.length ? parts.join('  ·  ') : null;
}
