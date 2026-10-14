-- Premium admin redesign section 10: the Inventory screen is too
-- text-heavy — every row needs the actual product photo so an admin
-- can identify it at a glance instead of parsing a SKU string. Purely
-- additive (one new key, product_image) — nothing existing changes.
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
        pv.id as variant_id, pv.sku, pr.name as product_name, pr.image as product_image, pv.weight_value, pv.weight_unit,
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
