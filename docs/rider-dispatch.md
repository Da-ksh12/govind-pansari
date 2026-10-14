# Rider Dispatch — concurrent offer/acceptance (Final Dispatch pass)

Extends, does not replace, `docs/rider-assignment.md`'s single-assignee
model. A store manager can still hand-pick one rider directly
(`assign_rider()`), but "Send Rider" now offers the order to **every**
eligible rider at once and lets the first to accept win — closer to
how Zepto/Blinkit-style dispatch actually behaves, and the only way to
meaningfully exercise a fleet of 5 demo riders in a client demo.

## Data model

Two new tables (`20260826000091`/`092`), both RLS-protected with no
client-writable columns — every write goes through a `SECURITY
DEFINER` function:

- **`delivery_dispatch_rounds`** — one row per "Send Rider" press (and
  per reassignment — a `unique index ... where status = 'open'` means
  at most one *open* round per order at a time). `round_number`
  increments per order; a round is never revived once it leaves
  `open` — reassigning after an expiry always starts round #2, #3,
  etc., so the history stays auditable ("Round #1 EXPIRED / Round #2
  OPEN").
- **`delivery_offers`** — one row per (round, eligible rider). Exactly
  one can end `accepted` per round; every other still-`open` offer in
  that round flips to `lost` the instant a winner is decided.

## The lifecycle

```
store presses "Send Rider" on a packed (READY_FOR_PICKUP) order
  → start_dispatch_round(order_id)
      - calls get_eligible_riders_for_dispatch(order_id)   (same-store,
        active+available, no active delivery, no other open offer)
      - opens one delivery_dispatch_rounds row, expires_at = now() +
        assignment_expiry_minutes() (the same 5-minute constant
        assign_rider()'s own pending-accept window already uses)
      - inserts one delivery_offers row per eligible rider, all 'open'
      - sends each rider a real DELIVERY_OFFER push/in-app notification
        (order number, item count, amount, distance — never customer
        name/address/phone)

each offered rider, independently:
  → accept_delivery_offer(offer_id)   — see "Atomic acceptance" below
  → decline_delivery_offer(offer_id, reason?)  — round stays open,
     every other rider's offer is untouched, the declining rider's own
     availability is untouched

if nobody accepts before expires_at:
  → expire_stale_dispatch_rounds() (pg_cron, every minute — the same
     cadence expire_stale_assignments() already runs at)
      - every still-open offer in the round -> 'expired'
      - the round -> 'expired'
      - the order is left exactly where it was ('packed') — a rider
        failing to accept in time NEVER auto-cancels the customer's
        order
      - store staff get a "Rider Not Assigned" notification with a
        "Reassign Rider" action, which is just pressing "Send Rider"
        again — a genuinely new round, not a revived one
```

## Atomic acceptance — the actual hard part

Two different riders tapping Accept within the same second must never
both win. `accept_delivery_offer()` gets this from **locking the
shared parent row**, not just the row being accepted:

```sql
select * into v_offer from delivery_offers where id = p_offer_id for update;
select * into v_round from delivery_dispatch_rounds where id = v_offer.dispatch_round_id for update;
if v_round.status <> 'open' then
  return ...ALREADY_TAKEN...;
end if;
-- only reachable here if this transaction is the one holding the round lock
```

Rider A's and Rider B's concurrent transactions lock two *different*
`delivery_offers` rows (their own) — no contention there. But both
must acquire a lock on the **same** `delivery_dispatch_rounds` row
before either can decide anything. Postgres blocks the second caller
at that `for update` until the first transaction commits; the second
caller then re-reads the round's real post-commit status (`completed`,
not `open`) and returns `ALREADY_TAKEN` instead of racing on stale
data. This is what actually serializes the two accepts — locking only
the offer row would not have, since they never contend for the same
row.

Live-verified repeatedly against real concurrent requests (`Promise.all`
against two real rider sessions, and again via the QA panel's admin-side
"Simulate Concurrent Accept" — see `docs/qa-scenarios.md` §4): exactly
one winner, every time.

Before declaring a winner, `accept_delivery_offer()` also **re-checks
eligibility fresh, under lock** — never trusts anything the client
believed at offer time:

```sql
select * into v_rider from riders where id = v_offer.rider_id for update;
if not v_rider.is_active or not v_rider.is_available then ... RIDER_NOT_AVAILABLE
if exists (an active delivery_assignments row for this rider) then ... RIDER_NOT_AVAILABLE
```

A rider can go from "eligible" to "no longer eligible" in the window
between receiving an offer and tapping Accept (they accepted a
*different* offer, or a manager manually assigned them elsewhere) —
this closes that gap.

The actual win reuses `assign_rider()` (capacity check, order-status
transition to `rider_assigned`, customer/store notifications) with a
new `dispatch_offer` source tag, rather than duplicating any of that.

## Authorization — closing the self-assignment hole

`assign_rider()`'s normal callers are store staff/admin. Extending it
so a rider can accept *their own* offer required a narrowly-scoped
carve-out, not a blanket "riders can call this":

```sql
p_source = 'dispatch_offer' and is_own_rider(p_rider_id) and exists (
  select 1 from delivery_offers
  where order_id = p_order_id and rider_id = p_rider_id
    and status = 'open' and expires_at > now()
)
```

A rider calling `assign_rider(some_other_order_id, own_rider_id,
'dispatch_offer')` for an order they were never offered fails this
`exists()` check — the privilege is tied to a real, currently-open
offer row only `accept_delivery_offer()`'s own prior checks could have
produced, not to the rider's identity alone.

`accept_delivery_offer()` itself additionally allows a
`settings.manage` admin to accept on behalf of any rider (extended,
one line, not duplicated) — QA/demo tooling only, see
`docs/qa-scenarios.md`.

## Notifications

Reuses the existing event-driven pipeline (`docs/notification-architecture.md`)
end to end — no new delivery mechanism, two new `notification_event_type`
values (`delivery_offer`, `dispatch_round_expired`) and one enriched
body. `notify_on_delivery_event()`'s `delivery_assigned` branch skips
the rider-facing "New delivery" notification when the assignment's
source is `dispatch_offer` — that rider just actively tapped Accept on
their own `DELIVERY_OFFER` notification a moment ago; a second alert
immediately after would be a duplicate for the exact same event.

## QA / demo tooling

`docs/qa-scenarios.md` and the admin-only `/admin/qa-panel` screen
(`settings.manage`-gated) exercise this whole lifecycle without
needing 5+ signed-in devices — see that doc for the numbered
walkthroughs and what's been live-verified versus what still needs a
real device.
