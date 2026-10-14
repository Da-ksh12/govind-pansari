-- Premium admin redesign, remaining sections: a real fleet dispatch
-- map and a real analytics view. Both are read-only, additive RPCs —
-- no existing function, table, or policy is touched.

-- ---------------------------------------------------------------------
-- Fleet map (section 10). docs/admin-riders.md flagged that no admin
-- screen reads rider_locations/riders.current_* directly and that
-- doing so needs its own permission gate rather than raw table access
-- (is_admin() alone would only work for super_admin post-041). This
-- RPC is that gate: SECURITY DEFINER, checked against riders.view,
-- same pattern as every other get_admin_* query function.
-- ---------------------------------------------------------------------
create or replace function get_active_rider_locations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_permission('riders.view') then
    raise exception 'not authorized';
  end if;

  return (
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
      select
        r.id as rider_id, p.full_name, p.phone, r.vehicle_type,
        r.current_latitude, r.current_longitude, r.last_location_at,
        r.is_active, r.is_available,
        da.id as active_delivery_id, da.status as active_delivery_status,
        o.id as active_order_id, o.order_number as active_order_number,
        s.name as active_store_name
      from riders r
      join profiles p on p.id = r.profile_id
      left join lateral (
        select da.* from delivery_assignments da
        where da.rider_id = r.id and not is_terminal_delivery_status(da.status)
        order by da.assigned_at desc limit 1
      ) da on true
      left join orders o on o.id = da.order_id
      left join stores s on s.id = da.store_id
      where r.is_active and r.current_latitude is not null and r.current_longitude is not null
      order by p.full_name
    ) t
  );
end;
$$;

comment on function get_active_rider_locations is 'Fleet dispatch map data (section 10) — every active rider''s last-known position, gated on riders.view rather than raw rider_locations/riders SELECT (is_admin() alone would exclude every scoped admin role post-041''s redefinition).';

revoke all on function get_active_rider_locations from public, anon;
grant execute on function get_active_rider_locations to authenticated;

-- ---------------------------------------------------------------------
-- Analytics (section 21). Real aggregates only, over a caller-chosen
-- trailing window — same "coalesce to 0/empty, never fabricate" style
-- as get_admin_dashboard. Cancelled orders are excluded from every
-- revenue figure, matching that function's existing convention.
-- ---------------------------------------------------------------------
create or replace function get_admin_analytics(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => greatest(coalesce(p_days, 30), 1) - 1);
  v_result jsonb;
begin
  if not has_permission('analytics.view') then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'periodDays', greatest(coalesce(p_days, 30), 1),
    'totals', jsonb_build_object(
      'revenue', (select coalesce(sum(total), 0) from orders where placed_at >= v_since and status != 'cancelled'),
      'orders', (select count(*) from orders where placed_at >= v_since),
      'cancelledOrders', (select count(*) from orders where placed_at >= v_since and status = 'cancelled'),
      'averageOrderValue', (select coalesce(round(avg(total), 2), 0) from orders where placed_at >= v_since and status != 'cancelled'),
      'newCustomers', (select count(*) from profiles where role = 'customer' and created_at >= v_since)
    ),
    'revenueByDay', (
      select coalesce(jsonb_agg(row_to_json(d) order by d.day), '[]'::jsonb) from (
        select
          gs.day::date as day,
          coalesce(sum(o.total) filter (where o.status != 'cancelled'), 0) as revenue,
          count(o.id) as orders
        from generate_series(v_since, date_trunc('day', now()), interval '1 day') gs(day)
        left join orders o on date_trunc('day', o.placed_at) = gs.day
        group by gs.day
      ) d
    ),
    'topProducts', (
      select coalesce(jsonb_agg(row_to_json(tp)), '[]'::jsonb) from (
        select
          oi.product_id, max(oi.product_name_snapshot) as name,
          sum(oi.quantity) as quantity_sold, sum(oi.total) as revenue
        from order_items oi
        join orders o on o.id = oi.order_id
        where o.placed_at >= v_since and o.status != 'cancelled'
        group by oi.product_id
        order by revenue desc
        limit 10
      ) tp
    ),
    'categoryBreakdown', (
      select coalesce(jsonb_agg(row_to_json(cb)), '[]'::jsonb) from (
        select
          coalesce(c.name, 'Uncategorised') as category_name,
          sum(oi.total) as revenue, sum(oi.quantity) as quantity_sold
        from order_items oi
        join orders o on o.id = oi.order_id
        left join products pr on pr.id = oi.product_id
        left join categories c on c.id = pr.category_id
        where o.placed_at >= v_since and o.status != 'cancelled'
        group by c.name
        order by revenue desc
      ) cb
    ),
    'statusBreakdown', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) from (
        select status::text as status, count(*) as cnt from orders
        where placed_at >= v_since
        group by status
      ) sb
    )
  ) into v_result;

  return v_result;
end;
$$;

comment on function get_admin_analytics is 'Real revenue/top-product/category/status aggregates over a trailing window (section 21 — "do not create fake analytics"). Every figure is a live sum/count against orders/order_items, never a static or estimated number.';

revoke all on function get_admin_analytics from public, anon;
grant execute on function get_admin_analytics to authenticated;
