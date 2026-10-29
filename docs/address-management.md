# Address Management

## Data flow

```
app/address.tsx (list)          app/address/add.tsx (create)
        │                                │
        └──────────────┬─────────────────┘
                        ▼
          services/repositories/addressRepository.ts
                        │
                addresses table (Phase 01) + set_default_address() RPC
```

`addressRepository.ts` is the only place that queries the `addresses`
table — `list`, `create`, `update`, `remove`, `setDefault`,
`getDefault`. `userRepository.listAddresses()` just delegates to it
(kept for backward compatibility with existing call sites).

## Ownership (section 14) — RLS, not frontend filtering

Every address query goes through Supabase with the caller's session;
RLS (`addresses_owner_all`, Phase 01 — unchanged this phase) restricts
every operation to `user_id = auth.uid()`. Verified live, with a
*second real authenticated user* (not just an anonymous request, which
is the weaker test): the rider account gets an empty list querying the
customer's addresses, and a `DELETE` against the customer's address
while authenticated as the rider returns `204` (PostgREST's normal
response) but the row count affected is zero — confirmed by re-reading
the address with the original owner's session afterward and finding it
still there.

## Default address (section 15) — atomic, not two client calls

`addressRepository.setDefault(id)` calls `set_default_address(p_address_id)`
(new this phase), which does the unset-old / set-new swap inside one
Postgres function — one transaction, and it checks the caller owns the
address before touching anything. The alternative (two separate
`UPDATE` requests from the client) has no way to guarantee both
happen, or that a concurrent request can't interleave between them.
Verified live: creating a second address and calling `setDefault` on
it leaves exactly one `is_default = true` row, every time.

## Validation (sections 33-34)

Client-side: `app/address/add.tsx`'s Save button is disabled until
every required field is non-empty *and* a real GPS-derived coordinate
has been captured (see below). Server-side (so the frontend check
is never the only line of defense — Phase 01 didn't have these, added
this phase): `CHECK` constraints on `addresses` for latitude
(-90..90), longitude (-180..180), and non-blank recipient
name/phone/address line 1/postal code. Postal code is stored but never
used for serviceability — `check_serviceability()` is geography-only,
per section 34.

## Update 2026-10-28 — structured addresses and the Google picker

Add Address now has separate fields (house/flat no., floor, building, street, area, landmark, city, state, PIN, delivery
instructions) and saves `formatted_address`, `place_id` and `geocode_source` with the coordinates; `address_line_1/2` are
composed from the parts. The map picker (search while typing, GPS, tap/drag, confirm, live delivery check) can run on Google
Maps Platform. Details, setup and the rules that keep a customer's typing safe from a geocoder:
`docs/google-address-setup.md`. The older text below describes the first version.

## Where coordinates come from (first version)

There's no interactive map/pin-drop yet (see
`docs/location-and-serviceability.md` — deliberately out of this
phase's scope). `app/address/add.tsx` requires the user to tap **Use
Current Location** to capture a real `LatLng` via
`locationService.getCurrentPosition()` before Save is enabled — so
every address ever saved has a real GPS-derived coordinate, not a
placeholder or a guess. Reverse geocoding (best-effort, see
`geocodingService`) pre-fills the text fields from that coordinate but
never blocks saving if it comes back empty.

## Saving an address outside the service area (section 32)

Save first calls `storeRepository.checkServiceability(position)`. If
unserviceable, the user sees "Currently unavailable for delivery" with
a choice: pick a different location, or save the address anyway
(useful for e.g. a family member's address the business might expand
to later) — the address is never silently marked delivery-ready when
it isn't; that status only ever comes from a fresh
`checkServiceability()` call, never a stored flag on the address row
itself.

## Verified live (`supabase/tests/phase03-auth-location.test.mjs`)

Create, update (a single field), and delete all work for the owning
user; a different authenticated user gets nothing when querying
another user's address (not a 403 — RLS makes the row simply not
exist for them, which is the correct "don't even reveal it's there"
behavior); `set_default_address()` leaves exactly one default after
being called on a second address.
