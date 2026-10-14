# Govind Pansari — Backend Architecture

Supabase (Postgres + Auth + Storage + Realtime), migrations in
`supabase/migrations/`, applied in filename order. This document is the
map; `docs/order-lifecycle.md` and `docs/inventory-lifecycle.md` go deep
on those two specifically.

## Schema overview

28 tables across six domains. Grouped by migration file (each is a
coherent unit — see the file for full column lists and comments):

| Domain | Tables | Migration |
|---|---|---|
| Identity | `profiles` | `..._profiles.sql` |
| Stores & serviceability | `stores`, `store_staff`, `delivery_zones`, `store_delivery_zones` | `..._stores_and_zones.sql` |
| Catalogue | `categories`, `products`, `product_variants` | `..._catalogue.sql` |
| Inventory | `inventory`, `inventory_movements` | `..._inventory.sql` |
| Customer data | `addresses`, `carts`, `cart_items`, `wishlists`, `wishlist_items` | `..._customer_data.sql` |
| Commerce | `coupons`, `coupon_usage`, `orders`, `order_items`, `order_status_history`, `payments` | `..._commerce.sql` |
| Delivery | `riders`, `rider_locations`, `delivery_assignments` | `..._delivery.sql` |
| Content | `notifications`, `reviews`, `banners`, `offers` | `..._content.sql` |

Plus two client-facing views (`..._catalogue_views.sql`):
`product_availability` (stock_status only — never raw quantities) and
`store_product_catalogue` (is this variant orderable at this store).

## Key relationships

```
auth.users 1─1 profiles ──┬─1─* addresses
                           ├─1─1 carts ─1─* cart_items ─*─1 product_variants
                           ├─1─1 wishlists ─1─* wishlist_items ─*─1 products
                           ├─*─* store_staff ─*─1 stores
                           ├─1─1 riders ─1─* rider_locations
                           └─1─* orders

stores ─1─* inventory ─*─1 product_variants ─*─1 products ─*─1 categories
       ─*─* delivery_zones (via store_delivery_zones)
       ─1─* orders

orders ─1─* order_items
       ─1─* order_status_history
       ─1─* payments
       ─0..1─* delivery_assignments ─*─1 riders
       ─0..1 coupons (via coupon_id + coupon_usage)

inventory ─1─* inventory_movements   (immutable ledger, never the
                                       inverse — movements explain
                                       inventory's current numbers,
                                       inventory is not derived by
                                       summing movements at read time)
```

`categories` self-references via `parent_id` for the two-level
hierarchy (Dry Fruits → Almonds, etc).

## Multi-store fulfillment

A cart is scoped to exactly one `store_id` (set on first item add).
Serviceability and store selection is `find_serviceable_stores(lat,
lng)`: customer point → `delivery_zones` whose PostGIS `boundary`
covers it (and is active) → `store_delivery_zones` → candidate `stores`
(active, accepting orders) → ranked by explicit `priority` then
distance. The frontend calls this once at the Location screen and again
implicitly inside `checkout()`, which re-validates the cart's store is
still in a zone covering the chosen address before reserving anything —
a zone can be served by more than one store, and a store can serve more
than one zone, so this is a data-driven join, not a hardcoded mapping.

## RLS strategy

RLS is enabled on every table (28/28). The rule of thumb: **row-level
policies handle "which rows", column-grants handle "which fields", and
SECURITY DEFINER functions handle "which state transitions" — three
different tools for three different restrictions**, because a single
`USING`/`WITH CHECK` clause can't express all three cleanly.

