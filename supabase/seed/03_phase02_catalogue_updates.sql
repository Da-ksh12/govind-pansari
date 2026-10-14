-- Phase 02 seed additions: tags on the existing catalogue (backs
-- "Shop by Need" + the Build Your Own Box screen), banner presentation
-- fields, and new products for the three categories Phase 01 created
-- but never populated (Spices & Masalas, Tea, Gift Hampers) — per
-- section 32's request for enough products to exercise every screen.
--
-- DEVELOPMENT seed data — same caveats as 01_catalogue_and_stores.sql
-- (not real business data). Run after 01_catalogue_and_stores.sql.

begin;

-- ---------------------------------------------------------------------
-- Tags on the 7 existing products
-- ---------------------------------------------------------------------

update products set tags = array['healthy-snacking', 'protein-rich', 'immunity', 'daily-essentials', 'diy-box'] where id = '00000000-0000-0000-0000-000000000301'; -- Almonds
update products set tags = array['healthy-snacking', 'protein-rich', 'gifting', 'diy-box'] where id = '00000000-0000-0000-0000-000000000302'; -- Cashews
update products set tags = array['premium-collection', 'gifting', 'diy-box'] where id = '00000000-0000-0000-0000-000000000303'; -- Pistachios
update products set tags = array['healthy-snacking', 'immunity', 'diy-box'] where id = '00000000-0000-0000-0000-000000000304'; -- Walnuts
update products set tags = array['kids', 'daily-essentials', 'diy-box'] where id = '00000000-0000-0000-0000-000000000305'; -- Raisins
update products set tags = array['healthy-snacking', 'immunity', 'daily-essentials', 'diy-box'] where id = '00000000-0000-0000-0000-000000000306'; -- Dates
update products set tags = array['healthy-snacking', 'kids', 'cooking-essentials', 'diy-box'] where id = '00000000-0000-0000-0000-000000000307'; -- Makhana

-- ---------------------------------------------------------------------
-- Banner presentation fields (theme/eyebrow — columns added in
-- 20260825000016_phase02_catalogue_additions.sql)
-- ---------------------------------------------------------------------

update banners set theme = 'dark', eyebrow = 'PREMIUM' where title = 'Premium Almonds';
update banners set theme = 'dark', eyebrow = 'SIGNATURE', target_url = '/build-your-box' where title = 'Build Your Own Dry Fruit Box';

-- ---------------------------------------------------------------------
-- New products: Spices & Masalas, Tea, Gift Hampers
-- ---------------------------------------------------------------------

insert into products (id, category_id, name, slug, short_description, tags, is_active, is_featured, is_bestseller) values
  ('00000000-0000-0000-0000-000000000308', '00000000-0000-0000-0000-000000000202', 'Black Pepper', 'black-pepper', 'Whole & ground, freshly milled', array['cooking-essentials','daily-essentials'], true, false, false),
  ('00000000-0000-0000-0000-000000000309', '00000000-0000-0000-0000-000000000202', 'Green Cardamom', 'green-cardamom', 'Aromatic whole elaichi pods', array['cooking-essentials','premium-collection'], true, false, false),
  ('00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000202', 'Turmeric Powder', 'turmeric-powder', 'Pure, unadulterated haldi', array['cooking-essentials','daily-essentials'], true, false, true),
  ('00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000204', 'Darjeeling Loose Leaf Tea', 'darjeeling-loose-leaf-tea', 'Premium first-flush leaves', array['daily-essentials','gifting'], true, true, false),
  ('00000000-0000-0000-0000-000000000312', '00000000-0000-0000-0000-000000000205', 'Premium Dry Fruit Gift Hamper', 'premium-dry-fruit-gift-hamper', 'A curated assortment for gifting', array['gifting','premium-collection'], true, true, true)
on conflict (id) do nothing;

insert into product_variants (id, product_id, sku, weight_value, weight_unit, price, mrp, is_active) values
  ('00000000-0000-0000-0000-000000000471', '00000000-0000-0000-0000-000000000308', 'GP-PEP-100', 100, 'g', 219, 249, true),
  ('00000000-0000-0000-0000-000000000472', '00000000-0000-0000-0000-000000000309', 'GP-CAR-50', 50, 'g', 349, 399, true),
  ('00000000-0000-0000-0000-000000000473', '00000000-0000-0000-0000-000000000310', 'GP-TUR-200', 200, 'g', 129, 149, true),
  ('00000000-0000-0000-0000-000000000474', '00000000-0000-0000-0000-000000000311', 'GP-TEA-100', 100, 'g', 249, 299, true),
  ('00000000-0000-0000-0000-000000000475', '00000000-0000-0000-0000-000000000312', 'GP-HMP-500', 500, 'g', 849, 999, true)
on conflict (id) do nothing;

insert into inventory (store_id, product_variant_id, quantity, reserved_quantity, reorder_level)
select v.store_id, v.variant_id, v.qty, 0, 5
from (values
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000471'::uuid, 30),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000471'::uuid, 18),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000471'::uuid, 25),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000472'::uuid, 15),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000472'::uuid, 0),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000472'::uuid, 10),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000473'::uuid, 40),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000473'::uuid, 35),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000473'::uuid, 20),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000474'::uuid, 22),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000474'::uuid, 12),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000475'::uuid, 10),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000475'::uuid, 8),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000475'::uuid, 6)
) as v(store_id, variant_id, qty)
on conflict (store_id, product_variant_id) do nothing;

commit;
