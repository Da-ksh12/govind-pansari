# Live Tracking Architecture (Phase 09)

## Why this phase exists

Phases 05–08 got an order from cart to a rider's hands. Nothing before
this phase let a customer (or a store manager) see *where* that rider
actually is. This phase adds that, end to end, with a hard constraint
carried through every decision below: **nothing is simulated**. There
is no fake GPS movement, no hardcoded coordinates, no invented ETA. If
a real signal isn't available, the UI says so instead of making one up
(see "What the UI does when data is missing" below).

## Data flow

```
Rider's phone                     Supabase                          Customer / store phone
──────────────                    ────────                          ───────────────────────
expo-location                     submit_rider_location()           get_delivery_tracking()
  watchPositionAsync    ───RPC──►   - derives rider from auth.uid()    - one-shot: latest state
  (Balanced, 4s/15m)                - derives active delivery         - Realtime: live updates
                                       server-side (never trusts
                                       a client rider_id/delivery_id)
                                     - validates lat/lng/accuracy
                                     - flags (not rejects) outliers
                                     - writes rider_locations
                                                │
                                                ▼
                                    rider_locations (Realtime-enabled)
                                    delivery_assignments (Realtime-enabled)
                                                │
                                                ▼
                                    postgres_changes subscription,
                                    RLS-scoped per row (see
                                    docs/tracking-security.md)
```

Two read paths, not one: `get_delivery_tracking(order_id)` is called
once on screen mount for the current snapshot (rider name, vehicle,
store/destination coordinates, latest known-good location, delivery
status), and `rider_locations`/`delivery_assignments` Realtime
subscriptions carry updates after that. Realtime is not the only
source of truth — see "Reconnect handling" below.

## Screen state model (`app/track/[orderId].tsx`)

The spec's 10+ named states (LOADING, NO_TRACKING_YET, RIDER_ASSIGNED,
STALE_LOCATION, GPS_UNAVAILABLE, ROUTE_UNAVAILABLE, DELIVERED, FAILED,
…) aren't mutually exclusive — a delivery can be simultaneously
"in_transit" and "stale" and "route unavailable" at once. The screen
is built as **one primary phase** plus **independent banners**, which
covers the same ground without a combinatorial state enum:

- **loading** — first fetch in flight, full skeleton, no map mounted.
- **error** — the fetch itself failed (network/auth); retry CTA.
- **static** (covers NO_TRACKING_YET, DELIVERED, FAILED, CANCELLED) —
  no `deliveryId` yet, or the order/delivery has reached a terminal
  state. No map, no Realtime subscriptions (see privacy note below) —
  just the order timeline and a status message.
- **live** (covers RIDER_ASSIGNED, RIDER_AT_STORE, OUT_FOR_DELIVERY,
  LIVE_TRACKING) — full-screen map + bottom sheet. Within this phase,
  three independent overlay banners handle the "something's off but
  tracking should keep working" states:
  - no location yet at all (rider hasn't sent a ping since accepting)
  - stale location (last ping older than 90s — section 44's 60–120s
    window)
  - route unavailable (OSRM call failed — markers and last-known
    position still render, just no polyline/ETA)

## What the UI does when data is missing

| Missing thing | Behaviour |
|---|---|
| No rider location yet | "Waiting for the rider's GPS signal…" banner; store/destination markers still shown |
| Location is stale (>90s old) | "Updating rider location…" banner; last known position stays on the map, dimmed rider marker, doesn't advance |
| Route/ETA call failed | "Route temporarily unavailable" banner; no route line, no ETA text — never a stale or invented number |
| Delivery is in a terminal state | Map and Realtime subscriptions aren't even mounted — see `docs/tracking-security.md` |

## Reconnect handling (section 46)

Realtime sockets suspend when the app backgrounds. Rather than trust
"the next event after reconnect will catch me up," the screen
explicitly re-fetches `get_delivery_tracking()`:
- on `AppState` transitioning to `active`
- every 25s while the live phase is active, as a safety net independent
  of any particular reconnect signal
- immediately whenever a `delivery_assignments` status event arrives,
  since a status change is exactly the moment other fields
  (`deliveredAt`, `outForDeliveryAt`) are also likely to have changed

## Related docs

- `docs/rider-location.md` — the ingestion side (rider's phone → `submit_rider_location`)
- `docs/routing-and-eta.md` — the `RoutingService`/`useLiveRoute` abstraction
- `docs/map-architecture.md` — MapLibre, the OSM tile default, marker/interpolation approach
- `docs/tracking-security.md` — RLS/authorization, privacy stop conditions
