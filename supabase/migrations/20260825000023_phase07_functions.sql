-- Phase 07 functions: order acceptance/rejection, the strict picking/
-- packing state machine, per-item picking, controlled inventory
-- adjustments, store operational status, and the dashboard aggregate.
-- All SECURITY DEFINER, all doing their own is_store_staff()/is_admin()
-- check — same pattern as every business-logic function since Phase 01.

create index if not exists orders_store_status_idx on orders (store_id, status, placed_at desc);

-- =======================================================================
-- find_serviceable_stores() (Phase 01) never checked operating hours —
-- only is_active/is_accepting_orders. Section 37/38 explicitly require
-- the customer fulfillment engine to stop selecting a store outside
-- its hours, so this closes that gap in the existing function rather
-- than adding a second, parallel serviceability check.
-- =======================================================================

create or replace function find_serviceable_stores(customer_lat double precision, customer_lng double precision)
returns table (
  store_id uuid,
  store_name text,
  delivery_zone_id uuid,
  delivery_fee numeric,
  minimum_order_value numeric,
  estimated_delivery_minutes int,
  distance_meters double precision
)
language sql
stable
as $$
  select
    s.id,
    s.name,
    dz.id,
    dz.delivery_fee,
    dz.minimum_order_value,
    dz.estimated_delivery_minutes,
    ST_Distance(s.geog, ST_SetSRID(ST_MakePoint(customer_lng, customer_lat), 4326)::geography)
  from delivery_zones dz
  join store_delivery_zones sdz on sdz.delivery_zone_id = dz.id
  join stores s on s.id = sdz.store_id
  where dz.is_active
    and s.is_active
    and s.is_accepting_orders
    and (now() at time zone 'Asia/Kolkata')::time between s.opening_time and s.closing_time
    and ST_Covers(dz.boundary, ST_SetSRID(ST_MakePoint(customer_lng, customer_lat), 4326)::geography)
  order by sdz.priority asc, 7 asc;
$$;

comment on function find_serviceable_stores is 'Customer location -> zone -> eligible stores, ranked by explicit priority then distance. Does not consider inventory — the caller (checkout, or a "which store has this in stock" browse query) filters further. As of Phase 07, also excludes stores outside their opening_time/closing_time (IST) — a store closed for the night is not a fulfillment candidate even if otherwise active and accepting orders.';

-- =======================================================================
-- accept_order / reject_order — the NEW ORDER QUEUE's two actions
-- (section 8). Both only apply to 'placed' orders; both are their own
-- functions rather than folded into advance_order_fulfillment because
-- they have distinct semantics (reject requires a mandatory reason)
-- and distinct UI surfaces (the New Orders queue, not the generic
-- "advance to next stage" action).
-- =======================================================================

create or replace function accept_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin()) then
    raise exception 'not authorized to accept this order';
  end if;
  if v_order.status <> 'placed' then
    raise exception 'order is not awaiting acceptance (current status: %)', v_order.status;
  end if;

  update orders set status = 'confirmed', accepted_at = now() where id = p_order_id;
  insert into order_events (order_id, store_id, actor_id, event_type)
    values (p_order_id, v_order.store_id, auth.uid(), 'order_accepted');
end;
$$;

comment on function accept_order is 'New order queue: ACCEPT. placed -> confirmed only; the immutable predecessor check plus the row lock is what makes two staff members accepting the same order simultaneously safe (the loser''s UPDATE runs after the winner''s status is no longer ''placed'').';

revoke all on function accept_order from public, anon;
grant execute on function accept_order to authenticated;

create or replace function reject_order(p_order_id uuid, p_reason order_rejection_reason, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin()) then
    raise exception 'not authorized to reject this order';
  end if;
  if v_order.status <> 'placed' then
    raise exception 'order is not awaiting acceptance (current status: %)', v_order.status;
  end if;

  update orders set rejection_reason = p_reason, rejection_notes = p_notes where id = p_order_id;
  insert into order_events (order_id, store_id, actor_id, event_type, metadata)
    values (p_order_id, v_order.store_id, auth.uid(), 'order_rejected', jsonb_build_object('reason', p_reason, 'notes', p_notes));

  -- Reuses update_order_status's existing, already-tested release-vs-
  -- return + status='cancelled' logic rather than duplicating it — the
  -- caller is already known to be staff, so its own staff check passes.
  perform update_order_status(p_order_id, 'cancelled');
end;
$$;

