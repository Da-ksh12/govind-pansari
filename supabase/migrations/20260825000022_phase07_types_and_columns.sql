-- Phase 07: Store Operations + Store Manager + Order Fulfillment.
--
-- Extends the existing schema — does not duplicate it. Role
-- architecture (user_role, store_staff_role, store_staff,
-- is_store_staff()/is_admin()) already existed from Phase 01 and needs
-- no changes. This migration only adds what's genuinely new: two
-- order_status values to fill the gap between 'preparing' and
-- 'packed', per-item picking state, operational timestamps, and two
-- new audit tables (order_events, inventory_adjustments).
--
-- Split into its own migration (rather than combined with the
-- functions that use the new enum values) because Postgres won't let
-- a newly-added enum value be used in the same transaction it was
-- added in — established pattern from Phase 01/04's anon-grant fixes.

-- =======================================================================
-- order_status: fill the picking/packing gap.
--
-- Existing chain: placed -> confirmed -> preparing -> packed -> ...
-- 'preparing' becomes the PROCESSING stage (order accepted, not yet
-- actively picked). 'packed' already meant "ready for the next stage
-- (rider_assigned)" — i.e. it already *was* READY_FOR_PICKUP in
-- Phase 01's vocabulary, so it is NOT renamed. The only real gap is
-- between "processing" and "packed": PICKING and PACKING as their own
-- trackable stages.
-- =======================================================================

alter type order_status add value if not exists 'picking' after 'preparing';
alter type order_status add value if not exists 'packing' after 'picking';

-- =======================================================================
-- New controlled vocabularies.
-- =======================================================================

create type order_rejection_reason as enum (
  'store_unable_to_fulfill',
  'inventory_mismatch',
  'store_closed',
  'operational_issue'
);

create type order_item_picking_status as enum ('pending', 'picked', 'unavailable');

create type inventory_adjustment_reason as enum (
  'stock_count',
  'damaged',
  'expired',
  'lost',
  'found',
  'manual_correction'
);

-- A real enum (not a text+check list) to match this project's existing
-- convention for controlled vocabularies (order_status, payment_status,
-- etc.) — see docs/backend-architecture.md.
create type order_event_type as enum (
  'order_accepted',
  'order_rejected',
  'processing_started',
  'picking_started',
  'item_picked',
  'item_unavailable',
  'packing_started',
  'order_packed',
  'order_ready_for_pickup',
  'exception_resolved'
);

-- =======================================================================
-- orders: operational timestamps (section 33/34 — real SLA data, not
-- fabricated later), rejection reason, and an internal-notes field
-- distinct from any customer-facing note (section 49).
-- =======================================================================

alter table orders
  add column accepted_at timestamptz,
  add column processing_started_at timestamptz,
  add column picking_started_at timestamptz,
  add column packing_started_at timestamptz,
  add column ready_at timestamptz,
  add column rejection_reason order_rejection_reason,
  add column rejection_notes text,
  add column internal_notes text,
  -- Set when a picker reports an item unavailable (section 16);
  -- cleared only by a store manager via resolve_order_exception().
  -- Blocks picking -> packing until resolved — see
  -- docs/order-fulfillment.md.
  add column has_exception boolean not null default false;

comment on column orders.has_exception is 'True while an ITEM_UNAVAILABLE report is unresolved. Blocks the picking -> packing transition until a store manager (not just staff) calls resolve_order_exception().';

-- =======================================================================
-- order_items: per-item picking state. Added as new mutable columns
-- rather than a parallel table — order_items already carries workflow
-- state precedent-free (it's the orders.status column, on the orders
-- table, that already mixes immutable snapshot fields with mutable
-- workflow state; this follows the same shape at item granularity).
-- The pricing/snapshot columns (product_name_snapshot, unit_price,
-- mrp, ...) remain untouched and immutable.
-- =======================================================================

alter table order_items
  add column picking_status order_item_picking_status not null default 'pending',
  add column picked_by uuid references profiles (id),
  add column picked_at timestamptz;

-- =======================================================================
-- order_events: a broader, append-only operational event log —
-- distinct from order_status_history (which is auto-populated by the
-- log_order_status_change trigger and is specifically status-
-- transition-shaped). order_events also captures item-level and
-- non-status events (ITEM_PICKED, ITEM_UNAVAILABLE, rejection reasons)
-- that don't correspond to an orders.status change at all, and is
-- explicitly what later phases (notifications, analytics, rider
-- dispatch) will consume — section 40/41.
-- =======================================================================

create table order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  store_id uuid not null references stores (id),
  actor_id uuid references profiles (id),
  event_type order_event_type not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index order_events_order_idx on order_events (order_id, created_at);
create index order_events_store_idx on order_events (store_id, created_at desc);

comment on table order_events is 'Append-only operational event stream — every store action that matters for audit/notifications/analytics, written exclusively by SECURITY DEFINER functions (accept_order, reject_order, advance_order_fulfillment, mark_order_item_picked, resolve_order_exception). No client insert/update/delete policy.';

alter table order_events enable row level security;

create policy "order_events_store_read"
  on order_events for select
  using (is_store_staff(store_id) or is_admin() or exists (
    select 1 from orders where orders.id = order_events.order_id and orders.user_id = auth.uid()
  ));

-- =======================================================================
-- inventory_adjustments: structured audit log for MANUAL stock
-- corrections (section 25/26) — distinct from inventory_movements
-- (the generic signed-delta ledger every inventory change already
-- writes to, including this one). inventory_movements answers "what
-- changed and by how much"; inventory_adjustments answers "who
-- corrected the count, from what to what, and why" for the specific
-- case of a staff-reported discrepancy — richer, structured context
-- inventory_movements' generic shape doesn't carry.
-- =======================================================================

create table inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references inventory (id),
  store_id uuid not null references stores (id),
  product_variant_id uuid not null references product_variants (id),
  -- Set when the discrepancy was discovered while picking a specific
  -- order — nullable, since a routine stock count isn't tied to one.
  order_id uuid references orders (id),
  old_quantity int not null check (old_quantity >= 0),
  new_quantity int not null check (new_quantity >= 0),
  difference int generated always as (new_quantity - old_quantity) stored,
  reason inventory_adjustment_reason not null,
  notes text,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create index inventory_adjustments_store_idx on inventory_adjustments (store_id, created_at desc);
create index inventory_adjustments_inventory_idx on inventory_adjustments (inventory_id, created_at desc);

comment on table inventory_adjustments is 'Structured audit trail for manual inventory corrections. Written exclusively by record_inventory_adjustment() — never a silent inventory.quantity update. See docs/store-inventory.md.';

alter table inventory_adjustments enable row level security;

create policy "inventory_adjustments_store_read"
  on inventory_adjustments for select
  using (is_store_staff(store_id) or is_admin());

-- =======================================================================
-- Tighten inventory writes: staff could previously UPDATE quantity/
-- reserved_quantity directly (inventory_staff_write, Phase 01) with no
-- audit trail at all. Column-level REVOKE forces every quantity change
-- through record_inventory_adjustment() (Phase 07 functions
-- migration), while leaving operational flags (is_available,
-- reorder_level) directly editable — those don't need an audit trail.
-- =======================================================================

revoke update (quantity, reserved_quantity) on inventory from authenticated;

comment on policy "inventory_staff_write" on inventory is 'UPDATE is column-restricted: quantity/reserved_quantity are revoked from authenticated (see the Phase 07 REVOKE below) — only is_available/reorder_level can be changed directly. Quantity corrections must go through record_inventory_adjustment().';
