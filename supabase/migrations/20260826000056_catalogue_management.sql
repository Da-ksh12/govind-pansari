-- Pre-production hardening, Part 2/3/5/6/7/8/25/28: real Admin product
-- catalogue management. Before this migration, admin could only
-- toggle products.is_active and create a bare-name category — every
-- product/variant/inventory row in the database was put there by
-- hand-written SQL seed data, never through the app.
--
-- Reuses the existing hierarchy exactly as-is (categories -> products
-- -> product_variants -> inventory, section 5/6 of the audit) and the
-- existing products/product_variants/categories RLS insert/update
-- policies already added in 20260826000044_admin_permission_rls.sql
-- (has_permission('products.create'/'products.edit'/'categories.manage'))
-- — those already correctly scope inventory_manager. New here is only
-- what genuinely needs a transaction or an audit trail: creating a
-- product+variants+inventory atomically, and initializing an
-- inventory row that doesn't exist yet (the gap that made
-- adjust_inventory/record_inventory_adjustment unusable for a brand
-- new product — both explicitly require an existing row).

-- ---------------------------------------------------------------------
-- Storage: real product photos instead of external Unsplash URLs.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product_images_public_read" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "product_images_admin_write" on storage.objects
  for insert with check (
    bucket_id = 'product-images'
    and (has_permission('products.create') or has_permission('products.edit'))
  );

create policy "product_images_admin_update" on storage.objects
  for update using (
    bucket_id = 'product-images'
    and (has_permission('products.create') or has_permission('products.edit'))
  );

create policy "product_images_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'product-images'
    and (has_permission('products.create') or has_permission('products.edit'))
  );

-- ---------------------------------------------------------------------
-- admin_create_product_full: the one transactional creation RPC (Part
-- 28) — product + every variant + opening inventory in a single
-- function, so a failure partway through (duplicate SKU, bad price)
-- rolls back everything instead of leaving a half-created product.
-- ---------------------------------------------------------------------
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
    v_price := (v_variant->>'price')::numeric;
    v_mrp := (v_variant->>'mrp')::numeric;
    v_weight := (v_variant->>'weight_value')::numeric;

    if coalesce(v_variant->>'sku', '') = '' then
      raise exception 'every variant needs a SKU';
    end if;
    if exists (select 1 from product_variants where sku = v_variant->>'sku') then
      raise exception 'SKU % already exists', v_variant->>'sku';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'invalid price for variant %', v_variant->>'sku';
    end if;
    if v_mrp is null or v_mrp < v_price then
      raise exception 'MRP must be >= price for variant %', v_variant->>'sku';
    end if;
    if v_weight is null or v_weight <= 0 then
      raise exception 'invalid weight for variant %', v_variant->>'sku';
    end if;

    insert into product_variants (product_id, sku, weight_value, weight_unit, price, mrp)
    values (v_product_id, v_variant->>'sku', v_weight, (v_variant->>'weight_unit')::weight_unit, v_price, v_mrp)
    returning id into v_variant_id;

    v_variant_ids := v_variant_ids || v_variant_id;
  end loop;

  for v_inv in select * from jsonb_array_elements(p_inventory) loop
    v_idx := (v_inv->>'variant_index')::int;
    if v_idx is null or v_idx < 0 or v_idx >= array_length(v_variant_ids, 1) then
      raise exception 'invalid variant_index in inventory row';
    end if;
    insert into inventory (store_id, product_variant_id, quantity, reorder_level, is_available)
    values (
      (v_inv->>'store_id')::uuid,
      v_variant_ids[v_idx + 1],
      greatest(coalesce((v_inv->>'quantity')::int, 0), 0),
      coalesce((v_inv->>'reorder_level')::int, 5),
      coalesce((v_inv->>'is_available')::boolean, true)
    );
    insert into inventory_movements (store_id, product_variant_id, quantity_change, movement_type, reference_type, created_by)
    values ((v_inv->>'store_id')::uuid, v_variant_ids[v_idx + 1], greatest(coalesce((v_inv->>'quantity')::int, 0), 0), 'purchase', 'manual_adjustment', auth.uid());
  end loop;

  perform log_audit_event('product_created', 'products', v_product_id, jsonb_build_object('name', p_product->>'name', 'variantCount', jsonb_array_length(p_variants)));

  return jsonb_build_object('success', true, 'productId', v_product_id, 'variantIds', to_jsonb(v_variant_ids));
end;
$$;

revoke all on function admin_create_product_full from public, anon;
grant execute on function admin_create_product_full to authenticated;

-- ---------------------------------------------------------------------
-- admin_update_product: full-replace semantics (client sends the
-- complete new field set, not a partial diff) — avoids jsonb
-- present-vs-null ambiguity entirely. Never touches order_items, which
-- already snapshot price/name at order time (Part 7's "historical
-- orders must never change" requirement — pre-existing behavior,
-- unaffected by this).
-- ---------------------------------------------------------------------
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

revoke all on function admin_update_product from public, anon;
grant execute on function admin_update_product to authenticated;

