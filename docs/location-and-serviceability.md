# Location & Serviceability

## Architecture

```
locationService (expo-location)      geocodingService (interface)
  permission state machine             .reverseGeocode(lat,lng)
  getCurrentPosition()                 → default impl: expo-location's
                                          on-device geocoder, no API key
                    │                          │
                    └──────────────┬───────────┘
                                   ▼
                    storeRepository.checkServiceability(position)
                                   │
                              check_serviceability() RPC (Postgres)
                                   │
                              find_serviceable_stores() (Phase 01)
                                   │
                    delivery_zones.boundary (PostGIS) ST_Covers check
```

## Permission handling (sections 16-17)

`services/location/locationService.ts` models every state the brief
lists as one of five `LocationPermissionState` values (`not_requested`,
`granted`, `denied`, `denied_permanently`, `unavailable`) plus a
`LocationError` with a `code` (`PERMISSION_DENIED`, `GPS_DISABLED`,
`TIMEOUT`, `UNAVAILABLE`) for the runtime-failure cases. Two things
this specifically gets right, per the brief:

- **Never re-prompts after permanent denial.** `requestPermission()`
  checks `canAskAgain` first — if the OS has already permanently denied
  it, this returns `denied_permanently` without ever calling
  `requestForegroundPermissionsAsync()` again (which would otherwise
  silently no-op or, on some OS versions, do nothing useful — checking
  `canAskAgain` up front is what actually distinguishes "denied, can
  ask again" from "denied permanently").
- **No raw OS error strings reach the UI.** Every failure path in
  `location.tsx`/`address/add.tsx` shows a `LocationError.message` like
  "We couldn't get your location" or "Turn on location services to use
  your current location" — never something like `LocationManager error
  17`. `getCurrentPosition()` also races a 12s timeout against the
  native call so "GPS just hangs" degrades to a clean `TIMEOUT` state
  instead of an indefinite spinner.

## Reverse geocoding (section 19)

`services/location/geocodingService.ts` is a `GeocodingService`
interface with one method, `reverseGeocode(position)`. The only
implementation right now uses `expo-location`'s on-device geocoder
(no API key, works offline-ish, lower quality than a real
Google/Mapbox geocoding API). Swapping providers later means writing a
second object implementing the same interface and changing one export
— no call site changes. If a future provider needs an API key, that
key belongs server-side (an Edge Function) or in an
`EXPO_PUBLIC_`-scoped key restricted by the provider itself to this
app's bundle id / domain — never a general secret shipped in the app.

## Map integration (section 20)

No interactive map/pin-drop component exists yet — out of scope for
this phase (explicitly deferred: "do not build the rider map yet", and
a full picker is a bigger UI lift than an integration phase implies).
What *is* in place, so a map component can be dropped in later without
re-plumbing anything: `LatLng` coordinates flow end-to-end from
`locationService`/`geocodingService` through `storeRepository` to the
`addresses` table's `latitude`/`longitude` (+ generated PostGIS
`geog`), and every screen that needs a coordinate
(`location.tsx`, `address/add.tsx`) already gets one from
`locationService.getCurrentPosition()` rather than a hardcoded value.

## Serviceability (sections 21-25, 36)

`check_serviceability(lat, lng)` (new this phase, Postgres function) is
the single source of truth, called fresh every time — the app never
carries a `serviceable = true` forward from a previous check.
`locationStore.setLocation()` requires a `ServiceabilityResult`
argument; there's no code path that marks a location serviceable
without one having actually come back from the server.

```
storeRepository.checkServiceability(position)
  → { serviceable: true, zoneId, deliveryFee, minimumOrderValue,
      estimatedDeliveryMinutes, eligibleStores: [{storeId, storeName,
      distanceMeters}, ...] }
  → { serviceable: false, reason: 'OUTSIDE_SERVICE_AREA' }
```

Built on top of Phase 01's `find_serviceable_stores()` (geofencing via
`ST_Covers` against `delivery_zones.boundary`, ranked by explicit
`priority` then distance) rather than duplicating that logic — it just
reshapes the result into the clean, customer-safe response shape
section 23 asks for. No hardcoded lat/lng range checks anywhere; every
boundary is a real PostGIS polygon.

Store *selection* is deliberately not finalized here — `eligibleStores`
is a ranked candidate list, and section 25's "future fulfillment
engine can choose the final store" is left for the checkout phase.

## Location context (section 26)

`store/locationStore.ts` is the one place Home/Search/Product/Cart all
read location from — `selected` (label/address line/coordinates),
`serviceability` (the last `ServiceabilityResult`), and derived
`etaMinMin`/`etaMinMax` for the existing UI's "25-35 min" display
(the DB gives one `estimatedDeliveryMinutes` value; the range shown is
`[value-10, value]`, clamped to a 10-minute floor). Persisted via
AsyncStorage so a saved selection survives an app restart (section 27)
— `app/index.tsx` only routes to `/location` when nothing is saved yet.

## Verified live

`check_serviceability` returns `serviceable: true` with all 3 real
stores (ranked by distance) for a Sanjay Place coordinate, and
`serviceable: false` / `OUTSIDE_SERVICE_AREA` for a Delhi coordinate.
Four more checks (inactive zone / inactive store / store not accepting
orders / multiple eligible stores) run against throwaway rows in
`supabase/tests/phase03-zone-checks.sql`, wrapped in a transaction
that's rolled back regardless of outcome — see that file.
