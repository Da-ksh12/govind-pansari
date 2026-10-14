# Routing and ETA (Phase 09)

## Provider choice: free/no-key now, swappable later

The map/routing provider question was put to the user directly rather
than guessed, because it's a real external dependency this project
can't resolve on its own (most road-routing providers need a paid API
key). The answer was explicit: **free/no-key default now, upgrade
later** — build the real abstraction, ship a genuinely working
zero-cost default, and make the future swap a config change, not a
rewrite.

`services/routing/routingService.ts` defines the seam:

```ts
export interface RoutingService {
  getRoute(origin: LatLng, destination: LatLng): Promise<RouteResult | null>;
}
```

The default implementation calls OSRM's public demo server
(`router.project-osrm.org`) — real road-network routing (not
straight-line distance), no API key. That server has **no SLA and
isn't meant for production-scale traffic**; it's the right choice for
this project's current stage, not for a high-volume production
deployment. Swapping to Google Directions or Mapbox later means
implementing this same interface against the new provider and changing
one export — every call site (`useLiveRoute`, the tracking screen)
stays untouched. A provider that needs a *protected* key (unlike
OSRM's keyless public endpoint) would additionally need a server-side
proxy at that point, same pattern as any other secret-bearing external
call in this codebase — not needed today.

`getRoute()` returns `null` on any failure (bad response, network
error, OSRM returning a non-`Ok` code) — it never falls back to
straight-line distance or invents a plausible-looking route. A `null`
result is what drives the tracking screen's "Route temporarily
unavailable" banner.

## Throttling (`hooks/useLiveRoute.ts`)

The routing API is never called on every GPS ping — that would be both
wasteful against a free public server and pointless (a rider's route
doesn't meaningfully change every 4 seconds). `useLiveRoute` only
recalculates when:
- more than 30s have elapsed since the last calculation, **or**
- the rider has moved more than 100m since the position that last
  calculation used

whichever comes first. In-flight requests are tagged with an
incrementing `requestId` so a request superseded by a newer one (rider
moved again before the first response came back) is discarded rather
than overwriting fresher state with stale data.

## ETA formatting — never false precision

`formatEta()` never renders a single deceptively-precise number like
"14 min". Below a 5-minute threshold it shows "Arriving soon"; above
that, a range (`round(minutes*0.85)`–`round(minutes*1.2)` min) —
because a routing engine's duration estimate is itself an estimate,
and presenting it as exact would misrepresent the confidence the data
actually has.

## What the tracking screen routes between

The destination fed into `useLiveRoute` depends on the delivery's
current stage, not just "rider → customer" unconditionally:

| Delivery status | Route origin → destination |
|---|---|
| `assigned` / `accepted` | rider → store (heading to pick up) |
| `at_store` | none (rider is at the store; no route to draw) |
| `picked_up` / `in_transit` | rider → customer's delivery address |

This mirrors how a rider's actual leg changes over the delivery
lifecycle instead of always drawing a rider→customer line that would
be misleading before pickup even happens.