-- ---------------------------------------------------------------------
-- admin_upsert_variant: add a new variant to an existing product, or
-- edit one (p_variant_id null = create). Never a hard delete —
-- archival only (admin_set_variant_active), since a variant may be
-- referenced by historical order_items (Part 5's explicit requirement).
-- ---------------------------------------------------------------------
create or replace function admin_upsert_variant(p_variant_id uuid, p_product_id uuid, p_sku text, p_weight_value numeric, p_weight_unit weight_unit, p_price numeric, p_mrp numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
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

  if coalesce(p_sku, '') = '' then
    raise exception 'SKU is required';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'invalid price';
  end if;
  if p_mrp is null or p_mrp < p_price then
    raise exception 'MRP must be >= price';
  end if;
  if p_weight_value is null or p_weight_value <= 0 then
    raise exception 'invalid weight';
  end if;
  if exists (select 1 from product_variants where sku = p_sku and id is distinct from p_variant_id) then
    raise exception 'SKU % already exists', p_sku;
  end if;
  if not exists (select 1 from products where id = p_product_id) then
    raise exception 'product not found';
  end if;

  if p_variant_id is null then
    insert into product_variants (product_id, sku, weight_value, weight_unit, price, mrp)
    values (p_product_id, p_sku, p_weight_value, p_weight_unit, p_price, p_mrp)
    returning id into v_id;
    perform log_audit_event('variant_created', 'product_variants', v_id, jsonb_build_object('sku', p_sku, 'productId', p_product_id));
  else
    update product_variants set sku = p_sku, weight_value = p_weight_value, weight_unit = p_weight_unit, price = p_price, mrp = p_mrp
    where id = p_variant_id and product_id = p_product_id;
    if not found then
      raise exception 'variant not found on this product';
    end if;
    v_id := p_variant_id;
    perform log_audit_event('variant_updated', 'product_variants', v_id, jsonb_build_object('sku', p_sku));
  end if;

  return jsonb_build_object('success', true, 'variantId', v_id);
end;
$$;

revoke all on function admin_upsert_variant from public, anon;
grant execute on function admin_upsert_variant to authenticated;

create or replace function admin_set_variant_active(p_variant_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('products.edit') then
    raise exception 'not authorized';
  end if;
  update product_variants set is_active = p_is_active where id = p_variant_id;
  if not found then
    raise exception 'variant not found';
  end if;
  perform log_audit_event(case when p_is_active then 'variant_activated' else 'variant_archived' end, 'product_variants', p_variant_id, '{}'::jsonb);
end;
$$;

revoke all on function admin_set_variant_active from public, anon;
grant execute on function admin_set_variant_active to authenticated;

-- ---------------------------------------------------------------------
-- admin_initialize_inventory: upsert, unlike adjust_inventory/
-- record_inventory_adjustment which both require an existing row
-- (Part 6's exact gap). Creates the row (with a real inventory_movements
-- entry) if missing, or safely overwrites it (still enforcing the
-- reserved-quantity floor) if it already exists — one function covers
-- both "brand new product's opening stock" and "we forgot to stock
-- this store, add it now".
-- ---------------------------------------------------------------------
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

revoke all on function admin_initialize_inventory from public, anon;
grant execute on function admin_initialize_inventory to authenticated;

-- ---------------------------------------------------------------------
-- Category management (Part 3): the schema already had description/
-- image_url/parent_id/sort_order — createCategory() (client-side
-- insert, already RLS-protected) just never set them, and there was no
-- edit path at all. One RPC for create+edit so both get an audit trail
-- and the "cannot be its own parent" check in one place.
-- ---------------------------------------------------------------------
create or replace function admin_create_category(p_name text, p_slug text, p_description text default null, p_image_url text default null, p_parent_id uuid default null, p_sort_order int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not has_permission('categories.manage') then
    raise exception 'not authorized';
  end if;
  if coalesce(p_name, '') = '' or coalesce(p_slug, '') = '' then
    raise exception 'name and slug are required';
  end if;
  insert into categories (name, slug, description, image_url, parent_id, sort_order)
  values (p_name, p_slug, nullif(p_description, ''), nullif(p_image_url, ''), p_parent_id, coalesce(p_sort_order, 0))
  returning id into v_id;
  perform log_audit_event('category_created', 'categories', v_id, jsonb_build_object('name', p_name));
  return jsonb_build_object('success', true, 'categoryId', v_id);
end;
$$;

revoke all on function admin_create_category from public, anon;
grant execute on function admin_create_category to authenticated;

create or replace function admin_update_category(p_category_id uuid, p_name text, p_description text default null, p_image_url text default null, p_parent_id uuid default null, p_sort_order int default 0)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_permission('categories.manage') then
    raise exception 'not authorized';
  end if;
  if p_parent_id = p_category_id then
    raise exception 'a category cannot be its own parent';
  end if;
  if coalesce(p_name, '') = '' then
    raise exception 'name is required';
  end if;
  update categories set
    name = p_name,
    description = nullif(p_description, ''),
    image_url = nullif(p_image_url, ''),
    parent_id = p_parent_id,
    sort_order = coalesce(p_sort_order, 0)
  where id = p_category_id;
  if not found then
    raise exception 'category not found';
  end if;
  perform log_audit_event('category_updated', 'categories', p_category_id, jsonb_build_object('name', p_name));
end;
$$;

revoke all on function admin_update_category from public, anon;
grant execute on function admin_update_category to authenticated;

-- ---------------------------------------------------------------------
-- Realtime (Part 11/12): admin catalogue screens can now subscribe to
-- live product/category changes made by other admins, same as the
-- riders/inventory tables added in 20260826000055.
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table products;
alter publication supabase_realtime add table categories;