comment on function reject_order is 'New order queue: REJECT. Requires a reason (section 8 — no arbitrary rejection). Sets rejection_reason/notes, logs an order_rejected event, then delegates the actual cancel+inventory-release to update_order_status() (Phase 01/05) rather than re-implementing it.';

revoke all on function reject_order from public, anon;
grant execute on function reject_order to authenticated;

-- =======================================================================
-- advance_order_fulfillment — the strict, single-step-forward chain:
-- confirmed -> preparing -> picking -> packing -> packed. Replaces
-- Phase 01's update_order_status() forward-branch, which only checked
-- the *target* was one of confirmed/preparing/packed and never
-- validated the *current* status — meaning it never actually enforced
-- "no skipping ahead" (section 10). update_order_status() is
-- narrowed to cancellation-only below.
-- =======================================================================

create or replace function advance_order_fulfillment(p_order_id uuid, p_new_status order_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_pending_items int;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id) or is_admin()) then
    raise exception 'not authorized to change this order''s status';
  end if;

  if v_order.status = 'confirmed' and p_new_status = 'preparing' then
    update orders set status = 'preparing', processing_started_at = now() where id = p_order_id;
    insert into order_events (order_id, store_id, actor_id, event_type)
      values (p_order_id, v_order.store_id, auth.uid(), 'processing_started');

  elsif v_order.status = 'preparing' and p_new_status = 'picking' then
    update orders set status = 'picking', picking_started_at = now() where id = p_order_id;
    insert into order_events (order_id, store_id, actor_id, event_type)
      values (p_order_id, v_order.store_id, auth.uid(), 'picking_started');

  elsif v_order.status = 'picking' and p_new_status = 'packing' then
    select count(*) into v_pending_items from order_items where order_id = p_order_id and picking_status = 'pending';
    if v_pending_items > 0 then
      raise exception 'all items must be picked or marked unavailable first (% still pending)', v_pending_items;
    end if;
    if v_order.has_exception then
      raise exception 'this order has an unresolved item exception — a store manager must resolve it first';
    end if;
    update orders set status = 'packing', packing_started_at = now() where id = p_order_id;
    insert into order_events (order_id, store_id, actor_id, event_type)
      values (p_order_id, v_order.store_id, auth.uid(), 'packing_started');

  elsif v_order.status = 'packing' and p_new_status = 'packed' then
    -- 'packed' is the terminal status for this phase — it already
    -- meant "ready for the rider" in Phase 01's vocabulary, so it is
    -- READY_FOR_PICKUP, not renamed. Both events are logged since the
    -- brief names them distinctly even though this phase treats the
    -- underlying status change as one atomic step.
    update orders set status = 'packed', ready_at = now() where id = p_order_id;
    insert into order_events (order_id, store_id, actor_id, event_type)
      values (p_order_id, v_order.store_id, auth.uid(), 'order_packed');
    insert into order_events (order_id, store_id, actor_id, event_type)
      values (p_order_id, v_order.store_id, auth.uid(), 'order_ready_for_pickup');

  else
    raise exception 'invalid status transition from % to % (order_already_processed_or_invalid)', v_order.status, p_new_status;
  end if;
end;
$$;

comment on function advance_order_fulfillment is 'The picking/packing state machine (section 9/10). Each branch requires the *exact* predecessor status — no skipping, no going backward, and never reachable for delivered/cancelled/rider-stage statuses (those stay on update_order_status()/assign_rider()/update_delivery_status()). The row lock (SELECT ... FOR UPDATE) is what makes two staff racing the same transition safe: the loser''s branch condition no longer matches after the winner commits, so it falls through to the invalid-transition error instead of double-applying.';

revoke all on function advance_order_fulfillment from public, anon;
grant execute on function advance_order_fulfillment to authenticated;

