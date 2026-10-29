-- "No store near you can fulfil your whole cart" kept coming back because a product
-- could exist without a stock record at one of the active stores. Checkout needs ONE
-- store that has every item, and a store with no record for an item counts as not
-- having it. The Add Product wizard only wrote stock rows for the stores where an
-- opening quantity was typed, so publishing with stock at one store left the other
-- store with no record at all (and the app showed such items as "In Stock").
--
-- This migration makes that gap impossible rather than just fixing today's rows:
--   1. ensure_inventory_rows_for_variants(): gives every active product variant a stock
--      record (quantity 0, so it reads "out of stock", never missing) at every active store.
--   2. admin_create_product_full / admin_upsert_variant call it, so a new product or a new
--      variant has a record at every active store from its first moment.
--   3. A scheduled job (every 15 minutes) calls it for everything, which also covers a store
--      that is activated later, or variants added by a script.
--   4. A scheduled job deactivates a store marked "Not a real branch" if it was left active:
--      the Sanjay Place fixture store sat active from 2026-09-18, silently taking customers
--      in its area into a store that stocks only part of the catalogue.
--   5. One-off backfill so the rule holds immediately.
--
-- admin_create_product_full and admin_upsert_variant are otherwise reproduced verbatim
-- (from 20260827000011 and 20260827000006), each confirmed identical to the live function
-- before this migration was written.
--
-- Rollback: select cron.unschedule('ensure-inventory-rows'); select cron.unschedule('deactivate-fixture-stores');
-- drop function ensure_inventory_rows_for_variants(uuid[]); then re-apply the two functions
-- from the files named above.

