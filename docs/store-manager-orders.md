# Store Manager: Order Queue & Fulfillment

## The state machine, unchanged

`accept_order()` → `advance_order_fulfillment()` (confirmed→preparing→picking→packing→packed) → `assign_rider()`/`auto_assign_rider()` (Phase 05/07/08) is the entire order lifecycle a store manager drives, exactly as before this phase. No new transition, no way to skip a stage (`NEW → DELIVERED` directly is not a code path that exists — `advance_order_fulfillment()`'s own `NEXT_STATUS` mapping only allows one forward step at a time, enforced server-side, not just by which button the UI happens to show).

## Order queue (`app/store/orders/index.tsx`)

Tabs: New (`placed`) / Processing (`confirmed`+`preparing`) / Picking / Packing / Ready (`packed`) — filtering happens server-side (`listOrders(storeId, statuses)`, an `IN` clause, not a client-side filter over every order). Sort is newest-first with an urgency color (`orderUrgency()`, centralized in `services/timeAgo.ts`): normal under 10 minutes waiting, amber at 10, red at 20 — one function, not a threshold repeated per screen (section 33's own instruction).

**Realtime** (new this phase): the queue refetches automatically on any `orders`/`delivery_assignments` change for this store, not only when the manager returns to the screen.

## Picking (order detail, `app/store/orders/[id].tsx`)

Each item is a checkbox-style row: tap to mark picked, or a small "N/A" button to mark unavailable — both go through `mark_order_item_picked()`, never a raw `order_items` write. New this phase: a progress bar and "X / Y picked — Z%" line above the item list while `status = 'picking'`, computed from the same `pendingCount` the existing "Start Packing" button already gates on (no new counting logic, just a visualization of the count that already existed).

**Item unavailable during picking** (section 13/44): marking an item unavailable doesn't touch inventory and doesn't silently drop the item — it sets `picking_status = 'unavailable'` and flips the order's `has_exception` flag (Phase 07), which blocks advancing past picking until a manager explicitly resolves it (`resolve_order_exception()`). This *is* the exception workflow section 44 asks for — `ITEM_UNAVAILABLE`/`ORDER_EXCEPTION` as concepts, not as new schema, since the existing `has_exception` boolean + picking_status enum already model exactly that state.

## Packing → Ready for Pickup

New this phase: before `advance_order_fulfillment(..., 'packed')` fires, a confirmation sheet requires three checks ("Items verified," "Quantity verified," "Packaging ready") — a pure UI gate in front of the same backend call, matching section 15/56's checklist request without adding a new order status or backend validation (the backend still independently enforces "all items resolved before packing," this checklist is an added human-in-the-loop step, not a replacement for that enforcement).

## Rider handoff (sections 26-28)

Deliberately **not changed**: the rider, not the store manager, confirms pickup (`mark_picked_up(assignment_id, order_number)`, Phase 08) — the rider must correctly supply the order number, a real anti-fraud check verifying they have the right order in hand. The brief's section 28 describes a manager-side "[PICKUP COMPLETE]" button; building a second confirmation authority alongside the rider's would either be redundant or would need to arbitrate which of two confirmations counts, both of which reduce the anti-fraud value pickup verification currently has. The store manager instead gets clear, live visibility into the handoff (`DELIVERY_STAGE_LABEL`: "Rider is heading to the store" → "Rider has arrived" → "Rider has the order" → "Out for delivery"), which is what section 26/27 actually ask for.

## Order cancellation (section 43)

`reject_order()` (from `placed`) requires a reason (`store_unable_to_fulfill`/`inventory_mismatch`/`store_closed`/`operational_issue`) and triggers inventory release + an `order_events` row + a Phase 10 notification to the customer, automatically — the existing sheet UI already required a reason before this phase touched anything. `update_order_status(..., 'cancelled')` (any later stage, up to but not including delivered) is available to a manager via the same Admin Control Center extension documented in `docs/admin-orders.md` when they hold `is_admin()`/`orders.cancel` — a plain store manager's cancellation authority stays scoped to the pre-acceptance `reject_order()` path, matching this app's existing, tested cancellation-window rules (`CUSTOMER_CANCELLABLE_STATUSES`/`update_order_status()`'s own state checks).
