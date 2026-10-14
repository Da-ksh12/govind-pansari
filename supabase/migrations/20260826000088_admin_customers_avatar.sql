-- Premium admin redesign section 42: the reusable Avatar component
-- covers riders/customers/staff/admins — customers just never had
-- their real avatar_url (profiles already has the column) surfaced by
-- this RPC. Purely additive.
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
        p.id, p.full_name, p.phone, p.email, p.avatar_url, p.is_active, p.created_at,
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
