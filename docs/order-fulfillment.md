# Order Fulfillment — Store Side (Phase 07)

This is the store-operations half of the order lifecycle documented in
`docs/order-lifecycle.md` (customer/checkout side, Phase 05). Together
they cover the full pipeline:

```
CUSTOMER APP
  │  create_order_from_cart()                              [Phase 05]
  ▼
placed  ──accept_order()──►  confirmed                      [Phase 07]
                                │  advance_order_fulfillment()
                                ▼
                              preparing
                                │
                                ▼
                              picking  ◄── mark_order_item_picked() per line
                                │
                                ▼
                              packing
                                │
                                ▼
                              packed  (= READY_FOR_PICKUP)
                                │
                                ▼
                    [rider assignment — Phase 08+, out of scope here]
```

`placed → cancelled` (via `reject_order()`) is the other path out of
the queue — see "Rejection" below.

## Why 'packed' is READY_FOR_PICKUP, not a new status

The brief's state machine names a final `READY_FOR_PICKUP` status.
Phase 01's `order_status` enum already had `packed` immediately before
`rider_assigned` — i.e. `packed` already *meant* "ready for the rider"
in the original schema, it just didn't have picking/packing as
separate trackable stages leading up to it. Phase 07 fills that gap
(`picking`, `packing` — two new enum values, `ALTER TYPE ... ADD
VALUE`) without renaming or duplicating `packed` itself. This is a
direct application of section 9's instruction: "Existing Phase 05
statuses may differ. DO NOT blindly rename existing statuses... Extend
the existing state machine safely."

## The strict state machine (`advance_order_fulfillment()`)

Each transition requires the order's *current* status to be the exact
predecessor — no skipping ahead, no going backward:

| From | To | Stamps | Event logged |
|---|---|---|---|
| `confirmed` | `preparing` | `processing_started_at` | `processing_started` |
| `preparing` | `picking` | `picking_started_at` | `picking_started` |
| `picking` | `packing` | `packing_started_at` | `packing_started` (only if every item is resolved and no open exception — see below) |
| `packing` | `packed` | `ready_at` | `order_packed` + `order_ready_for_pickup` |

Any other `(from, to)` pair — including a backward move, or jumping
straight from `preparing` to `packed` — falls through to `raise
exception 'invalid status transition...'`. This is what actually
enforces section 10's "do not allow READY_FOR_PICKUP → CONFIRMED" and
"do not allow skipping ahead": **Phase 01's original `update_order_status()`
never validated the current status for its forward branch at all** —
it only checked the target was one of `confirmed`/`preparing`/`packed`,
meaning a bug let staff jump straight from `placed` to `packed` if they
called it with the right argument. That gap is closed by this function,
not by patching the old one — `update_order_status()` is narrowed to
cancellation-only (see below) rather than left as a second, competing
way to do the same forward transition.

**Store staff can never reach `delivered`** — `advance_order_fulfillment()`
has no branch that produces it, and `update_order_status()` (see
below) rejects any non-`cancelled` target outright. That belongs to
the rider/delivery system (`update_delivery_status()`, Phase 01,
untouched — Phase 08+ scope).

## Acceptance and rejection (`accept_order()` / `reject_order()`)

Both apply only to `placed` orders — a separate pair of functions from
`advance_order_fulfillment()` because they have different semantics:

- **`accept_order(order_id)`**: `placed → confirmed`, stamps
  `accepted_at`, logs `order_accepted`.
- **`reject_order(order_id, reason, notes)`**: reason is a required
  parameter (`order_rejection_reason` enum: `store_unable_to_fulfill`,
  `inventory_mismatch`, `store_closed`, `operational_issue`) — there is
  no code path to reject without one (section 8: "Do NOT allow
  arbitrary rejection without audit information"). Sets
  `orders.rejection_reason`/`rejection_notes`, logs an `order_rejected`
  event with the reason in its metadata, then **delegates the actual
  cancel + inventory release to `update_order_status(order_id,
  'cancelled')`** rather than re-implementing that logic — the
  release-vs-return branching (based on `payment_status`) is exactly
  what a customer-initiated cancellation already needed in Phase 05.

## `update_order_status()`: narrowed to cancellation only

Phase 07 changed this function's body (not its signature) — the old
confirmed/preparing/packed forward branch is gone; everything except
`p_new_status = 'cancelled'` now raises immediately, pointing the
caller at `accept_order()`/`reject_order()`/`advance_order_fulfillment()`.
Nothing in the shipped app called it with a non-cancel target before
this phase (no store frontend existed yet), so this is a safe
consolidation, not a breaking change — verified by re-running the full
Phase 05 test suite after this change (still 24/24 passing).

## Per-item picking (`mark_order_item_picked()`)

`order_items` gained `picking_status` (`pending`/`picked`/`unavailable`,
default `pending`), `picked_by`, `picked_at` — new *mutable* columns,
added alongside the existing immutable pricing-snapshot columns on the
same table (the same shape `orders` itself already uses: immutable
snapshot fields + a mutable `status` column). Only callable while the
order is actually in the `picking` stage — picking a nonexistent item,
or picking an item on an order that isn't being picked right now, both
fail (section 57 test matrix items 11-12).

Marking an item `unavailable` sets `orders.has_exception = true` and
logs `item_unavailable`. This is what blocks `picking → packing`:

```sql
if v_pending_items > 0 then raise exception '... still pending';
if v_order.has_exception then raise exception '...manager must resolve it first';
```

**Only a store manager can clear it** (`resolve_order_exception()`,
`is_store_staff(store_id, 'store_manager')` — plain staff calling it
is rejected). This is a deliberate escalation checkpoint from section
16: a picker can flag a problem, but only a manager decides the order
is ready to proceed despite it. Substitutions, customer approval, and
partial fulfillment are explicitly future-phase scope — this phase
only unblocks the pipeline, it doesn't attempt to solve the missing
item.

## Concurrency

Every one of these functions opens with `SELECT ... FOR UPDATE` on the
order (and, for item-picking, the item too) before checking anything.
Two staff racing the same transition serialize on that row lock; the
loser re-evaluates its `WHERE`/`IF` conditions against the *already-
advanced* row and falls into the "invalid transition" branch instead
of double-applying. Verified live with real concurrent requests
(`phase07-store-operations.test.mjs`, tests 31-32): exactly one of two
simultaneous `accept_order()` calls succeeds; exactly one of two
simultaneous `advance_order_fulfillment()` calls succeeds; the order
never double-advances.

## Store status and the customer fulfillment engine

`find_serviceable_stores()` (Phase 01 — the function `resolve_checkout()`
uses to pick a fulfilling store) never checked operating hours before
this phase, only `is_active`/`is_accepting_orders`. Section 37/38
explicitly require a closed store to stop being selected, so this
phase adds `(now() at time zone 'Asia/Kolkata')::time between
opening_time and closing_time` to that same function — not a second,
parallel serviceability check. `get_store_operational_status()`
derives `open`/`closed`/`temporarily_unavailable` from the same three
signals for display, rather than a fourth status column that could
drift out of sync with them. `set_store_accepting_orders()` (manager-
only) is the one write path — it only ever flips `is_accepting_orders`,
never `is_active` or anything else (section 6/36's "must not alter
unrelated store configuration"). Verified live
(`phase07-store-operations.test.mjs`, test 23): pausing a store removes
it from `find_serviceable_stores()`'s results immediately; an order
already placed before the pause is untouched (test 24).