- **Customer** (`auth.uid() = profiles.id`, `profiles.role = 'customer'`
  by default): full CRUD on their own `addresses`/`carts`/`cart_items`/
  `wishlists`/`wishlist_items`; read-only on their own `orders`/
  `order_items`/`order_status_history`/`payments`/`notifications`
  (`is_read` is the one mutable column); insert `reviews` only through
  `add_review()` (verified-purchase gated). Public read on the
  catalogue (`products`, `product_variants`, `categories`), `stores`,
  `delivery_zones`, `banners`, `offers`, and the `product_availability`
  view. **No access at all** to `inventory`, `inventory_movements`,
  other users' rows, `rider_locations` (unless it's their own active
  delivery), or `store_staff`.
- **Store staff** (membership row in `store_staff`, checked via the
  `is_store_staff(store_id, role?)` helper — *not* `profiles.role*`,
  since a user can staff more than one store or none): read/update
  `inventory` for their store(s); read `orders`/`order_items`/
  `delivery_assignments` scoped to their store via `is_store_staff`;
  cannot see other stores', cannot touch `payments`, cannot change
  `profiles.role`.
- **Rider**: read/update their own `riders` row (only the
  `is_available` column is directly grantable — location is written
  exclusively via `rider_locations` inserts, which a trigger mirrors
  onto `riders.current_latitude/longitude`, so there's no "teleport"
  path that skips the location ledger); insert their own
  `rider_locations`; read/advance their own `delivery_assignments` via
  `update_delivery_status()`.
- **Admin** (`profiles.role = 'admin'`, checked via `is_admin()`):
  broad read/write on everything via explicit `_admin_all`/`_admin_write`
  policies per table — not literal Postgres superuser, still policy-
  mediated and auditable.
- **`service_role`**: bypasses RLS by Postgres design. Used only by
  trusted server contexts — currently just `confirm_payment()`, whose
  `EXECUTE` grant is revoked from `anon`/`authenticated` entirely. This
  is what a payment-gateway webhook Edge Function calls after verifying
  the provider's signature; the mobile app never has a path to mark its
  own payment paid.

None of the above is enforced by checking `profiles.role` in frontend
code — every boundary above is a Postgres RLS policy, column grant, or
function-internal check, so it holds even against a client that ignores
the app's UI entirely and calls the REST/RPC endpoints directly.

## Server-side business logic

Everything that reads-then-writes across more than one row, or that a
client shouldn't be trusted to compute (price, discount, stock), is a
`SECURITY DEFINER` function in `..._business_logic.sql`:

- `checkout(address_id, coupon_code?, payment_method)` — the one
  atomic entry point from cart to order. See `docs/order-lifecycle.md`.
- `confirm_payment(order_id, status, ...)` — `service_role` only.
- `release_expired_reservations()` — scheduled (pg_cron, every 5 min).
- `update_order_status(order_id, new_status)` — cancellation (customer,
  pre-`packed`) and forward fulfillment stages (store staff).
- `assign_rider(order_id, rider_id)` / `update_delivery_status(...)` /
  `mark_order_approaching(order_id)` — dispatch and delivery-stage
  transitions, each with its own authorization check.
- `add_review(product_id, rating, comment?, images?)` — verified-
  purchase gate (must have a `delivered` order containing that product).
- `find_serviceable_stores(lat, lng)` — read-only, granted to everyone
  since the tables it joins are already public-read.

## Realtime

Two subscriptions the tracking screen needs, both straightforward
Postgres Changes subscriptions scoped by RLS (a customer's subscription
can only ever receive rows their policies already allow them to read,
so no extra server-side filtering logic is needed beyond the RLS
already in place):

- `orders` filtered to `id=eq.<order_id>` — status changes.
- `rider_locations` filtered to `rider_id=eq.<rider_id>` — position
  updates. (The rider_id for an order comes from its
  `delivery_assignments` row.)

Realtime must be enabled per-table in the Supabase dashboard (Database
→ Replication) for `orders` and `rider_locations` — that's a project
setting, not something a migration can turn on.

## Data retention

`rider_locations` is a high-write ledger (a moving rider can ping every
few seconds). `prune_old_rider_locations()` runs nightly via pg_cron
and deletes rows older than 30 days — the number to revisit if the
business wants longer route-history analytics (aggregate into a
separate rollup table first; don't just widen the window on the raw
ledger).

