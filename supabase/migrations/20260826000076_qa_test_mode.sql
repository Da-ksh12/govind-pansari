-- Temporary QA/demo testing mode. Root cause of the "not available near
-- you" reports: find_serviceable_stores() (Phase 07) correctly enforces
-- store opening_time/closing_time — real, intended business logic, not
-- a bug — which blocks every store outside its hours (e.g. testing at
-- 1am IST against a 9am-9pm store). QA_TEST_MODE lets that check be
-- bypassed deliberately and reversibly, without touching the
-- opening_time/closing_time columns or the enforcement logic itself.
--
-- Uses the existing feature_flags mechanism (20260826000043) rather
-- than a new config table — same admin Settings screen, same
-- set_feature_flag() RPC, same audit trail, same settings.manage
-- permission gate already enforced there.

insert into feature_flags (key, enabled, description) values
  ('qa_test_mode', false, 'QA/demo testing: ignores store opening/closing hours in store selection. Defaults OFF — must be explicitly enabled via set_feature_flag(''qa_test_mode'', true) by an admin with settings.manage. Never enable in production.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- find_serviceable_stores: identical to the Phase 07 version except the
-- opening_time/closing_time check is now short-circuited when
-- qa_test_mode is on. is_active and is_accepting_orders are left fully
-- enforced either way — those are real on/off switches a store manager
-- controls, not an hours restriction, and QA mode has no business
-- overriding them (section 12: "QA mode is an operational convenience,
-- not a security bypass").
-- ---------------------------------------------------------------------
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
    and (
      coalesce((select enabled from feature_flags where key = 'qa_test_mode'), false)
      or (now() at time zone 'Asia/Kolkata')::time between s.opening_time and s.closing_time
    )
    and ST_Covers(dz.boundary, ST_SetSRID(ST_MakePoint(customer_lng, customer_lat), 4326)::geography)
  order by sdz.priority asc, 7 asc;
$$;

comment on function find_serviceable_stores is 'Customer location -> zone -> eligible stores, ranked by explicit priority then distance. Does not consider inventory — the caller (checkout, or a "which store has this in stock" browse query) filters further. Excludes stores outside their opening_time/closing_time (IST) UNLESS the qa_test_mode feature flag is on (see 20260826000076).';

-- ---------------------------------------------------------------------
-- get_store_operational_status: same bypass, so the store-ops app's own
-- "open/closed" display stays consistent with what checkout actually
-- allows — a store shouldn't show "closed" in its own dashboard while
-- QA mode is quietly still accepting orders for it.
-- ---------------------------------------------------------------------
create or replace function get_store_operational_status(p_store_id uuid)
returns text
language sql
stable
as $$
  select case
    when not s.is_active then 'closed'
    when not s.is_accepting_orders then 'temporarily_unavailable'
    when coalesce((select enabled from feature_flags where key = 'qa_test_mode'), false) then 'open'
    when (now() at time zone 'Asia/Kolkata')::time not between s.opening_time and s.closing_time then 'closed'
    else 'open'
  end
  from stores s where s.id = p_store_id;
$$;

comment on function get_store_operational_status is 'Derived, not stored — combines is_active, is_accepting_orders, and opening_time/closing_time (or qa_test_mode bypass — see 20260826000076) rather than a fourth status column that could drift out of sync with what find_serviceable_stores()/resolve_checkout() actually gate on.';

-- ---------------------------------------------------------------------
-- qa_reset_inventory: one-shot, admin-only, audited restock of every
-- real (non-test-fixture) active product variant to a high quantity at
-- every real active store — including creating the inventory row where
-- one never existed. Deliberately does NOT touch reserved_quantity
-- (real open orders keep their real reservation; a still-huge quantity
-- means plenty stays available regardless) and never resets quantity
-- below whatever is currently reserved, so it can never corrupt a live
-- order's accounting. Independent of qa_test_mode — an admin may want
-- to restock without touching the hours bypass, or vice versa.
-- ---------------------------------------------------------------------
create or replace function qa_reset_inventory(p_quantity int default 1000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_created int := 0;
  v_updated int := 0;
begin
  if not has_permission('settings.manage') then
    raise exception 'not authorized';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'quantity cannot be negative';
  end if;

  for v_row in
    select pv.id as variant_id, s.id as store_id
    from product_variants pv
    join products p on p.id = pv.product_id
    cross join stores s
    where pv.is_active and p.is_active and s.is_active
      and p.name not like 'Test%'
  loop
    if exists (select 1 from inventory where store_id = v_row.store_id and product_variant_id = v_row.variant_id) then
      update inventory
        set quantity = greatest(p_quantity, reserved_quantity),
            is_available = true
        where store_id = v_row.store_id and product_variant_id = v_row.variant_id;
      v_updated := v_updated + 1;
    else
      insert into inventory (store_id, product_variant_id, quantity, reorder_level, is_available)
        values (v_row.store_id, v_row.variant_id, p_quantity, 5, true);
      insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, created_by)
        values (v_row.store_id, v_row.variant_id, p_quantity, 'purchase', 'manual_adjustment', auth.uid());
      v_created := v_created + 1;
    end if;
  end loop;

  perform log_audit_event('qa_inventory_reset', 'inventory', null, jsonb_build_object('quantity', p_quantity, 'created', v_created, 'updated', v_updated));
  return jsonb_build_object('success', true, 'created', v_created, 'updated', v_updated);
end;
$$;

comment on function qa_reset_inventory is 'QA/demo only — restocks every real active product variant to p_quantity (default 1000) at every real active store, creating the row if missing. settings.manage-gated, audited. Never lowers quantity below what is currently reserved for a real order.';

revoke all on function qa_reset_inventory from public, anon;
grant execute on function qa_reset_inventory to authenticated;
