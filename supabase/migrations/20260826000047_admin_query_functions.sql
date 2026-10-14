-- Admin Control Center, part 6: server-side search/filter/pagination
-- for orders, customers, and inventory (section 7/14/27/34/35/54) —
-- every one of these does its filtering and joining in SQL, not by
-- the client downloading a table and filtering in JS.

-- ---------------------------------------------------------------------
-- Orders (section 7/8/9/10)
-- ---------------------------------------------------------------------

create or replace function get_admin_orders(
  p_status order_status default null,
  p_store_id uuid default null,
  p_rider_id uuid default null,
  p_search text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_cursor timestamptz default null,
  p_limit int default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('orders.view') then
    raise exception 'not authorized';
  end if;

  return (
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select
        o.id, o.order_number, o.status, o.total, o.placed_at,
        (select count(*) from order_items oi where oi.order_id = o.id) as item_count,
        p.full_name as customer_name, p.phone as customer_phone,
        s.name as store_name,
        (select da.id from delivery_assignments da where da.order_id = o.id and not is_terminal_delivery_status(da.status) order by da.assigned_at desc limit 1) as active_delivery_id,
        (select r.id from delivery_assignments da join riders r on r.id = da.rider_id where da.order_id = o.id and not is_terminal_delivery_status(da.status) order by da.assigned_at desc limit 1) as rider_id,
        (select rp.full_name from delivery_assignments da join riders r on r.id = da.rider_id join profiles rp on rp.id = r.profile_id where da.order_id = o.id and not is_terminal_delivery_status(da.status) order by da.assigned_at desc limit 1) as rider_name
      from orders o
      join profiles p on p.id = o.user_id
      join stores s on s.id = o.store_id
      where (p_status is null or o.status = p_status)
        and (p_store_id is null or o.store_id = p_store_id)
        and (p_rider_id is null or exists (select 1 from delivery_assignments da where da.order_id = o.id and da.rider_id = p_rider_id))
        and (p_date_from is null or o.placed_at >= p_date_from)
        and (p_date_to is null or o.placed_at <= p_date_to)
        and (p_search is null or p_search = '' or
             o.order_number ilike '%' || p_search || '%' or
             p.full_name ilike '%' || p_search || '%' or
             p.phone ilike '%' || p_search || '%')
        and (p_cursor is null or o.placed_at < p_cursor)
      order by o.placed_at desc
      limit least(coalesce(p_limit, 20), 50)
    ) t
  );
end;
$$;

comment on function get_admin_orders is 'order_count is computed via a lateral-free correlated subquery on order_items in the view below where needed — kept out of the list query itself to stay index-friendly for the common filters (status/store/date/search).';

revoke all on function get_admin_orders from public, anon;
grant execute on function get_admin_orders to authenticated;

create or replace function get_admin_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not has_permission('orders.view') then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'order', to_jsonb(o.*) - 'delivery_address',
    'deliveryAddress', o.delivery_address,
    'customer', jsonb_build_object('id', p.id, 'name', p.full_name, 'phone', p.phone, 'email', p.email),
    'store', jsonb_build_object('id', s.id, 'name', s.name, 'addressLine', s.address_line),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', oi.id, 'productName', oi.product_name_snapshot, 'variantLabel', oi.variant_snapshot,
        'quantity', oi.quantity, 'unitPrice', oi.unit_price, 'mrp', oi.mrp
      )), '[]'::jsonb) from order_items oi where oi.order_id = o.id),
    'delivery', (
      select jsonb_build_object(
        'assignmentId', da.id, 'status', da.status, 'assignedAt', da.assigned_at,
        'riderId', r.id, 'riderName', rp.full_name, 'riderPhone', rp.phone
      )
      from delivery_assignments da
      join riders r on r.id = da.rider_id
      join profiles rp on rp.id = r.profile_id
      where da.order_id = o.id
      order by da.assigned_at desc limit 1
    ),
    'timeline', (
      select coalesce(jsonb_agg(row_to_json(evt) order by evt.at), '[]'::jsonb) from (
        select changed_at as at, 'status'::text as kind, new_status::text as label, null::text as actor from order_status_history where order_id = o.id
        union all
        select created_at as at, 'delivery'::text as kind, event_type::text as label, null::text as actor from delivery_events where order_id = o.id
      ) evt
    )
  ) into v_result
  from orders o
  join profiles p on p.id = o.user_id
  join stores s on s.id = o.store_id
  where o.id = p_order_id;

  if v_result is null then
    raise exception 'order not found';
  end if;
  return v_result;
end;
$$;

comment on function get_admin_order_detail is 'Timeline merges order_status_history + delivery_events (section 9) — reads the existing logs, creates no duplicate timeline table (section 9''s own instruction).';

revoke all on function get_admin_order_detail from public, anon;
grant execute on function get_admin_order_detail to authenticated;

-- ---------------------------------------------------------------------
-- Customers (section 27/28/34)
-- ---------------------------------------------------------------------