## Advisor findings (`supabase db advisors --linked`), post-hardening

Ran after applying all 15 migrations and seeding. 174 findings, all
accounted for:

- **2 `security_definer_view` ERRORs** (`product_availability`,
  `store_product_catalogue`) — intentional; see the comment on those
  views. A `security_invoker` view can't read `inventory` on a
  customer's behalf, which is the entire point of the view.
- **1 `rls_disabled_in_public` ERROR** (`spatial_ref_sys`) — a PostGIS-
  internal reference table, not fixable from a normal migration (owned
  by the extension/superuser role — `ALTER TABLE ... ENABLE ROW LEVEL
  SECURITY` fails with "must be owner"). Static EPSG data, nothing
  sensitive in it.
- **1 `extension_in_public` WARN** — PostGIS installed into `public`
  rather than a dedicated `extensions` schema. Left alone: moving an
  already-applied extension's schema this late carries more risk
  (every `geography`/`ST_*` reference across the schema) than the
  cosmetic benefit is worth right now.
- **20 `*_security_definer_function_executable` WARNs** — the expected
  set: `is_admin`/`is_store_staff`/`current_profile_role` (must stay
  callable by `anon`+`authenticated`, they run inside RLS policies
  evaluated for both), the six customer/staff/rider RPCs (callable by
  `authenticated` only, confirmed live — see the note below), and a
  handful of PostGIS-internal functions (`rls_auto_enable`,
  `st_estimatedextent`) that ship with the extension itself.
- **24 `auth_rls_initplan` + 126 `multiple_permissive_policies` WARNs**
  — both performance-only (they don't widen access, they just mean
  Postgres re-evaluates `auth.uid()` per row instead of once, and OR's
  together more policies than strictly necessary per table). Not
  addressed yet — real fixes are (a) wrapping every `auth.uid()` call
  in RLS policies as `(select auth.uid())`, and (b) consolidating each
  table's separate `_read`/`_admin_write`-style policies into fewer,
  combined ones. Worth doing before this sees real production load;
  not worth the risk of a rushed mechanical edit across 15 migration
  files with no local Postgres to test against first.

**A gotcha worth remembering**: `REVOKE EXECUTE ON FUNCTION x FROM
PUBLIC` alone does *not* remove `anon`/`authenticated`'s ability to
call a function on Supabase — those roles get `EXECUTE` granted
directly (a per-project default-privileges rule), not through the
`PUBLIC` pseudo-role. `20260825000014` made this mistake for the
mutating RPCs; `20260825000015` is the actual fix (`REVOKE ... FROM
anon` by name). Verified live with `has_function_privilege()` before
and after, and by calling `/rest/v1/rpc/checkout` as `anon` and
confirming it changed from reaching the function body (400, custom
error) to a `42501 permission denied` (401) — see the migration file
comments for the full story.

## Known simplifications (flagged, not hidden)

- `update_order_status()` lets store staff move an order to any of
  `confirmed`/`preparing`/`packed` without enforcing strict forward-only
  sequencing (e.g. nothing stops re-marking a `packed` order back to
  `confirmed`). Acceptable for a single-store-staff-trusted operation;
  tighten if this becomes a real operational problem.
- `update_delivery_status()` similarly doesn't enforce that
  `delivery_assignment_status` moves through `assigned → accepted →
  picked_up → in_transit → completed` strictly in order — only that the
  caller is the assigned rider (or staff/admin).
- `tax` is a real column on `orders` but always computed as `0` right
  now — GST treatment for this product category needs a business
  decision before it's wired up.
- Delivery zone boundaries in the seed data are placeholder 4km circles
  around approximate store coordinates, not real serviceable-area
  polygons — see `supabase/seed/01_catalogue_and_stores.sql`.
