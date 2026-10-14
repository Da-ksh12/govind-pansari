# Delivery Lifecycle (Phase 08)

## Order status vs. delivery status — kept genuinely distinct

```
ORDER (orders.status)          DELIVERY (delivery_assignments.status)
──────────────────────         ───────────────────────────────────────
packed (= READY_FOR_PICKUP)    (no row yet — "unassigned" is the
                                 absence of an active row, not a
                                 stored value)
                                assigned ──► declined / expired
rider_assigned  ◄───────────── accepted
                                at_store
                                picked_up
out_for_delivery ◄──────────── in_transit ──► failed
delivered  ◄────────────────── completed
```

The order's own status stays coarse on purpose: `rider_assigned`
covers the *entire* span from assignment through the rider physically
having the package (accepted / at_store / picked_up all happen while
the order still reads `rider_assigned`) — only `start_delivery()`
(picked_up → in_transit) advances the order to `out_for_delivery`, and
only `complete_delivery()` advances it to `delivered`. This mirrors
Phase 07's picking/packing split exactly: fine-grained operational
detail lives on the operational table (`delivery_assignments`, like
`order_items.picking_status`), while the order's own status stays the
few customer-meaningful stages (`docs/order-fulfillment.md`).

## 'packed' is READY_FOR_PICKUP, not renamed — same reasoning as Phase 07

`packed` already meant "ready for the next stage (rider_assigned)" in
Phase 01's original enum ordering. Nothing was renamed for this phase;
`delivery_assignment_status` gained `at_store`/`declined`/`expired`/
`failed` as genuinely new values, and `in_transit`/`completed` (already
present) are what this phase calls OUT_FOR_DELIVERY/DELIVERED — again,
not renamed, just documented.

## The strict chain, one function per transition

`accept_delivery()` / `decline_delivery()` / `mark_arrived_at_store()`
/ `mark_picked_up()` / `start_delivery()` / `complete_delivery()` /
`fail_delivery()` — each re-selects its assignment `FOR UPDATE`,
re-verifies the caller is the rider *currently* assigned (not just any
rider), and requires the exact predecessor status. Exactly the same
pattern Phase 07's `advance_order_fulfillment()` established, for the
same reason: Phase 01's `update_delivery_status()` accepted *any*
target status with no validation at all — a caller could jump straight
from `assigned` to `completed`. That function is dropped entirely
(not left grantable as a bypass), replaced by these seven.

## Pickup verification (sections 20-22)

`mark_picked_up(assignment_id, order_number)` requires the rider to
supply the order's real `order_number` — the rider app's pickup screen
shows the expected number and requires the input to match before
enabling the button, and the *server* re-checks it too (never trust a
client-side match alone). QR/barcode/PIN are explicitly future-phase
(`delivery_verification_method` already models them as an enum for
that reason — see `docs/rider-assignment.md`); order-number
confirmation is what's actually enforced now.

Picking up does **not** advance `orders.status` — only
`delivery_assignments.status` becomes `picked_up`. The order only
becomes `out_for_delivery` once `start_delivery()` runs, a distinct
rider action (section 25's "Picked Up" and "Start Delivery" are two
separate buttons, not one).

## Failure (sections 28-29)

`fail_delivery(assignment_id, reason, notes)` — `reason` is a real
enum (`customer_unavailable`/`wrong_address`/`customer_refused`/
`other`), not free text, so it stays queryable/auditable. The order is
**not** touched — it stays `out_for_delivery`, not reverted, not
auto-delivered. No refund/retry/reassignment logic is invented; a
store manager/admin resolves it manually (out of this phase's scope to
automate).

## Completion (section 30) — atomic, with a real precondition list

```sql
if v_assignment.status <> 'in_transit' then raise exception ...;
if v_order.status <> 'out_for_delivery' then raise exception ...;
```

Both the delivery row and the order row flip together inside one
function call, `FOR UPDATE` locked on both — no path leaves them
disagreeing. COD settlement: a still-`pending` `payment_status` is
marked `paid` on successful delivery (unchanged rule from Phase 01's
original `update_delivery_status()`); gateway-paid orders are already
`paid` well before delivery, via `confirm_payment()` (Phase 05/06,
untouched — Phase 06 payment gateway work is explicitly not part of
this phase).

## Reassignment reverts the order — but only before pickup

`cancel_assignment()` (store manager/admin) can cancel any non-terminal
assignment. If it was still `assigned`/`accepted`/`at_store` (rider
hasn't physically taken the package yet), the order reverts to
`packed` so it re-enters the dispatch queue immediately — the same
"return to packed" behavior `decline_delivery()` and
`expire_stale_assignments()` (the scheduled timeout sweep, section 18)
both have. If the assignment was already `picked_up`/`in_transit`, the
order is left alone — the goods are physically no longer at the store,
so "ready for pickup" would be a lie. That later-stage case is
exceptional enough that this phase doesn't try to fully solve it
(no forced re-collection flow, no auto-reassignment mid-route).

## A real bug this phase's tests caught: the missing 'failed' exclusion

`'failed'` was added to `delivery_assignment_status` but initially
missed from every "is this assignment still active" check (the
partial unique index, capacity counts, `get_rider_status()`,
`get_rider_dashboard()`) — each had hand-written its own
`not in ('completed', 'cancelled', 'declined', 'expired')` list, so
adding the enum value didn't propagate anywhere. A rider with one
failed delivery was permanently stuck "at capacity" forever afterward.
Fixed by centralizing the check as `is_terminal_delivery_status()` and
rewriting every call site to use it — the fix that should have existed
from the start. See `docs/delivery-security.md` for the other real bug
this phase's live tests caught (an RLS recursion).
