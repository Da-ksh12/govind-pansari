# Store Manager: Dashboard, SLA & Store Status

## Dashboard: one function, one round trip

`get_store_dashboard(store_id)` (Phase 07, extended this phase with `statusReason`) computes every number server-side — today's revenue/order count, the New/Processing/Picking/Packing/Ready/Cancelled breakdown, low-stock/out-of-stock counts, and the SLA averages — in a single call. `app/store/index.tsx` never runs its own aggregate query; every stat card renders exactly what the function returned, and each is tappable straight into the relevant filtered order/inventory view (section 6's quick actions).

## SLA pacing (section 33/34/35)

The "Today's Pace" card shows average minutes for four stages, computed directly from real order timestamps that already existed (`accepted_at`, `picking_started_at`, `packing_started_at`, `ready_at`, `placed_at` — all set by the state-machine functions themselves as each transition happens, never invented after the fact):

```sql
avgAcceptanceMinutes: avg(accepted_at - placed_at)
avgPickingMinutes:    avg(packing_started_at - picking_started_at)
avgPackingMinutes:    avg(ready_at - packing_started_at)
avgFulfillmentMinutes: avg(ready_at - placed_at)
```

This is today's *actual pace*, not a target-vs-actual delta — there's no stored "target preparation time" anywhere in the schema to compare against yet (section 34's "+3 min delayed" framing implies one). Adding a configurable per-store SLA target and a delta display would be a real, scoped next increment; this phase didn't add it, to avoid inventing a number the backend can't yet back up with a real target value.

Order-level urgency (individual orders, not the aggregate) *does* have a real, centralized threshold — `orderUrgency()` in `services/timeAgo.ts` (10 min = attention, 20 min = urgent) — which is what actually colors order rows in the queue.

## Store status (section 7/45/46)

`is_active` / `is_accepting_orders` / `opening_time`-`closing_time` (Phase 01/07) already model OPEN/CLOSED/TEMPORARILY_UNAVAILABLE correctly, derived (`get_store_operational_status()`) rather than stored as a fourth column that could drift. New this phase: `stores.status_reason`, set alongside `is_accepting_orders = false` and cleared automatically on resume (`set_store_accepting_orders()`, extended not replaced) — so a paused store always shows *why*, and never shows a stale reason once it's open again. Only a store manager of that specific store (or an admin) can call this — verified live, see `docs/store-manager-security.md`.

**Deliberately not built**: the store manager cannot edit opening hours, business name, or service-area/delivery-radius from this surface (section 45/46) — those already have a real, correct home (Phase 03's `delivery_zones`, the Admin Control Center's store-management screen for hours/name) and giving the store manager a second edit path to the same fields would risk exactly the drift the brief's own section 45/46 warns against.

## Store activity (section 40)

`app/store/activity.tsx`, backed by `get_store_activity()` — merges `order_events` + `delivery_events` + `inventory_movements` for one store, sorted by time. See `docs/store-manager-security.md` for why this reads those three tables directly rather than the cross-cutting `audit_logs` table.
