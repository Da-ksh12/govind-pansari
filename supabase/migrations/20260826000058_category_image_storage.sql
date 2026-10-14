-- Category images (Part 3) reuse the same product-images bucket rather
-- than a second bucket for a handful of category photos — but the
-- write policies from 20260826000056 only checked products.create/
-- products.edit, which would wrongly block a hypothetical admin
-- scoped to categories.manage alone. Replace those policies to accept
-- either.
drop policy if exists "product_images_admin_write" on storage.objects;
drop policy if exists "product_images_admin_update" on storage.objects;
drop policy if exists "product_images_admin_delete" on storage.objects;

create policy "product_images_admin_write" on storage.objects
  for insert with check (
    bucket_id = 'product-images'
    and (has_permission('products.create') or has_permission('products.edit') or has_permission('categories.manage'))
  );

create policy "product_images_admin_update" on storage.objects
  for update using (
    bucket_id = 'product-images'
    and (has_permission('products.create') or has_permission('products.edit') or has_permission('categories.manage'))
  );

create policy "product_images_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'product-images'
    and (has_permission('products.create') or has_permission('products.edit') or has_permission('categories.manage'))
  );
