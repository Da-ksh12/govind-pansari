# Store Inventory Screen + Controlled Adjustments (Phase 07)

## The reservation model is unchanged — this phase only adds a new mutation path

`docs/inventory-lifecycle.md` (Phase 01/05) already covers the core
invariant (`available = quantity - reserved_quantity`), the race-safe
atomic `UPDATE`, and the movement ledger. Phase 07 changes none of
that. What's new is a **second, structured audit trail specifically
for manual staff corrections** (`inventory_adjustments`) and, more
importantly, closing a real gap: staff could previously write
`inventory.quantity`/`reserved_quantity` directly with zero audit
trail at all.

## `inventory_adjustments` vs. `inventory_movements`

Both get written on every adjustment — they answer different
questions:

- **`inventory_movements`** (Phase 01): "what changed and by how
  much" — a generic signed-delta ledger every inventory-affecting
  event writes to (reservation, sale, return, adjustment, ...).
- **`inventory_adjustments`** (Phase 07, new): "who corrected the
  count, from what to what, and why" — `old_quantity`, `new_quantity`,
  a `difference` generated column, a structured `reason` enum
  (`stock_count`, `damaged`, `expired`, `lost`, `found`,
  `manual_correction`), free-text `notes`, `created_by`, optionally
  linked to the `order_id` that surfaced the discrepancy (a picker
  reporting "system says 5, shelf has 2" mid-pick).

This isn't duplicate architecture — `inventory_movements`'s shape
(one signed number, a polymorphic reference) genuinely can't carry
"reason + who + old/new" without becoming something else. Section
25/26 explicitly asks for this richer, structured record.

## The real gap this phase found and fixed: column-level grants

`inventory` already had an `inventory_staff_write` RLS policy (Phase
01) using `is_store_staff(store_id)` to scope which *rows* a staff
member could update — but RLS only restricts rows, not columns, and
Supabase's default schema privileges grant `authenticated` (and
`anon`) table-level `UPDATE` on every column of every public-schema
table at project creation. A column-specific `REVOKE UPDATE
(quantity, reserved_quantity) ON inventory FROM authenticated` (the
first attempt, in `20260825000022`) had **no effect**, because a
column-level `REVOKE` cannot retract privilege a broader table-level
`GRANT` already covers — confirmed live via
`information_schema.column_privileges` still showing `authenticated`
with `UPDATE` on `quantity` after that migration.

**Fix** (`20260825000024_phase07_tighten_inventory_grants.sql`):

```sql
revoke update on inventory from authenticated, anon;   -- retract the broad grant first
grant update (is_available, reorder_level) on inventory to authenticated;  -- then re-grant only the safe columns
```

`quantity`/`reserved_quantity` now have no `UPDATE` grant at all for
`authenticated` — only `record_inventory_adjustment()` (`SECURITY
DEFINER`, runs as the table owner, unaffected by the caller's own
grants) can change them. `is_available`/`reorder_level` — operational
flags with no audit requirement — remain directly editable by store
staff via RLS, no function needed. Verified live
(`phase07-store-operations.test.mjs`, test 21): a real store manager,
who correctly passes the RLS row check, gets `42501 permission denied`
attempting a direct `PATCH` of `quantity`, but the same `PATCH` of
`is_available` succeeds.

## `record_inventory_adjustment()`: the one path that changes stock counts by hand

```
record_inventory_adjustment(store_id, variant_id, new_quantity, reason, notes?, order_id?)
```

1. `is_store_staff(store_id)` or `is_admin()` — same store-scoping as
   everything else.
2. Rejects a negative quantity outright.
3. **Rejects a new quantity below what's already `reserved_quantity`**
   for other orders — section 53's "never allow available < 0" applies
   here too: lowering on-hand stock below what other customers'
   pending orders already have reserved would silently oversell them.
   The function raises instead, telling the caller how many units are
   reserved so the real conflict (probably: those other orders need
   resolving first) is visible rather than hidden.
4. Writes `inventory_adjustments` (the full old/new/reason audit) and
   `inventory_movements` (`movement_type = 'adjustment'`) in the same
   transaction, then updates `inventory.quantity`.

## The inventory screen (`app/store/inventory.tsx`)

Search by product name or SKU (section 24), a status badge per row
(`IN STOCK`/`LOW STOCK`/`OUT OF STOCK` — driven by the existing
`reorder_level` column, never a hardcoded threshold per section 27),
and a bottom sheet for recording an adjustment (current on-hand/
reserved/available, a new-quantity input, a reason picker). The
"below reserved" rejection surfaces inline (the sheet stays open) —
correcting the entered quantity is the expected next action, not a
generic error dialog.

## Multi-store inventory (section 29/30)

Nothing in this phase changes `products.is_active` when one store's
stock hits zero — a variant reads `out of stock` at Store A while
still `in stock` at Store B, exactly as the schema already modeled
(`inventory` is per `(store_id, product_variant_id)`, never global —
Phase 01). Customer-facing availability continues to come from the
Phase 05 fulfillment engine (which store, if any, can cover a given
address's cart), never a naive `product.active` flag.
