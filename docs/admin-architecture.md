# Admin Control Center Architecture

## Same app, not a second one

The brief's own responsive/desktop requirements (section 41/42) strongly implied a real web admin dashboard — but this project already has Expo's web output configured (`app.json`'s `"web": {"bundler": "metro", "output": "single"}`), so the admin panel is built as `app/admin/**` inside the *same* Expo Router app, not a second framework/codebase. It reuses the same Supabase client, the same auth session, the same theme tokens, and the same repositories pattern as the customer/rider/store surfaces — "no second auth system" (section 44's own instruction) is true by construction, not by discipline.

`profiles.role = 'admin'` routes here after login (`app/index.tsx`, `app/otp.tsx`), the same way `store_manager`/`staff` route to `/store` and `rider` routes to `/rider`.

## Permission model

See `docs/admin-roles-permissions.md` for the full role/permission design. In short: `is_admin()` (used by every RLS policy since Phase 01) is redefined to mean "a full/super admin" specifically, and a new `has_permission(key)` function grants scoped access to four new operational sub-roles. Every existing `is_admin()`-gated policy across 19 prior migration files is **untouched** — the redefinition is backward-compatible by construction (see the migration's own comment for the exact mechanism).

## Reused, not duplicated

Per the brief's explicit instructions, nothing here re-implements what already existed:

| Need | Reused from |
|---|---|
| Order state machine, cancellation | `update_order_status()` (Phase 05/07), extended with one additional authorization clause |
| Rider assignment/reassignment | `assign_rider()`/`auto_assign_rider()`/`cancel_assignment()` (Phase 08), same extension |
| Order timeline | `order_status_history` + `delivery_events` (Phase 01/08) — merged in `get_admin_order_detail()`, no new timeline table |
| Inventory audit trail | `inventory_movements` (Phase 01) — `adjust_inventory()` is the "future store-manager restock RPC" that table's own RLS comment already anticipated |
| Live delivery map | `app/track/[orderId].tsx` (Phase 09) — the admin dispatch screen links straight to it, no second map implementation |
| Notifications | Phase 10's `NotificationService`/`create_notification()` — `log_audit_event()` and the admin functions never call a push provider or build a parallel alert system |

## Dashboard computation

`get_admin_dashboard()` computes every number server-side in one function call (section 36/43/54) — the client never runs its own aggregate queries against `orders`/`inventory`/`riders`. See `docs/admin-orders.md` and `docs/admin-inventory.md` for what each section actually measures and the deliberate heuristics involved (e.g. "delayed delivery" has no stored per-assignment ETA to compare against, so it's a documented, generous time-window heuristic, not a precise SLA breach).

## What was deliberately not built this phase

- **Product/variant creation and image upload forms** (section 12) — the admin can list, search, and archive/activate products (a real, permission-gated, RLS-enforced capability), but a full multi-field creation wizard with Supabase Storage image management was scoped out given the size of everything else in this phase. Documented here rather than silently omitted — a clear next increment.
- **Assign/reassign-rider actions from the dispatch screen** — `app/admin/deliveries.tsx` is a monitoring board (active deliveries, age, delayed flag, link to live tracking). Assignment itself already has a complete, tested UI in the store app (`app/store/orders/[id].tsx`); duplicating that picker here was judged lower value than the rest of this phase's scope.
- **Store service-area/delivery-radius configuration UI** (section 19) — Phase 03's `delivery_zones` already models this correctly; no admin UI was added to edit zones this phase.
- **Analytics charts beyond the dashboard's numbers** (section 43) — the dashboard's stat cards answer the specific business questions section 4 asked for; a dedicated chart-heavy analytics screen was not built.

None of these are backend gaps — the permission/RLS/audit infrastructure for all of them already exists (`products.create`, `stores.manage`, `analytics.view` are real, enforced permissions today) — only their frontend screens are pending.
