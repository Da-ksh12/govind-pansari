# Google address search & map — setup

Changed 2026-10-28. **Nothing here is switched on yet**: the app keeps its OpenStreetMap picker until the steps below are done
and `EXPO_PUBLIC_ADDRESS_PROVIDER=google` is set in a build. No Google key exists in this project today.

## Why the map changes with the search

Google's policy (Places API and Geocoding API pages, checked 2026-10-28): *"Places API results displayed on a map must be shown
on a Google Map"*, likewise for Geocoding; place IDs may be stored indefinitely. So Google suggestions pinned onto the
OpenStreetMap/MapLibre map would not be allowed. The address picker therefore uses **one switch**
(`services/location/addressProvider.ts`): Google map + Google search/geocoding, or OpenStreetMap map + OpenStreetMap/on-device
search — never a mix. The **live tracking map stays MapLibre/OSM** (it shows no Google data).

`react-native-maps` **1.27.2** was added for the Google map: it is the version Expo SDK 57 pins (`expo/bundledNativeModules.json`),
its peers (React ≥ 18.3.1, RN ≥ 0.76) are met by React 19.2.3 / RN 0.86.3, and the SDK 57 docs list it as supported. It is only
executed when the Google switch is on. **Android only**: the generated iOS project has no Google Maps SDK configured, so iOS
stays on the OpenStreetMap path.

## 1. Google Cloud (you do this)

1. Create/choose a Google Cloud project and **enable billing** (Places/Geocoding return `REQUEST_DENIED` without it).
2. Enable these APIs: **Places API (New)**, **Geocoding API**, **Maps SDK for Android**.
3. Create **two** API keys (never one shared key):
   * **Server key** — *API restrictions*: Places API (New) + Geocoding API only. (Application restrictions cannot be IP-based
     because Supabase Edge Functions have no fixed IP; the API restriction + the Edge Function's own rate limit are the controls.)
   * **Android key** — *Application restriction*: Android apps → package `com.govindpansari.app` + the SHA-1 of **each** signing
     certificate that will ship (your upload key, and Google Play's app-signing key once uploaded to Play). *API restriction*:
     Maps SDK for Android only.
4. Set a **budget alert** and daily **quotas** on Places and Geocoding so a bug or abuse cannot run up a bill.

### Cost controls built in

* Search starts at **3 characters**, debounced **350 ms**; stale responses are dropped.
* Autocomplete and the final Place Details call share one **session token**, so a typed-then-picked search is billed as one
  session; the token is replaced after every pick or clear.
* Place Details asks only for **Essentials** fields (`id,formattedAddress,location,addressComponents`) — never `displayName` (a
  higher tier).
* Reverse geocoding runs only when the pin **settles** and has moved ≥ **15 m**, and results from superseded positions are dropped.
* Per-customer rate limit in the database: `enforce_rate_limit('places_lookup')` — burst 60, then 2/s.

## 2. Server side (deployment steps, in this order)

1. Apply the migration `supabase/migrations/20260828000001_address_structure_and_lookup_limits.sql` (adds the structured address
   columns, teaches `enforce_rate_limit` the `places_lookup` action, and carries the new fields into the order's address
   snapshot). **Apply it before deploying the function** — the function fails closed without the new rate-limit action.
2. `supabase secrets set GOOGLE_MAPS_SERVER_API_KEY=<server key>`
3. `supabase functions deploy address-lookup` (JWT verification stays **on**; the function additionally requires a signed-in
   customer).

If the secret is missing the function answers `503 NOT_CONFIGURED` and the app falls back to OpenStreetMap search / the phone's
geocoder, so a half-finished setup never breaks address entry.

## 3. App build (Android)

* Build with `GOOGLE_MAPS_ANDROID_API_KEY` set as an **environment variable or Gradle property on the build machine** (not in
  `.env`, not `EXPO_PUBLIC_`). `android/app/build.gradle` injects it into the manifest placeholder
  `com.google.android.geo.API_KEY`; with no key the placeholder is empty and the Google map would show blank.
* Set `EXPO_PUBLIC_ADDRESS_PROVIDER=google` for that build (Metro inlines it).
* `versionCode` is now 14. The native project is committed (`migration/native-ownership`), so the manifest/Gradle edits are
  authoritative; a future `expo prebuild --clean` would regenerate the project and drop them unless the
  `react-native-maps` config plugin is added to `app.json` with the key.

## What the customer gets

* **Search while typing** (Google suggestions biased to a 30 km circle around the customer's GPS fix, else the pin/area on the
  map; restricted to India), **Use my location**, **tap or drag the map** (the pin stays fixed at the centre while the map moves,
  so a finger never covers it), and **Confirm**. The Google logo stays visible: `mapPadding` lifts it above the confirm panel.
* **Add Address** form: recipient name, contact number, **house/flat no. (always typed — never filled in by a geocoder)**,
  floor, building, street, area, landmark, city, state, PIN, delivery instructions. Street/area/city/state/PIN come from the
  lookup **only into fields the customer has not typed in**; moving the pin again never overwrites their entries.
* Saved to `addresses`: coordinates, `formatted_address`, `place_id`, `geocode_source` (`google` / `osm` / `device` / `manual`),
  the structured parts and the instructions; `address_line_1/2` are composed from the parts so every existing screen keeps working;
  riders, store staff and admins see the landmark and instructions (they are part of the order's address snapshot).
* **Serviceability** is recalculated every time the pin settles (picker) and when the address is saved, with the same server
  function the location screen and checkout use (nearest eligible store, configured radius). A failed check says so; it is never
  shown as "we don't deliver here". Checkout re-validates serviceability, stock and store on the server regardless.

## Failure messages

Offline, rate-limited, "not set up / refused key / down" (→ fallback provider), no results ("move the pin"), GPS denied / blocked /
inaccurate — each has its own wording (`services/location/addressTypes.ts`, `services/serviceability.ts`) and none stops the
customer from finishing by moving the pin and typing the address.

## Not verified

* **Nothing was called against Google** (no key). Request/response handling is unit-tested against the shapes in Google's
  documentation, written by hand — `supabase/tests/address-lookup-live.test.mjs` is the check to run once a key exists.
* The Google map (react-native-maps + Maps SDK for Android), its logo placement, `mapPadding` pin alignment and tap-to-move
  were not run on a device, and the Android Gradle build with the new library was not run here.
* Nominatim (the fallback) discourages type-ahead use; it is the existing behaviour, debounced, and only used when Google is
  unavailable or switched off.
