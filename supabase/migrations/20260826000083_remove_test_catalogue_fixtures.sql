-- Customer-visible bug: 10 "Test Almonds xxxxx" categories, created by
-- catalogue-management.test.mjs's own live test runs over this
-- project's long history, were left is_active=true and were showing
-- up in the real customer-facing Categories screen (reported live by
-- the owner, screenshots attached) — each with a broken
-- https://example.com/img.jpg placeholder the test suite used, which
-- is why they rendered as blank gray tiles instead of falling back to
-- the nice generated image every other category (whose image_url is
-- legitimately NULL) already gets client-side.
--
-- Verified safe to fully delete, not just deactivate, before running
-- this: zero order_items, cart_items, or wishlist_items anywhere
-- reference any of these test products/variants — nothing real is at
-- risk. Deleted bottom-up to respect foreign keys.

delete from inventory_movements
  where product_variant_id in (
    select pv.id from product_variants pv join products p on p.id = pv.product_id where p.name like 'Test%'
  );

delete from inventory
  where product_variant_id in (
    select pv.id from product_variants pv join products p on p.id = pv.product_id where p.name like 'Test%'
  );

delete from product_variants
  where product_id in (select id from products where name like 'Test%');

delete from products where name like 'Test%';

delete from categories where name like 'Test%';
