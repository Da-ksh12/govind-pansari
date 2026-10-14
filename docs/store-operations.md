# Store Operations (Phase 07) — Overview

## Scope

Turns an incoming customer order into a store-fulfilled,
delivery-ready order:

```
placed → accepted → confirmed → preparing → picking → packing → packed (READY_FOR_PICKUP)
```

Ends at `READY_FOR_PICKUP`. Rider assignment, GPS, live delivery
tracking, notifications infrastructure, and payment gateway
integration are all explicitly out of scope (section 59) — Phase 06
(payments) was skipped per this phase's instructions and remains
untouched; Razorpay/gateway work is still pending, separately.

See the companion docs for the detail behind each piece:

- **`docs/store-roles-and-permissions.md`** — the role/staff
  architecture (already existed from Phase 01), what's manager-only
  vs. staff-accessible, and the demo accounts used to test it
- **`docs/order-fulfillment.md`** — the strict picking/packing state
  machine, acceptance/rejection, per-item picking, exceptions, and
  store operational status
- **`docs/store-inventory.md`** — controlled inventory adjustments,
  the audit trail, and a real security gap this phase found and fixed
  (column-level grants)
- **`docs/order-events.md`** — the new operational event log and how
  it differs from `order_status_history`

## What was reused vs. genuinely new

**Reused, unchanged**: the `orders`/`order_items`/`inventory`/`stores`/
`store_staff` tables, `is_store_staff()`/`is_admin()`, the inventory
reservation model and its atomic race-safe `UPDATE`, the
`order_status_history` audit trigger, RLS's general shape
(`is_store_staff(store_id)` as the row-scoping predicate).

**Genuinely new**: two `order_status` enum values (`picking`,
`packing`) filling a real gap between `preparing` and the
already-existing `packed`; `accept_order()`/`reject_order()`/
`advance_order_fulfillment()`/`mark_order_item_picked()`/
`resolve_order_exception()`/`record_inventory_adjustment()`/
`set_store_accepting_orders()`/`get_store_operational_status()`/
`get_store_dashboard()`; the `order_events` and `inventory_adjustments`
tables; operational timestamps and `has_exception`/`rejection_reason`/
`internal_notes` on `orders`; `picking_status`/`picked_by`/`picked_at`
on `order_items`; `delivery_zones` gained nothing this phase (Phase 05
already added `free_delivery_threshold`).

**Fixed, not extended**: `update_order_status()` was narrowed to
cancellation-only (its old forward-transition branch never actually
validated the current status — a real skip-ahead bug closed by
`advance_order_fulfillment()` instead); `find_serviceable_stores()`
gained an operating-hours check it never had; `inventory`'s
column-level grants were tightened after a direct test proved the
first attempt at that didn't work (see `docs/store-inventory.md`).

## Frontend: a genuinely separate navigation surface

Per section 45, store operations is not a tab bolted onto the
customer app — `app/store/` is its own `Tabs` layout
(`components/nav/StoreTabBar.tsx`, no shared route names or components
with the customer `BottomTabBar`/`FloatingCartBar`), reached via a
role check rather than a store-specific login flow:

```
app/store/
  _layout.tsx       Tabs: Dashboard / Orders / Inventory / Store
  index.tsx         Dashboard — get_store_dashboard(), real aggregates
  orders/
    _layout.tsx     Stack (queue -> detail)
    index.tsx       Status-filtered order queue (New/Processing/Picking/Packing/Ready)
    [id].tsx         Order detail: accept/reject, picking checklist, packing action
  inventory.tsx     Search + low-stock badges + adjustment sheet
  profile.tsx       Store info, team list, logout
```

**Routing**: `app/index.tsx` (the splash/entry redirect) and
`app/otp.tsx` (post-login) both check `profile.role` — `store_manager`/
`staff` go to `/store` and skip the location-selection step entirely
(a store user has no delivery location concept); everyone else follows
the existing customer flow, unchanged. `store/authStore.ts`'s
sign-in listener now fetches the profile *before* deciding what else
to load, so it can load `useStoreOpsStore` (the active store
assignment) for store users instead of cart/wishlist/order-history —
previously cart/wishlist loaded unconditionally for every sign-in.

**Data access**: reads (order queue, order detail, inventory list, store
profile, staff list) go straight through PostgREST with RLS doing the
scoping — the same pattern the customer app already uses for its own
order history (Phase 05). Only state-changing actions
(accept/reject/advance/pick/adjust/toggle-status) go through the
`SECURITY DEFINER` functions above. `get_store_dashboard()` is the one
exception on the read side — a genuine server-side aggregate (today's
revenue, per-stage order counts, low/out-of-stock counts, SLA
averages) rather than the frontend fetching every order and reducing
client-side (section 54).

## Testing

`supabase/tests/phase07-store-operations.test.mjs` — 32 live tests,
covering every category in section 57's matrix: store access
boundaries (manager-to-manager cross-store denial, staff vs. manager,
customer/anonymous denial), the full accept → confirmed → preparing →
picking → packing → packed happy path plus skip-ahead and backward-
transition rejection, per-item picking including the nonexistent-item
and unavailable/exception-blocking cases, inventory adjustments
(audit correctness, the reserved-quantity floor, cross-store denial,
the column-grant fix), store operational status actually removing a
store from customer-facing serviceability, the dashboard's real
aggregates, direct RLS checks (not just function-level authorization),
and two genuine concurrency races (simultaneous accept, simultaneous
advance) each resolving to exactly one winner. Also re-ran the full
Phase 05 suite (24 tests) after narrowing `update_order_status()` and
adding the operating-hours check — no regressions.

One real bug the test suite caught mid-phase (not a test-authoring
mistake this time): the column-level `REVOKE` on `inventory.quantity`
silently did nothing due to a pre-existing table-level grant — see
`docs/store-inventory.md` for the full diagnosis and fix
(`20260825000024_phase07_tighten_inventory_grants.sql`).
