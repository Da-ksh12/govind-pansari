-- QA report TC-18 (negative opening stock accepted), TC-19 (same SKU on
-- several variants) and TC-20 (MRP / selling-price validation).
--
-- Findings in the existing RPCs:
--   * admin_create_product_full() did not reject a negative opening
--     quantity — it silently clamped it with greatest(qty, 0), so the
--     product saved "successfully" with the stock the admin typed
--     discarded. (The inventory table's own CHECK (quantity >= 0) and
--     admin_initialize_inventory() / record_inventory_adjustment() already
--     reject negatives; this was the one path that swallowed them.)
--   * SKU uniqueness was case-sensitive in the RPCs (the column has a plain
--     UNIQUE), so "sku009" and "SKU009" were treated as different.
--   * A price or MRP of 0 was accepted, and prices with more than two
--     decimal places were rounded by the numeric(10,2) column without
--     telling the admin.
--
-- Rules now enforced in the database, whatever the client sends:
--   * SKU: required, trimmed, unique case-insensitively — across the whole
--     catalogue and within the same request.
--   * price > 0, mrp >= price, both with at most 2 decimal places.
--   * weight > 0.
--   * opening stock: a whole number >= 0 (rejected, never clamped);
--     reorder level a whole number >= 0.
--
-- Rollback: re-apply admin_create_product_full / admin_upsert_variant /
-- admin_initialize_inventory from 20260826000056.

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

create or replace function admin_initialize_inventory(p_store_id uuid, p_variant_id uuid, p_quantity int, p_reorder_level int default 5, p_is_available boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing inventory%rowtype;
begin
  if not (has_permission('inventory.manage') or is_store_staff(p_store_id)) then
    raise exception 'not authorized';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'quantity cannot be negative';
  end if;
  if p_reorder_level is not null and p_reorder_level < 0 then
    raise exception 'reorder level cannot be negative';
  end if;

  select * into v_existing from inventory where store_id = p_store_id and product_variant_id = p_variant_id for update;

  if v_existing is null then
    insert into inventory (store_id, product_variant_id, quantity, reorder_level, is_available)
    values (p_store_id, p_variant_id, p_quantity, coalesce(p_reorder_level, 5), coalesce(p_is_available, true));
    insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, created_by)
    values (p_store_id, p_variant_id, p_quantity, 'purchase', 'manual_adjustment', auth.uid());
    perform log_audit_event('inventory_initialized', 'inventory', p_variant_id, jsonb_build_object('storeId', p_store_id, 'quantity', p_quantity));
  else
    if p_quantity < v_existing.reserved_quantity then
      raise exception 'new quantity (%) is below the % units already reserved for other orders', p_quantity, v_existing.reserved_quantity;
    end if;
    update inventory set quantity = p_quantity, reorder_level = coalesce(p_reorder_level, reorder_level), is_available = coalesce(p_is_available, is_available)
    where id = v_existing.id;
    insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, created_by)
    values (p_store_id, p_variant_id, p_quantity - v_existing.quantity, 'adjustment', 'manual_adjustment', auth.uid());
    perform log_audit_event('inventory_initialized', 'inventory', p_variant_id, jsonb_build_object('storeId', p_store_id, 'oldQuantity', v_existing.quantity, 'newQuantity', p_quantity));
  end if;

  return jsonb_build_object('success', true);
end;
$$;
