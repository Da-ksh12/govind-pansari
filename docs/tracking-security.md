# Tracking Security & Privacy (Phase 09)

## Authorization: who can see what

`get_delivery_tracking(order_id)` — the single read path every
tracking UI calls — checks, server-side, on every call:

```sql
v_authorized := is_admin()
  or v_order.user_id = auth.uid()                              -- the order's own customer
  or is_store_staff(v_order.store_id)                          -- that store's staff/manager
  or (v_assignment.id is not null and is_own_rider(v_assignment.rider_id));  -- the assigned rider
```

Nobody else — not another customer, not another store's staff, not a
different rider — can call this successfully for a given order, no
matter what `order_id` they pass. There is no client-side gate doing
this work; an unguessable-looking UUID in a URL was never the security
boundary, the function is.

This is also why the store-manager "Track Live Location" link added to
`app/store/orders/[id].tsx` didn't need a new screen or a new backend
endpoint: it opens the exact same `/track/[orderId]` route the
customer uses, and `is_store_staff(v_order.store_id)` already
authorizes that store's staff to call the same function. Same
security boundary, same UI, no duplicated code path.

## The Realtime channel name is not the security boundary

`trackingRepository.subscribeToLocation(deliveryId, ...)` subscribes
to a Postgres Realtime channel named with the `deliveryId` embedded in
it. That name is for the client's own routing/dedup purposes only —
**RLS on `rider_locations` is what actually decides whether a
subscriber receives any events at all.** An unauthorized client that
somehow learns or guesses another delivery's ID and subscribes to that
channel name gets zero rows, not a permissions error and not a leak —
verified live (`phase09-live-tracking.test.mjs`, tests 12–13: RLS read
scoping between a customer with an active delivery and an unrelated
customer).

## Data minimization (section 26/56)

`get_delivery_tracking()`'s response is deliberately narrow: rider
name and vehicle type, the store's and the order's own on-file
coordinates (never recomputed from a customer's live/current profile
address, and never the rider's or anyone else's *other* deliveries),
and only the single latest non-outlier location — never the full
`rider_locations` history for that delivery, let alone any other one.

**No phone number is returned.** This was a deliberate scope decision,
not an oversight: the spec allows for an *optional* masked-calling
abstraction (section 50) so a customer/rider connection never exposes
a raw number, but building that safely requires a telephony/masking
vendor integration (e.g. Exotel-style number proxying) this project
has no credentials or infrastructure for. Rather than either (a)
expose the rider's raw phone number to satisfy "add a call button," or
(b) fake a masked-calling flow that doesn't actually mask anything,
`LiveRiderCard` simply has no call/message affordance yet. Documented
here as the concrete next step if/when a telephony vendor is chosen,
not silently dropped.

## Tracking stops immediately at DELIVERED/FAILED/CANCELLED

Two independent enforcement points, not one:
- **Write side**: `submit_rider_location()` re-derives the rider's
  active delivery from `delivery_assignments` on every call
  (`status in ('accepted','at_store','picked_up','in_transit')`).
  Once a delivery leaves that set, the very next location submission
  attempt is rejected outright — there's no eligible row for it to
  attach to.
- **Read/UI side**: the tracking screen's `isLivePhase` flag goes false
  the instant `orderStatus`/`deliveryStatus` reaches a terminal value,
  which unmounts the `Map` and tears down both Realtime subscriptions
  (`useEffect` cleanup on `subscribeToLocation`/
  `subscribeToDeliveryStatus`) in the same render — not on next screen
  visit, immediately.

## What's actually verified (not just written)

`supabase/tests/phase09-live-tracking.test.mjs` — 15 live tests against
the real deployed schema/functions/RLS, not mocks: tracking eligibility
gating (rejected before acceptance, allowed once accepted), coordinate
validation, outlier detection and its effect on `riders.current_*`,
the full `get_delivery_tracking` authorization matrix (customer /
different customer / rider / store staff / different store's manager /
anonymous), direct-INSERT blocking on `rider_locations`, RLS read
scoping, continued tracking through every trackable stage, and
post-completion cutoff (rider can no longer submit; tracking read still
works for the completed delivery's history). Re-run alongside Phases
05/07/08 with zero regressions — 102 live tests total across the four
backend phases.
