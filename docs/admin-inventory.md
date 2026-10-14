# Admin Inventory Management

## The table already modeled this correctly

Phase 01's `inventory` table already separated `quantity` (physical) from `reserved_quantity` (held against unconfirmed orders), with `available = quantity - reserved_quantity` as the number that actually matters for "can this be sold" — section 14's "do not treat available stock as simply physical stock" requirement was already true of the schema before this phase touched anything. `get_admin_inventory()` surfaces all three numbers per row, plus a derived `stock_status`:

```sql
case when (quantity - reserved_quantity) <= 0 then 'out_of_stock'
     when (quantity - reserved_quantity) <= reorder_level then 'low_stock'
     else 'in_stock' end
```

using each product's own `reorder_level` column (default 5, but a real per-row value, never a single hardcoded threshold across every product — section 17).

## `adjust_inventory()` — the RPC the schema was already waiting for

Phase 01's `inventory_movements` table comment explicitly said: "written exclusively by SECURITY DEFINER functions (checkout, confirm_payment, release_expired_reservations, **and a future store-manager restock RPC**)." `adjust_inventory()` is that function. Every call:

1. Locks the target row (`FOR UPDATE`) — two concurrent adjustments to the same store/variant serialize correctly rather than lose an update (verified live: two simultaneous `+3`/`+4` adjustments on the same row both land, for a net `+7`, never a lost write)
2. Rejects a result that would go negative, and rejects one that would drop below the already-`reserved_quantity` (an adjustment can't quietly break an in-flight order's reservation)
3. Rejects the three movement types that are exclusively system-managed (`sale`, `reservation`, `reservation_release`) — those only ever come from checkout/payment/expiry, never a manual admin action
4. Writes exactly one `inventory_movements` row (the audit trail, section 16) and one `audit_logs` row (section 32) — never silently changes stock

```sql
select count(*) into v_active_count from delivery_assignments
  where rider_id = p_rider_id and not is_terminal_delivery_status(status);
```

is the same centralized-predicate pattern this function's neighbors (`assign_rider` etc.) use — see `docs/admin-security.md` for the real capacity-counting bug this exact pattern fixed.

## Movement types available to an admin adjustment

`purchase`, `restock`, `damage`, `return`, `transfer`, `adjustment` (the general catch-all) — matching section 15's list closely (an `expired` type from the spec's own example wasn't added since nothing in this app currently distinguishes "expired" from "damage" operationally; adding an unused enum value with no real trigger was judged not worth it — see the project's established preference for not building speculative scaffolding).

## Cross-store scope

`inventory_permission_read`/`inventory_permission_write` (new RLS policies, additive) let `inventory_manager` — whose whole job is inventory oversight — see and adjust stock at **any** store, unlike the existing `is_store_staff(store_id)`-scoped policies a regular store employee is limited to (section 20). Verified live: a scoped `inventory_manager` account successfully listed and adjusted inventory at a store they have no `store_staff` membership at all.
