# Store Manager: Inventory

## Already the correct model

`inventory.quantity` (on hand) / `reserved_quantity` (held against unconfirmed orders) / `available = quantity - reserved` (Phase 01) is exactly the physical/reserved/available split section 16 asks for — the store manager UI (`app/store/inventory.tsx`) already surfaces all three, never conflating on-hand with sellable. Nothing in this phase changed the inventory table or the reservation math.

## Adjustments go through one function

`record_inventory_adjustment(store_id, variant_id, new_quantity, reason, notes, order_id)` (Phase 07) — a manager submits the *new* on-hand count, not a delta; the function computes the difference itself, writes one `inventory_movements` row (immutable ledger) with that difference, and updates `inventory.quantity`. Six reason codes: `stock_count`, `damaged`, `expired`, `lost`, `found`, `manual_correction` — matching section 20/21's list closely. This is the same function the store manager's existing bottom-sheet UI already called before this phase; nothing new was built here.

## Stock count workflow (section 21)

The adjustment sheet already shows current On Hand / Reserved / Available before the manager enters a new physical count — submitting computes and displays the resulting difference server-side (`{success, oldQuantity, newQuantity, difference}`), never silently overwriting without the manager seeing what changed. A below-reserved-quantity guard (can't set on-hand under what's already promised to in-flight orders) is enforced by the function, surfaced inline in the sheet rather than a separate alert, so the manager can correct the number without losing their place.

## Search & filters (section 18/19)

`listInventory(storeId, search)` queries server-side by product name/SKU (an `ilike`-style match after the store-scoped fetch) — not a client-side filter over the whole catalogue. The current implementation fetches up to 200 rows per store (a real store's catalogue is small enough that this stays fast without needing cursor pagination yet); if a store's SKU count grows meaningfully past that, this is the first place to add real pagination.

## Store-specific product availability (section 24)

Already modeled correctly, not confused: `products.is_active` is a *global* catalogue flag (Admin Control Center, `docs/admin-inventory.md`) — a product can be globally active while `inventory.is_available` is false at one specific store (the existing manual override column, Phase 01, independent of the quantity math: "we have stock but it's not sellable right now"). The store manager's inventory screen only ever touches the store-scoped `inventory` row, never `products.is_active` — there is no path from the store manager surface to a global product deactivation, by construction (RLS on `products` requires `products.edit`/`is_admin()`, which a plain `store_manager` role doesn't have).
