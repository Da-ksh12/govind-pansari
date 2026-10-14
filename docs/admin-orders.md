# Admin Order Management

## Read path: `get_admin_orders()` / `get_admin_order_detail()`

Both are single RPC calls, not client-side filtering over a downloaded table (section 34/35/54). `get_admin_orders()` supports:

- **Filters**: status, store, rider, date range — all applied in the `WHERE` clause, not after fetching
- **Search**: order number, customer name, or phone, via `ilike` — a single search box covers all three (section 7's own requirement)
- **Cursor pagination**: keyed on `placed_at`, capped at 50 rows per page server-side regardless of what the client asks for

`get_admin_order_detail()` returns everything one screen needs in one round trip: the order (minus the bulky `delivery_address` blob, returned separately), customer, store, items, current delivery/rider, and a **merged timeline** —

```sql
select changed_at as at, 'status' as kind, new_status as label from order_status_history where order_id = o.id
union all
select created_at as at, 'delivery' as kind, event_type as label from delivery_events where order_id = o.id
```

reading Phase 01's automatic status-history trigger and Phase 08's delivery event log, sorted together by timestamp — section 9's explicit instruction ("do not create duplicate timeline data if order_events already exists") satisfied by construction: there is no admin-specific timeline table.

## Cancellation: the same state machine, not a parallel one

`update_order_status(order_id, 'cancelled')` (Phase 05) already handled `is_admin()` correctly — full admins could always cancel any non-terminal order, with the existing stock-release/restock accounting untouched. The one required extension: a **scoped** admin (`operations_manager`, granted `orders.cancel` without being a full admin) needs the same capability. The fix was one line —

```sql
v_is_staff := is_store_staff(v_order.store_id) or is_admin() or has_permission('orders.cancel');
```

— reproducing every other line of the function verbatim. No second cancellation path, no bypass of the "can't cancel a delivered or already-cancelled order" check, no change to the inventory accounting.

## Dashboard numbers, and their honest caveats

`get_admin_dashboard()`'s `operations.delayedDeliveries` uses:

```sql
status in ('accepted', 'at_store', 'picked_up', 'in_transit') and assigned_at < now() - interval '45 minutes'
```

There is no per-delivery expected-arrival timestamp stored anywhere in the schema (Phase 09's ETA is computed client-side, per ride, not persisted) — so this is a deliberately generous, documented **heuristic** for "this delivery has been running a long time," not a precise SLA breach calculation. Don't present it to a store owner as "14 minutes late" — it doesn't know what "on time" would have been.

`today.revenue`/`today.itemsSold`/`today.averageOrderValue` all exclude `status = 'cancelled'` orders — a cancelled order was never actually fulfilled, and revenue that later gets refunded away would misrepresent the day.

## Store staff still use their own screens

Admin order RPCs require `role = 'admin'` (via `has_permission()`) — a store manager (`role = 'store_manager'`) calling `get_admin_orders()` gets rejected outright, verified live. This is intentional: store staff already have a complete, tested order-management flow (`app/store/orders/`); the admin surface is a cross-store operational view, not a replacement for it.
