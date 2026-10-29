-- A product photo is mandatory. The Add/Edit Product wizard asks for one; this
-- makes the database enforce it too, so a direct API call, an import script or
-- an older app build cannot create or save a product without a primary image,
-- and an admin cannot strip the photo from an existing product (replacing it
-- is fine).
--
-- Only the two checks below are new. Both functions are otherwise reproduced
-- verbatim from their previous definitions (admin_create_product_full from
-- 20260827000006, admin_update_product from 20260826000056), each confirmed
-- identical to the live function before this migration was written.
--
-- Existing products that have no photo (the test rows "jjllk" and "ghgh")
-- are left as they are, but cannot be edited and re-saved until one is added.
--
-- Rollback: re-apply the two functions from the files named above.

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

  perform log_audit_event('product_created', 'products', v_product_id, jsonb_build_object('name', p_product->>'name', 'variantCount', jsonb_array_length(p_variants)));

  return jsonb_build_object('success', true, 'productId', v_product_id, 'variantIds', to_jsonb(v_variant_ids));
end;
$$;

create or replace function admin_update_product(p_product_id uuid, p_product jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before products%rowtype;
begin
  if not has_permission('products.edit') then
    raise exception 'not authorized';
  end if;
  select * into v_before from products where id = p_product_id;
  if v_before is null then
    raise exception 'product not found';
  end if;
  if coalesce(p_product->>'name', '') = '' then
    raise exception 'name is required';
  end if;
  if nullif(trim(coalesce(p_product->>'image', '')), '') is null then
    raise exception 'a product photo is required';
  end if;

  update products set
    name = p_product->>'name',
    category_id = (p_product->>'category_id')::uuid,
    description = nullif(p_product->>'description', ''),
    short_description = nullif(p_product->>'short_description', ''),
    brand = coalesce(nullif(p_product->>'brand', ''), 'Govind Pansari'),
    image = nullif(p_product->>'image', ''),
    gallery = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_product->'gallery', '[]'::jsonb)) x), '{}'),
    tags = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_product->'tags', '[]'::jsonb)) x), '{}'),
    is_featured = coalesce((p_product->>'is_featured')::boolean, false),
    is_bestseller = coalesce((p_product->>'is_bestseller')::boolean, false)
  where id = p_product_id;

  perform log_audit_event('product_updated', 'products', p_product_id, jsonb_build_object('before', to_jsonb(v_before), 'after', p_product));
  return jsonb_build_object('success', true);
end;
$$;
