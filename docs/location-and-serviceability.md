# Location, delivery availability and store routing

Written 2026-10-27 after the Agra field test where real pins around Vijay Nagar, Wazirpura Road and Sanjay Place all
showed "Currently unavailable for delivery".

## Root cause (reproduced against the live project)

`find_serviceable_stores()` — the function behind "can we deliver here?" — ran with the **caller's** rights. It reads the
`qa_test_mode` feature flag, and customers cannot read `feature_flags` (RLS: `settings.view` only). So for a customer the
flag always read *off* and the **09:00–21:00 opening hours** were enforced; `resolve_checkout()` (SECURITY DEFINER) saw the
flag *on* and ignored hours. The tester was testing at about 10 pm, after closing. Result:

* every address screen said "unavailable" while checkout would have accepted the same address;
* a **closed store was reported as "we don't deliver to this location yet"** (`OUTSIDE_SERVICE_AREA`), instead of "we're closed";
* run as a signed-in customer at 23:06 IST, all four screenshot coordinates returned `OUTSIDE_SERVICE_AREA`.

The coordinates themselves were fine: 76 m, 1.4 km, 1.9 km and 2.7 km from the Vijay Nagar store.

## What changed (migration `20260827000018_single_serviceability_authority.sql`)

One chain, one definition of eligibility:

```
Add Address / location / Home  → check_serviceability() ┐
Checkout summary / place order → resolve_checkout()     ┴→ find_serviceable_stores() → store_service_candidates()
```

* `store_service_candidates(lat, lng)` (internal, definer): every active store with its true geodesic distance (PostGIS
  geography), inside the radius?, accepting orders?, open now? (`qa_test_mode` ignores hours).
* **Eligibility is distance-based**: within `app_settings.max_delivery_radius_km` (**default 10 km**, editable in Admin →
  Settings → Delivery Area, one value for every store). Delivery-zone polygons no longer decide eligibility (they were ~8 km
  circles that silently capped the radius); a store's zone only supplies fee / minimum order / ETA.
* Stores are ranked **nearest first** (`store_delivery_zones.priority` no longer overrides distance).
* `check_serviceability()` says *why* when the answer is no: `OUTSIDE_SERVICE_AREA` (+ nearest store and its distance),
  `STORE_CLOSED` (+ opening hours), `STORES_NOT_ACCEPTING_ORDERS`, `NO_ACTIVE_STORES`, `INVALID_COORDINATES`.
* `resolve_checkout()` (summary and order creation): nearest eligible store **that holds the whole cart in stock**; a closer
  store without stock is skipped; if nobody has everything → `CART_NOT_FULFILLABLE` (no order splitting); the same reason
  codes as above; an address without coordinates is refused. The store is written onto the order server-side; customers
  cannot update orders (RLS), and a retry returns the same order (idempotency key), so a later address change cannot reroute it.
* The hard-coded single-store switch `qa_force_awas_vikas` is retired. **Sanjay Place**: only the *store* is inactive (the
  row stays so old orders keep their store); its delivery zone is left as it is. Zones no longer decide eligibility, so a
  customer in the Sanjay Place area is served by the nearest active store (Vijay Nagar, or Awas Vikas if Vijay Nagar can't).

## App changes

* `services/serviceability.ts` — the one wording for every answer (+ GPS failure / accuracy wording, coordinate check).
* Add Address shows the server's verdict as soon as a pin is set; saving an unavailable address is still allowed (checkout
  re-checks); a failed check is "Couldn't check delivery — try again / save anyway", never "unsupported area".
* Location screen and Checkout use the same wording; Home revalidates the selected location on open / foreground
  (`hooks/useLocationRevalidation.ts`) and shows the server's status under the address.
* GPS: `getCurrentFix()` (high accuracy + reported accuracy), the timeout is cleared, there is **no** last-known / default
  fallback; permission denied / services off / timeout / weak fix each give an actionable message ending in "drop a pin on the map".
* Map picker: it opens on an Agra view, but **Confirm is disabled until the pin is actually placed** (it used to save the
  Agra city centre silently). GPS errors are shown.
* The Home header no longer falls back to the hard-coded label "Sanjay Place, Agra" ("Choose delivery location" instead).

## Cart

* Cause of "items disappear": `cartRepository.list()` swallowed errors (and used a network `getUser()` call), so a failed read
  looked like an empty cart and the store **replaced and persisted an empty cart**; in-flight taps could be overwritten by a
  slower sync; a failed call rolled back to a snapshot of the whole cart; the Cart screen decided "empty" from an in-memory
  product cache. All fixed (`services/cartSync.ts`, `store/cartStore.ts`, `app/cart.tsx`).
* Home header has a cart icon with the real item count, in every Home state (loading and failed included).

## Store records (live)

| Store | id | latitude, longitude | Evidence |
|---|---|---|---|
| Vijay Nagar (`GP-VJN`) | `00000000-0000-0000-0000-000000000102` | 27.20341, 78.022594 | The tester's Google Maps pin "North Vijay Nagar Colony" (27.203721, 78.021908) is 76 m away. |
| Awas Vikas (`GP-AWV`) | `00000000-0000-0000-0000-000000000103` | 27.204239, 77.964982 | Avas Vikas Park, Sector 11 is at 27.201744, 77.966095 (latlong.net) — ~300 m away. No street address is stored (`Awas Vikas Colony, Agra`). |
| Sanjay Place (`GP-SNP`) | `…0101` | 27.199, 78.0064 | Not a branch: store inactive (zone untouched). |

The seed file `supabase/seed/01_catalogue_and_stores.sql` still holds **old, wrong** coordinates (the two stores' longitudes
swapped); the live values above were corrected later. **Please confirm the exact shop addresses/coordinates of both stores.**

## Tests

```
npm run test:unit                                   # 178 tests incl. serviceability.test.mjs and cart-sync.test.mjs
SUPABASE_ACCESS_TOKEN=… node supabase/tests/serviceability-routing.test.mjs   # live, rolled back; applies the migration inside its own transaction if it is not live yet
SUPABASE_ACCESS_TOKEN=… node supabase/tests/new-customer-rights.test.mjs
```

## Manual Android checklist

1. Open the app → Home shows the cart icon top-right (with a count once something is added), before and after loading.
2. Add two products, force-close the app, reopen: Home badge and Cart show the same two products; no duplicates.
3. Add Address → Pin on Map: Confirm is disabled until you move the map; move it to North Vijay Nagar Colony (27.203721, 78.021908) → "Served by our Vijay Nagar store, 76 m away".
4. Repeat for 27.200357,78.008876 · 27.197480,78.004878 · 27.197469,77.995645 → all served by Vijay Nagar (1.4 / 1.9 / 2.7 km).
5. Move the pin near Sikandra (27.2203, 77.9514) → served by Awas Vikas; a pin in Mathura/Delhi → "Outside our delivery area".
6. Turn GPS off / deny permission → Use Current Location shows an actionable message, nothing is filled in.
7. Checkout with the Vijay Nagar address → order shows Vijay Nagar as the fulfilling store.
8. Admin → Settings → Delivery Area shows 10 (km).