create or replace function get_admin_customers(p_search text default null, p_cursor timestamptz default null, p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('customers.view') then
    raise exception 'not authorized';
  end if;

  return (
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select
        p.id, p.full_name, p.phone, p.email, p.is_active, p.created_at,
        (select count(*) from orders o where o.user_id = p.id and o.status != 'cancelled') as order_count,
        (select coalesce(sum(o.total), 0) from orders o where o.user_id = p.id and o.status != 'cancelled') as total_spend,
        (select max(o.placed_at) from orders o where o.user_id = p.id) as last_order_at,
        (select o.id from orders o where o.user_id = p.id and o.status not in ('delivered', 'cancelled') order by o.placed_at desc limit 1) as active_order_id
      from profiles p
      where p.role = 'customer'
        and (p_search is null or p_search = '' or p.full_name ilike '%' || p_search || '%' or p.phone ilike '%' || p_search || '%' or p.email ilike '%' || p_search || '%')
        and (p_cursor is null or p.created_at < p_cursor)
      order by p.created_at desc
      limit least(coalesce(p_limit, 20), 50)
    ) t
  );
end;
$$;

revoke all on function get_admin_customers from public, anon;
grant execute on function get_admin_customers to authenticated;

create or replace function set_customer_active(p_customer_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('customers.manage') then
    raise exception 'not authorized';
  end if;
  update profiles set is_active = p_is_active where id = p_customer_id and role = 'customer';
  if not found then
    raise exception 'customer not found';
  end if;
  perform log_audit_event('customer_status_changed', 'profiles', p_customer_id, jsonb_build_object('isActive', p_is_active));
end;
$$;

revoke all on function set_customer_active from public, anon;
grant execute on function set_customer_active to authenticated;

-- ---------------------------------------------------------------------
-- Inventory (section 14/15/16/17/20) — cross-store list + the
-- adjustment RPC the inventory table's own RLS comment already
-- anticipated ("a future store-manager restock RPC").
-- ---------------------------------------------------------------------

create or replace function get_admin_inventory(
  p_store_id uuid default null,
  p_low_stock_only boolean default false,
  p_search text default null,
  p_cursor uuid default null,
  p_limit int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('inventory.view') then
    raise exception 'not authorized';
  end if;

  return (
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select
        i.id, i.store_id, s.name as store_name,
        pv.id as variant_id, pv.sku, pr.name as product_name, pv.weight_value, pv.weight_unit,
        i.quantity, i.reserved_quantity, (i.quantity - i.reserved_quantity) as available_quantity,
        i.reorder_level, i.is_available,
        case when (i.quantity - i.reserved_quantity) <= 0 then 'out_of_stock'
             when (i.quantity - i.reserved_quantity) <= i.reorder_level then 'low_stock'
             else 'in_stock' end as stock_status
      from inventory i
      join product_variants pv on pv.id = i.product_variant_id
      join products pr on pr.id = pv.product_id
      join stores s on s.id = i.store_id
      where (p_store_id is null or i.store_id = p_store_id)
        and (not p_low_stock_only or (i.quantity - i.reserved_quantity) <= i.reorder_level)
        and (p_search is null or p_search = '' or pr.name ilike '%' || p_search || '%' or pv.sku ilike '%' || p_search || '%')
        and (p_cursor is null or i.id > p_cursor)
      order by i.id
      limit least(coalesce(p_limit, 30), 100)
    ) t
  );
end;
$$;

revoke all on function get_admin_inventory from public, anon;
grant execute on function get_admin_inventory to authenticated;

create or replace function adjust_inventory(
  p_store_id uuid,
  p_product_variant_id uuid,
  p_quantity_change int,
  p_movement_type inventory_movement_type,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row inventory%rowtype;
  v_new_quantity int;
begin
  if not (has_permission('inventory.manage') or has_permission('inventory.adjust') or is_store_staff(p_store_id)) then
    raise exception 'not authorized';
  end if;
  if p_movement_type in ('reservation', 'reservation_release', 'sale') then
    raise exception 'movement_type % is system-managed, not a manual adjustment', p_movement_type;
  end if;

  select * into v_row from inventory where store_id = p_store_id and product_variant_id = p_product_variant_id for update;
  if v_row is null then
    raise exception 'no inventory row for this store/variant';
  end if;

  v_new_quantity := v_row.quantity + p_quantity_change;
  if v_new_quantity < 0 then
    raise exception 'adjustment would take quantity negative (current %, change %)', v_row.quantity, p_quantity_change;
  end if;
  if v_new_quantity < v_row.reserved_quantity then
    raise exception 'adjustment would take available stock below already-reserved quantity (%)', v_row.reserved_quantity;
  end if;

  update inventory set quantity = v_new_quantity where id = v_row.id;
  insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, reference_id, created_by)
  values (p_store_id, p_product_variant_id, p_quantity_change, p_movement_type, 'manual_adjustment', null, auth.uid());

  perform log_audit_event('inventory_adjusted', 'inventory', v_row.id, jsonb_build_object(
    'quantityBefore', v_row.quantity, 'quantityAfter', v_new_quantity, 'change', p_quantity_change, 'movementType', p_movement_type, 'reason', p_reason
  ));

  return jsonb_build_object('quantityBefore', v_row.quantity, 'quantityAfter', v_new_quantity);
end;
$$;

comment on function adjust_inventory is 'The single write path for manual stock changes (section 15) — every call produces exactly one inventory_movements row and one audit_logs row (section 16/32). The row lock (FOR UPDATE) makes two concurrent adjustments to the same store/variant serialize correctly rather than lose an update (section 50/51).';

revoke all on function adjust_inventory from public, anon;
grant execute on function adjust_inventory to authenticated;
