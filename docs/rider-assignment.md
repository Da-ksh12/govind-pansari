# Rider Assignment (Phase 08)

## Eligibility (section 11-12) — one shared rule, three entry points

A rider qualifies for a *new* assignment only if:

```sql
r.is_active and r.is_available
and (count of non-terminal delivery_assignments for r.id) < r.max_active_deliveries
```

This exact rule is used by `assign_rider()` (manual), `auto_assign_rider()`
(the ranking algorithm below), and `get_eligible_riders_for_order()`
(the read-only list the manual-assign UI shows) — one rule, three
callers, not three copies that could drift (the exact class of bug
`is_terminal_delivery_status()` was introduced to prevent — see
`docs/delivery-lifecycle.md`).

Orders are only assignable at `packed` (READY_FOR_PICKUP) — section
11's explicit restriction. `assign_rider()` enforces this itself
(`if v_order.status <> 'packed' then raise exception`), not left to
the frontend to gate.

## Manual assignment (section 15)

```
store manager opens a READY_FOR_PICKUP order
  → get_eligible_riders_for_order(order_id)   -- ranked list
  → picks one
  → assign_rider(order_id, rider_id)          -- re-validated server-side
```

`assign_rider()` never trusts the `rider_id` the client sends — it
re-checks `is_active`/`is_available`/capacity itself regardless of
what the eligibility list said a moment earlier (section 50: "Never
accept rider_id from frontend and blindly assign it"). Manager-only
(`is_store_staff(store_id, 'store_manager')`), consistent with every
other consequential store action in Phase 07.

## Auto assignment (section 12/14) — the ranking algorithm

```sql
order by
  (primary_store_id = order.store_id) desc,  -- 1. same-store rider first
  active_count asc,                           -- 2. fewest active deliveries
  id asc                                       -- 3. deterministic tiebreak
limit 1
```

No distance, no fake ETA, no AI dispatch — section 12 explicitly
defers real routing to Phase 09, once actual rider location exists to
route from. `auto_assign_rider()` runs this ranking then calls
`assign_rider()` for the real (re-validated) assignment — one
assignment code path underneath both manual and auto, not two.

If no rider qualifies, `auto_assign_rider()` raises a clean
`no eligible rider available right now` — the order is **not**
cancelled or failed (section 13: never fail the customer order just
because no rider is free). It simply stays `packed`, unassigned, and
assignable again the moment a rider frees up or a manager assigns
manually.

## Capacity (sections 33-34)

`riders.max_active_deliveries` defaults to 1 — "one active delivery at
a time," the brief's own explicitly-sanctioned simplification for this
phase. The schema doesn't hard-code that assumption anywhere else:
every eligibility check counts real non-terminal assignments against
the ceiling, so raising a rider's capacity later is a one-column
change, not a re-architecture.

## Acceptance, decline, and expiry (sections 17-18)

- **Accept**: `assigned → accepted`, only by the assigned rider.
- **Decline**: `assigned → declined`, only while still `assigned`
  (can't decline something already accepted) — `decline_reason` is
  free text (a rider's stated reason isn't a fixed enum in the brief),
  `declined_by`/`declined_at` are recorded. The order reverts to
  `packed`, immediately reassignable.
- **Expiry**: `expire_stale_assignments()` (pg_cron, every minute —
  same `FOR UPDATE SKIP LOCKED` sweep pattern as Phase 05's
  `release_expired_reservations()`) flips a still-`assigned` row past
  `assignment_expiry_minutes()` (currently 5, one function — section
  18's "store configuration centrally, not hardcoded per screen") to
  `expired`, also reverting the order to `packed`.

## Reassignment (sections 54-55)

Not a bespoke "reassign" function — `cancel_assignment()` (existing
non-terminal assignment → `cancelled`, reverting the order to `packed`
if cancelled pre-pickup) composed with a fresh `assign_rider()`/
`auto_assign_rider()` call. The old rider automatically loses
authority: every rider-facing function re-checks the assignment's
*current* status before acting, so any action attempted on a cancelled
row fails its own status check — no separate "revoke access" step
exists because none is needed. Verified live
(`phase08-rider-delivery.test.mjs`, test 24): a rider whose assignment
was just cancelled gets rejected attempting to accept it.

## Concurrency (section 61)

Every assignment/action function locks its row(s) `FOR UPDATE` before
checking anything, and `delivery_assignments_one_active_per_order` (a
partial unique index) makes a genuine double-assignment of the same
order structurally impossible even under a true race — the losing
`INSERT` fails the constraint, not a logic check. Verified live with
real concurrent requests: two managers assigning the same order to two
different riders (exactly one wins), the same rider assigned to two
orders at once when at capacity=1 (exactly one wins), and double-taps
on accept/complete (exactly one succeeds each time) — 
`phase08-rider-delivery.test.mjs` tests 29-31 plus 21/30.