-- Narrow update_order_status() to cancellation only — the loosely-
-- validated confirmed/preparing/packed forward branch is fully
-- replaced by advance_order_fulfillment() above. Nothing in the app
-- calls it with a non-cancel target (the store frontend didn't exist
-- before this phase); the customer-cancel and staff-cancel paths are
-- untouched.
create or replace function update_order_status(p_order_id uuid, p_new_status order_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_item record;
  v_is_owner boolean;
  v_is_staff boolean;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;

  v_is_owner := v_order.user_id = auth.uid();
  v_is_staff := is_store_staff(v_order.store_id) or is_admin();

  if p_new_status <> 'cancelled' then
    raise exception 'use accept_order()/reject_order()/advance_order_fulfillment() for non-cancellation transitions';
  end if;

  if not (v_is_owner or v_is_staff) then
    raise exception 'not authorized to cancel this order';
  end if;
  if v_is_owner and not v_is_staff and v_order.status not in ('placed', 'confirmed', 'preparing') then
    raise exception 'this order can no longer be cancelled';
  end if;
  if v_order.status in ('delivered', 'cancelled') then
    raise exception 'order is already %', v_order.status;
  end if;

  for v_item in select * from order_items where order_id = p_order_id loop
    if v_order.payment_status = 'paid' then
      update inventory set quantity = quantity + v_item.quantity
        where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;
      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
      values (v_order.store_id, v_item.product_variant_id, v_item.quantity, 'return', 'order', p_order_id, auth.uid());
    else
      update inventory set reserved_quantity = reserved_quantity - v_item.quantity
        where store_id = v_order.store_id and product_variant_id = v_item.product_variant_id;
      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
      values (v_order.store_id, v_item.product_variant_id, v_item.quantity, 'reservation_release', 'order', p_order_id, auth.uid());
    end if;
  end loop;

  update orders set status = 'cancelled' where id = p_order_id;
end;
$$;

comment on function update_order_status is 'Cancellation only (Phase 07 narrowed this from its Phase 01 shape, which also loosely handled confirmed/preparing/packed forward-moves without validating the current status — see advance_order_fulfillment()). Owner can cancel from placed/confirmed/preparing; staff/admin can cancel any non-terminal order. Reservation-release-vs-return logic unchanged from Phase 01.';

-- =======================================================================
-- mark_order_item_picked — per-item picking state (section 12/13/14).
-- =======================================================================

create or replace function mark_order_item_picked(p_order_item_id uuid, p_status order_item_picking_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item order_items%rowtype;
  v_order orders%rowtype;
begin
  if p_status = 'pending' then
    raise exception 'cannot set picking status back to pending';
  end if;

  select * into v_item from order_items where id = p_order_item_id for update;
  if v_item is null then
    raise exception 'order item not found';
  end if;
  select * into v_order from orders where id = v_item.order_id for update;
  if not (is_store_staff(v_order.store_id) or is_admin()) then
    raise exception 'not authorized to update this order';
  end if;
  if v_order.status <> 'picking' then
    raise exception 'items can only be picked while the order is in the picking stage (current status: %)', v_order.status;
  end if;

  update order_items set picking_status = p_status, picked_by = auth.uid(), picked_at = now() where id = p_order_item_id;

  if p_status = 'unavailable' then
    update orders set has_exception = true where id = v_order.id;
    insert into order_events (order_id, store_id, actor_id, event_type, metadata)
      values (v_order.id, v_order.store_id, auth.uid(), 'item_unavailable',
        jsonb_build_object('orderItemId', p_order_item_id, 'productName', v_item.product_name_snapshot));
  else
    insert into order_events (order_id, store_id, actor_id, event_type, metadata)
      values (v_order.id, v_order.store_id, auth.uid(), 'item_picked',
        jsonb_build_object('orderItemId', p_order_item_id, 'productName', v_item.product_name_snapshot));
  end if;
end;
$$;

comment on function mark_order_item_picked is 'Picking only happens while the order is in the picking stage — this is what "cannot pick a nonexistent item" (section 57 test 12) actually means in practice: the item must belong to a real order_item row on an order currently being picked by this staff member''s store. Marking UNAVAILABLE flags orders.has_exception (section 16), which advance_order_fulfillment() checks before allowing picking -> packing.';

revoke all on function mark_order_item_picked from public, anon;
grant execute on function mark_order_item_picked to authenticated;

-- =======================================================================
-- resolve_order_exception — manager-only checkpoint (section 16).
-- =======================================================================

create or replace function resolve_order_exception(p_order_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
begin
  select * into v_order from orders where id = p_order_id for update;
  if v_order is null then
    raise exception 'order not found';
  end if;
  if not (is_store_staff(v_order.store_id, 'store_manager') or is_admin()) then
    raise exception 'only a store manager can resolve an order exception';
  end if;
  if not v_order.has_exception then
    raise exception 'this order has no unresolved exception';
  end if;

  update orders set has_exception = false where id = p_order_id;
  insert into order_events (order_id, store_id, actor_id, event_type, metadata)
    values (p_order_id, v_order.store_id, auth.uid(), 'exception_resolved', jsonb_build_object('notes', p_notes));
end;
$$;

comment on function resolve_order_exception is 'Manager-only (store_staff_role = store_manager, not plain staff) — a deliberate escalation checkpoint: regular staff can report an item unavailable, but only a manager can clear the exception and let the order proceed to packing. Substitutions/partial fulfillment/customer approval are explicitly future-phase scope; this phase only unblocks the pipeline.';

revoke all on function resolve_order_exception from public, anon;
grant execute on function resolve_order_exception to authenticated;

-- =======================================================================
-- record_inventory_adjustment — controlled stock correction
-- (section 25/26). Never a silent inventory.quantity write.
-- =======================================================================

create or replace function record_inventory_adjustment(
  p_store_id uuid,
  p_variant_id uuid,
  p_new_quantity int,
  p_reason inventory_adjustment_reason,
  p_notes text default null,
  p_order_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv inventory%rowtype;
begin
  if not (is_store_staff(p_store_id) or is_admin()) then
    raise exception 'not authorized to adjust inventory for this store';
  end if;
  if p_new_quantity < 0 then
    raise exception 'quantity cannot be negative';
  end if;

  select * into v_inv from inventory where store_id = p_store_id and product_variant_id = p_variant_id for update;
  if v_inv is null then
    raise exception 'no inventory row for this store/variant';
  end if;
  -- Section 53: never let available/on-hand drop below what's already
  -- reserved for other orders — that would silently oversell them.
  if p_new_quantity < v_inv.reserved_quantity then
    raise exception 'new quantity (%) is below the % units already reserved for other orders — resolve those orders before lowering stock this far', p_new_quantity, v_inv.reserved_quantity;
  end if;

  insert into inventory_adjustments (inventory_id, store_id, product_variant_id, order_id, old_quantity, new_quantity, reason, notes, created_by)
  values (v_inv.id, p_store_id, p_variant_id, p_order_id, v_inv.quantity, p_new_quantity, p_reason, p_notes, auth.uid());

  update inventory set quantity = p_new_quantity where id = v_inv.id;

  insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
  values (p_store_id, p_variant_id, p_new_quantity - v_inv.quantity, 'adjustment',
    case when p_order_id is not null then 'order' else 'manual_adjustment' end, p_order_id, auth.uid());

  return jsonb_build_object(
    'success', true, 'oldQuantity', v_inv.quantity, 'newQuantity', p_new_quantity,
    'difference', p_new_quantity - v_inv.quantity
  );
end;
$$;

comment on function record_inventory_adjustment is 'The only path that changes inventory.quantity by staff hand — writes both inventory_adjustments (structured old/new/reason audit) and inventory_movements (the generic ledger every other inventory change also writes to) so the two stay consistent. Rejects an adjustment that would drop quantity below what''s already reserved for other orders, rather than silently letting available go negative.';

revoke all on function record_inventory_adjustment from public, anon;
grant execute on function record_inventory_adjustment to authenticated;

-- =======================================================================
-- set_store_accepting_orders — manager-only operational toggle
-- (section 6). Deliberately only flips is_accepting_orders, never
-- is_active (a more permanent/administrative flag) or any other store
-- configuration column — section 6/36's "must not alter unrelated
-- store configuration".
-- =======================================================================

create or replace function set_store_accepting_orders(p_store_id uuid, p_accepting boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (is_store_staff(p_store_id, 'store_manager') or is_admin()) then
    raise exception 'only a store manager can change this store''s operational status';
  end if;
  update stores set is_accepting_orders = p_accepting where id = p_store_id;
end;
$$;

comment on function set_store_accepting_orders is 'OPEN/TEMPORARILY_UNAVAILABLE toggle (section 6/37/38). Store operational status is derived, not stored, from is_active AND is_accepting_orders AND current time within opening_time/closing_time — see get_store_operational_status(). This function only ever flips is_accepting_orders.';

revoke all on function set_store_accepting_orders from public, anon;
grant execute on function set_store_accepting_orders to authenticated;

create or replace function get_store_operational_status(p_store_id uuid)
returns text
language sql
stable
as $$
  select case
    when not s.is_active then 'closed'
    when not s.is_accepting_orders then 'temporarily_unavailable'
    -- Stores operate in India (Agra) regardless of the DB server's own
    -- timezone (Supabase defaults to UTC) — opening_time/closing_time
    -- are IST wall-clock values, so the comparison must be too.
    when (now() at time zone 'Asia/Kolkata')::time not between s.opening_time and s.closing_time then 'closed'
    else 'open'
  end
  from stores s where s.id = p_store_id;
$$;

comment on function get_store_operational_status is 'Derived, not stored (section 37) — combines is_active, is_accepting_orders, and opening_time/closing_time rather than adding a fourth status column that could drift out of sync with the two booleans find_serviceable_stores()/resolve_checkout() already gate on.';

grant execute on function get_store_operational_status to anon, authenticated;

-- =======================================================================
-- get_store_dashboard — the one aggregate function for the dashboard
-- (section 5/33/34/54): today's stats computed server-side rather than
-- the frontend fetching all historical orders and reducing client-side.
-- =======================================================================

create or replace function get_store_dashboard(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_today_start timestamptz := date_trunc('day', now());
begin
  if not (is_store_staff(p_store_id) or is_admin()) then
    raise exception 'not authorized to view this store''s dashboard';
  end if;

  return jsonb_build_object(
    'storeId', p_store_id,
    'operationalStatus', get_store_operational_status(p_store_id),
    'isActive', (select is_active from stores where id = p_store_id),
    'isAcceptingOrders', (select is_accepting_orders from stores where id = p_store_id),

    'todayRevenue', coalesce((select sum(total) from orders where store_id = p_store_id and placed_at >= v_today_start and status <> 'cancelled'), 0),
    'todayOrderCount', (select count(*) from orders where store_id = p_store_id and placed_at >= v_today_start),

    'newOrders', (select count(*) from orders where store_id = p_store_id and status = 'placed'),
    'processing', (select count(*) from orders where store_id = p_store_id and status in ('confirmed', 'preparing')),
    'picking', (select count(*) from orders where store_id = p_store_id and status = 'picking'),
    'packing', (select count(*) from orders where store_id = p_store_id and status = 'packing'),
    'readyForPickup', (select count(*) from orders where store_id = p_store_id and status = 'packed'),

    'lowStockCount', (
      select count(*) from inventory
      where store_id = p_store_id and is_available
        and (quantity - reserved_quantity) > 0
        and (quantity - reserved_quantity) <= reorder_level
    ),
    'outOfStockCount', (
      select count(*) from inventory
      where store_id = p_store_id and (quantity - reserved_quantity) <= 0
    ),

    'avgAcceptanceMinutes', (
      select round(avg(extract(epoch from (accepted_at - placed_at)) / 60)::numeric, 1)
      from orders where store_id = p_store_id and accepted_at is not null and placed_at >= v_today_start
    ),
    'avgPickingMinutes', (
      select round(avg(extract(epoch from (packing_started_at - picking_started_at)) / 60)::numeric, 1)
      from orders where store_id = p_store_id and picking_started_at is not null and packing_started_at is not null and placed_at >= v_today_start
    ),
    'avgPackingMinutes', (
      select round(avg(extract(epoch from (ready_at - packing_started_at)) / 60)::numeric, 1)
      from orders where store_id = p_store_id and packing_started_at is not null and ready_at is not null and placed_at >= v_today_start
    ),
    'avgFulfillmentMinutes', (
      select round(avg(extract(epoch from (ready_at - placed_at)) / 60)::numeric, 1)
      from orders where store_id = p_store_id and ready_at is not null and placed_at >= v_today_start
    ),
    'cancelledOrRejectedToday', (
      select count(*) from orders where store_id = p_store_id and status = 'cancelled' and placed_at >= v_today_start
    )
  );
end;
$$;

comment on function get_store_dashboard is 'Real aggregates only (section 34 — "do not create fake analytics"). Averages are null (not 0 or fabricated) when no orders today have reached the relevant milestone yet — the frontend renders that as "no data yet", never a misleading zero.';

revoke all on function get_store_dashboard from public, anon;
grant execute on function get_store_dashboard to authenticated;

-- =======================================================================
-- store_staff: let a store manager see their colleagues at the same
-- store (section 35) — previously self-read only. Write access stays
-- admin-only (store_staff_admin_write, unchanged) — a manager still
-- cannot add/remove staff themselves (section 35's explicit caution).
-- =======================================================================

create policy "store_staff_manager_reads_colleagues"
  on store_staff for select
  using (is_store_staff(store_id, 'store_manager') or is_admin());
