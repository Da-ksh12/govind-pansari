# Delivery Events (Phase 08)

## Two logs, on purpose — not duplicate architecture

- **`order_events`** (Phase 07, extended this phase): the broad,
  cross-functional log. Store actions and delivery milestones both
  write to it. A future customer-facing "your order was picked up"
  screen would read from here without needing to know
  `delivery_assignments` exists.
- **`delivery_events`** (new this phase): rider/delivery-scoped,
  carries a `rider_id` `order_events` has no reason to have, and
  captures finer-grained operational detail (`rider_at_store`,
  `delivery_started`) that isn't customer-facing.

Section 38 and section 39 list these as two distinct event
vocabularies for exactly this reason — building them as one merged
table would have forced either a nullable `rider_id` on every
`order_events` row (most of which have nothing to do with a rider) or
losing the delivery-specific granularity.

## `delivery_events` (new table)

```sql
delivery_events (
  id, delivery_id, order_id, rider_id, store_id,
  event_type delivery_event_type, metadata jsonb, created_at
)
```

`event_type`: `delivery_assigned`, `delivery_accepted`,
`delivery_declined`, `delivery_expired`, `rider_at_store`,
`delivery_picked_up`, `delivery_started`, `delivery_failed`,
`delivery_completed`, `delivery_cancelled` — a real Postgres enum,
matching this project's established convention for controlled
vocabularies rather than free text.

Append-only, written exclusively by the Phase 08 `SECURITY DEFINER`
functions — no client insert/update/delete policy, same as
`order_events`, `order_status_history`, and `inventory_movements`.

## `order_events` — the vocabulary this phase added

`rider_assigned`, `rider_accepted`, `rider_declined`, `order_picked_up`,
`order_out_for_delivery`, `order_delivered`, `delivery_failed` — added
via `ALTER TYPE order_event_type ADD VALUE` to the *existing* Phase 07
enum, not a second event-type column or a parallel table.

## RLS

Both tables: store staff of the relevant store, admins, the assigned
rider (`is_own_rider()`), and — deliberately — the order's own
customer can read. No customer-facing screen surfaces `delivery_events`
yet (section 65: "do not redesign the customer app"), but the RLS is
already correct for whenever one does, the same forward-looking choice
Phase 07 made for `order_events`.

## What consumes this later (not built yet)

Push/WhatsApp/SMS notifications on `delivery_assigned` (section 41 —
explicitly prepared as an event hook, not implemented), real-time
subscriptions so a rider sees a new assignment without refreshing
(section 40 — Supabase Realtime is available on these tables; no
subscription is wired up yet), rider performance analytics beyond what
`get_rider_dashboard()` already aggregates from real timestamps
(section 36-37), and the live map/route/ETA layer Phase 09 will build
on top of `riders.current_latitude/longitude` and `rider_locations`
(both already populated by Phase 01's location-ping trigger, unused by
any screen until Phase 09).
