-- Admin Control Center, part 4: additive RLS for the new scoped admin
-- roles. Every policy here is a NEW policy added alongside whatever
-- already exists on each table — nothing already there is dropped or
-- edited, so a legacy full admin's access is provably unchanged
-- (Postgres RLS policies are OR'd together; adding a narrower one
-- only ever adds access, never removes it).

-- Catalogue: inventory_manager needs to create/edit products and
-- manage categories (section 11/13). Insert/update only, deliberately
-- never delete — section 48 wants archival (is_active = false, an
-- UPDATE) not hard deletion; a true DELETE stays restricted to
-- is_admin()'s existing, unchanged policy.
create policy "products_permission_insert" on products for insert with check (has_permission('products.create'));
create policy "products_permission_update" on products for update using (has_permission('products.edit')) with check (has_permission('products.edit'));
create policy "products_permission_read" on products for select using (has_permission('products.view'));

create policy "product_variants_permission_insert" on product_variants for insert with check (has_permission('products.create'));
create policy "product_variants_permission_update" on product_variants for update using (has_permission('products.edit')) with check (has_permission('products.edit'));
create policy "product_variants_permission_read" on product_variants for select using (has_permission('products.view'));

create policy "categories_permission_insert" on categories for insert with check (has_permission('categories.manage'));
create policy "categories_permission_update" on categories for update using (has_permission('categories.manage')) with check (has_permission('categories.manage'));
create policy "categories_permission_read" on categories for select using (has_permission('categories.manage'));

-- Inventory: cross-store visibility/management for inventory_manager
-- (section 20) — existing is_store_staff()-scoped policies only cover
-- a staff member's own store, which is the wrong scope for a role
-- whose whole job is cross-store inventory oversight.
create policy "inventory_permission_read" on inventory for select using (has_permission('inventory.view'));
create policy "inventory_permission_write" on inventory for update
  using (has_permission('inventory.manage') or has_permission('inventory.adjust'))
  with check (has_permission('inventory.manage') or has_permission('inventory.adjust'));

create policy "inventory_movements_permission_read" on inventory_movements for select using (has_permission('inventory.view'));

-- Stores.
create policy "stores_permission_read" on stores for select using (has_permission('stores.view'));
create policy "stores_permission_write" on stores for update using (has_permission('stores.manage')) with check (has_permission('stores.manage'));

create policy "store_staff_permission_read" on store_staff for select using (has_permission('users.view') or has_permission('stores.view'));

-- Riders — delivery_manager's core surface.
create policy "riders_permission_read" on riders for select using (has_permission('riders.view'));
create policy "riders_permission_write" on riders for update using (has_permission('riders.manage')) with check (has_permission('riders.manage'));

-- Orders/order_items — read for anyone with orders.view (operations_manager,
-- support_agent); existing owner/store-staff policies are untouched.
create policy "orders_permission_read" on orders for select using (has_permission('orders.view'));
create policy "order_items_permission_read" on order_items for select using (has_permission('orders.view'));

-- delivery_assignments — dispatch visibility (section 24/25).
create policy "delivery_assignments_permission_read" on delivery_assignments for select using (has_permission('deliveries.view'));

-- profiles — customer list/detail (section 27/28) needs to read
-- customer profiles broadly, not just is_admin(); explicitly still
-- excludes writing role/admin_role here (see assign_admin_role,
-- migration 048 — a column-level grant, not this row policy, decides
-- that) and excludes reading auth secrets, which live in auth.users,
-- a table this policy has no bearing on at all.
create policy "profiles_permission_read" on profiles for select using (has_permission('customers.view') or has_permission('users.view'));
