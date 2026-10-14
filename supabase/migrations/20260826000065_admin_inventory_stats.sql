-- Premium admin redesign: the Inventory screen's header stat cards
-- (Total SKUs / Low Stock / Out of Stock / Total Value) need real
-- counts across the *entire* filtered scope, not just the current
-- page of rows. The available/reorder comparison is a cross-column
-- expression PostgREST can't filter on directly, so this mirrors
-- get_admin_inventory's exact stock_status computation in one
-- aggregate query. Same permission gate, same store-scoping.
create or replace function get_admin_inventory_stats(p_store_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not has_permission('inventory.view') then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'totalSkus', count(*),
    'lowStock', count(*) filter (where (i.quantity - i.reserved_quantity) > 0 and (i.quantity - i.reserved_quantity) <= i.reorder_level),
    'outOfStock', count(*) filter (where (i.quantity - i.reserved_quantity) <= 0),
    'totalValue', coalesce(sum((i.quantity - i.reserved_quantity) * pv.price), 0)
  )
  into v_result
  from inventory i
  join product_variants pv on pv.id = i.product_variant_id
  where (p_store_id is null or i.store_id = p_store_id);

  return v_result;
end;
$$;

revoke all on function get_admin_inventory_stats from public, anon;
grant execute on function get_admin_inventory_stats to authenticated;