create or replace function ensure_inventory_rows_for_variants(p_variant_ids uuid[] default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created int;
begin
  insert into inventory (store_id, product_variant_id, quantity, reorder_level, is_available)
  select s.id, pv.id, 0, 5, true
  from product_variants pv
  join products p on p.id = pv.product_id
  cross join stores s
  where pv.is_active and p.is_active and s.is_active
    and (p_variant_ids is null or pv.id = any(p_variant_ids))
    and not exists (
      select 1 from inventory i where i.store_id = s.id and i.product_variant_id = pv.id
    )
  on conflict (store_id, product_variant_id) do nothing;
  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

comment on function ensure_inventory_rows_for_variants is 'Creates a zero-quantity stock record for every active variant at every active store that lacks one (all variants when called with no argument). Internal: called by the product RPCs and a scheduled job, never by clients.';

revoke all on function ensure_inventory_rows_for_variants(uuid[]) from public, anon, authenticated;

create or replace function admin_create_product_full(p_product jsonb, p_variants jsonb, p_inventory jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_variant jsonb;
  v_variant_id uuid;
  v_variant_ids uuid[] := '{}';
  v_inv jsonb;
  v_idx int;
  v_price numeric;
  v_mrp numeric;
  v_weight numeric;
  v_sku text;
  v_qty numeric;
  v_reorder numeric;
begin
  if not has_permission('products.create') then
    raise exception 'not authorized';
  end if;
  if p_variants is null or jsonb_typeof(p_variants) != 'array' or jsonb_array_length(p_variants) = 0 then
    raise exception 'a product must have at least one variant';
  end if;
  if coalesce(p_product->>'name', '') = '' or coalesce(p_product->>'slug', '') = '' then
    raise exception 'name and slug are required';
  end if;
  if nullif(trim(coalesce(p_product->>'image', '')), '') is null then
    raise exception 'a product photo is required';
  end if;
  if p_inventory is null or jsonb_typeof(p_inventory) != 'array' then
    raise exception 'inventory must be a list';
  end if;

  insert into products (category_id, name, slug, description, short_description, brand, image, gallery, tags, is_featured, is_bestseller)
  values (
    (p_product->>'category_id')::uuid,
    p_product->>'name',
    p_product->>'slug',
    nullif(p_product->>'description', ''),
    nullif(p_product->>'short_description', ''),
    coalesce(nullif(p_product->>'brand', ''), 'Govind Pansari'),
    nullif(p_product->>'image', ''),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_product->'gallery', '[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_product->'tags', '[]'::jsonb)) x), '{}'),
    coalesce((p_product->>'is_featured')::boolean, false),
    coalesce((p_product->>'is_bestseller')::boolean, false)
  )
  returning id into v_product_id;

  for v_idx in 0 .. jsonb_array_length(p_variants) - 1 loop
    v_variant := p_variants -> v_idx;
    v_sku := btrim(coalesce(v_variant->>'sku', ''));
    v_price := (v_variant->>'price')::numeric;
    v_mrp := (v_variant->>'mrp')::numeric;
    v_weight := (v_variant->>'weight_value')::numeric;

    if v_sku = '' then
      raise exception 'every variant needs a SKU';
    end if;
    if exists (select 1 from product_variants where upper(sku) = upper(v_sku)) then
      raise exception 'SKU % already exists', v_sku;
    end if;
    if v_price is null or v_price <= 0 then
      raise exception 'the selling price for variant % must be greater than 0', v_sku;
    end if;
    if v_mrp is null or v_mrp <= 0 then
      raise exception 'the MRP for variant % must be greater than 0', v_sku;
    end if;
    if round(v_price, 2) <> v_price or round(v_mrp, 2) <> v_mrp then
      raise exception 'price and MRP for variant % can have at most 2 decimal places', v_sku;
    end if;
    if v_mrp < v_price then
      raise exception 'MRP must be >= price for variant %', v_sku;
    end if;
    if v_weight is null or v_weight <= 0 then
      raise exception 'invalid weight for variant %', v_sku;
    end if;

    insert into product_variants (product_id, sku, weight_value, weight_unit, price, mrp)
    values (v_product_id, v_sku, v_weight, (v_variant->>'weight_unit')::weight_unit, v_price, v_mrp)
    returning id into v_variant_id;

    v_variant_ids := v_variant_ids || v_variant_id;
  end loop;

  for v_inv in select * from jsonb_array_elements(p_inventory) loop
    v_idx := (v_inv->>'variant_index')::int;
    if v_idx is null or v_idx < 0 or v_idx >= array_length(v_variant_ids, 1) then
      raise exception 'invalid variant_index in inventory row';
    end if;
    v_qty := coalesce((v_inv->>'quantity')::numeric, 0);
    v_reorder := coalesce((v_inv->>'reorder_level')::numeric, 5);
    if v_qty < 0 then
      raise exception 'opening stock cannot be negative';
    end if;
    if v_qty <> floor(v_qty) then
      raise exception 'opening stock must be a whole number';
    end if;
    if v_reorder < 0 or v_reorder <> floor(v_reorder) then
      raise exception 'reorder level must be a whole number that is not negative';
    end if;

    insert into inventory (store_id, product_variant_id, quantity, reorder_level, is_available)
    values (
      (v_inv->>'store_id')::uuid,
      v_variant_ids[v_idx + 1],
      v_qty::int,
      v_reorder::int,
      coalesce((v_inv->>'is_available')::boolean, true)
    );
    insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, created_by)
    values ((v_inv->>'store_id')::uuid, v_variant_ids[v_idx + 1], v_qty::int, 'purchase', 'manual_adjustment', auth.uid());
  end loop;

  -- Every variant gets a stock record at every active store (zero where no opening stock was given),
  -- so a store can never silently lack a product it is supposed to carry.
  perform ensure_inventory_rows_for_variants(v_variant_ids);

  perform log_audit_event('product_created', 'products', v_product_id, jsonb_build_object('name', p_product->>'name', 'variantCount', jsonb_array_length(p_variants)));

  return jsonb_build_object('success', true, 'productId', v_product_id, 'variantIds', to_jsonb(v_variant_ids));
end;
$$;

create or replace function admin_upsert_variant(p_variant_id uuid, p_product_id uuid, p_sku text, p_weight_value numeric, p_weight_unit weight_unit, p_price numeric, p_mrp numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_sku text := btrim(coalesce(p_sku, ''));
begin
  if p_variant_id is null then
    if not has_permission('products.create') then
      raise exception 'not authorized';
    end if;
  else
    if not has_permission('products.edit') then
      raise exception 'not authorized';
    end if;
  end if;

  if v_sku = '' then
    raise exception 'SKU is required';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'the selling price must be greater than 0';
  end if;
  if p_mrp is null or p_mrp <= 0 then
    raise exception 'the MRP must be greater than 0';
  end if;
  if round(p_price, 2) <> p_price or round(p_mrp, 2) <> p_mrp then
    raise exception 'price and MRP can have at most 2 decimal places';
  end if;
  if p_mrp < p_price then
    raise exception 'MRP must be >= price';
  end if;
  if p_weight_value is null or p_weight_value <= 0 then
    raise exception 'invalid weight';
  end if;
  if exists (select 1 from product_variants where upper(sku) = upper(v_sku) and id is distinct from p_variant_id) then
    raise exception 'SKU % already exists', v_sku;
  end if;
  if not exists (select 1 from products where id = p_product_id) then
    raise exception 'product not found';
  end if;

  if p_variant_id is null then
    insert into product_variants (product_id, sku, weight_value, weight_unit, price, mrp)
    values (p_product_id, v_sku, p_weight_value, p_weight_unit, p_price, p_mrp)
    returning id into v_id;
    perform log_audit_event('variant_created', 'product_variants', v_id, jsonb_build_object('sku', v_sku, 'productId', p_product_id));
    perform ensure_inventory_rows_for_variants(array[v_id]);
  else
    update product_variants set sku = v_sku, weight_value = p_weight_value, weight_unit = p_weight_unit, price = p_price, mrp = p_mrp
    where id = p_variant_id and product_id = p_product_id;
    if not found then
      raise exception 'variant not found on this product';
    end if;
    v_id := p_variant_id;
    perform log_audit_event('variant_updated', 'product_variants', v_id, jsonb_build_object('sku', v_sku));
  end if;

  return jsonb_build_object('success', true, 'variantId', v_id);
end;
$$;

-- One-off backfill: close every existing gap now.
select ensure_inventory_rows_for_variants();

-- Keep the rule true from here on.
select cron.schedule('ensure-inventory-rows', '*/15 * * * *', $job$select ensure_inventory_rows_for_variants();$job$);

select cron.schedule(
  'deactivate-fixture-stores',
  '*/10 * * * *',
  $job$update stores set is_active = false where is_active and status_reason ilike 'Not a real branch%' and updated_at < now() - interval '30 minutes';$job$
);
