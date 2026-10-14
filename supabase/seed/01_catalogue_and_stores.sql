-- DEVELOPMENT seed data. Not a migration — do not add this file to
-- supabase/migrations. Run it manually against a dev/staging project
-- (`psql "$SUPABASE_DB_URL" -f supabase/seed/01_catalogue_and_stores.sql`,
-- or paste into the SQL editor) after migrations have been applied.
--
-- All store coordinates below are approximate, placeholder positions
-- near known Agra localities (Sanjay Place, Vijay Nagar, Awas Vikas) —
-- NOT verified real outlet coordinates. Replace with the real
-- lat/lng for each outlet before this ever touches production.
-- Delivery zone boundaries are simple 4km circles around each store,
-- a placeholder shape until the business supplies real serviceable-area
-- boundaries.

begin;

-- ---------------------------------------------------------------------
-- Stores
-- ---------------------------------------------------------------------

insert into stores (id, name, code, address_line, city, latitude, longitude, phone, opening_time, closing_time, is_active, is_accepting_orders)
values
  ('00000000-0000-0000-0000-000000000101', 'Govind Pansari — Sanjay Place', 'GP-SNP', 'Sanjay Place, Agra', 'Agra', 27.1990, 78.0064, '+91 90000 00101', '09:00', '21:00', true, true),
  ('00000000-0000-0000-0000-000000000102', 'Govind Pansari — Vijay Nagar', 'GP-VJN', 'Vijay Nagar Colony, Agra', 'Agra', 27.2040, 77.9950, '+91 90000 00102', '09:00', '21:00', true, true),
  ('00000000-0000-0000-0000-000000000103', 'Govind Pansari — Awas Vikas', 'GP-AWV', 'Awas Vikas Colony, Agra', 'Agra', 27.2100, 78.0250, '+91 90000 00103', '09:00', '21:00', true, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Delivery zones — one ~4km demo circle per store, that store as its
-- sole (priority 0) server.
-- ---------------------------------------------------------------------

insert into delivery_zones (id, name, boundary, is_active, delivery_fee, minimum_order_value, estimated_delivery_minutes)
select z.zone_id, s.name || ' service area', ST_Multi(ST_Buffer(s.geog, 4000)::geometry)::geography(multipolygon, 4326), true, 49, 299, 35
from stores s
join (values
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000221'::uuid),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000222'::uuid),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000223'::uuid)
) as z(store_id, zone_id) on z.store_id = s.id
on conflict (id) do nothing;

insert into store_delivery_zones (store_id, delivery_zone_id, priority)
values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000221', 0),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000222', 0),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000223', 0)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------

insert into categories (id, name, slug, description, sort_order) values
  ('00000000-0000-0000-0000-000000000201', 'Dry Fruits', 'dry-fruits', 'Premium, handpicked dry fruits.', 1),
  ('00000000-0000-0000-0000-000000000202', 'Spices & Masalas', 'spices-masalas', 'Everyday and festive spice blends.', 2),
  ('00000000-0000-0000-0000-000000000203', 'Healthy Foods', 'healthy-foods', 'Seeds, makhana and healthy snacking.', 3),
  ('00000000-0000-0000-0000-000000000204', 'Tea', 'tea', 'Loose leaf and premium tea.', 4),
  ('00000000-0000-0000-0000-000000000205', 'Gift Hampers', 'gift-hampers', 'Curated gifting collections.', 5)
on conflict (id) do nothing;

insert into categories (id, parent_id, name, slug, sort_order) values
  ('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000201', 'Almonds', 'almonds', 1),
  ('00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-000000000201', 'Cashews', 'cashews', 2),
  ('00000000-0000-0000-0000-000000000213', '00000000-0000-0000-0000-000000000201', 'Pistachios', 'pistachios', 3),
  ('00000000-0000-0000-0000-000000000214', '00000000-0000-0000-0000-000000000201', 'Walnuts', 'walnuts', 4),
  ('00000000-0000-0000-0000-000000000215', '00000000-0000-0000-0000-000000000201', 'Raisins', 'raisins', 5),
  ('00000000-0000-0000-0000-000000000216', '00000000-0000-0000-0000-000000000201', 'Dates', 'dates', 6),
  ('00000000-0000-0000-0000-000000000217', '00000000-0000-0000-0000-000000000203', 'Makhana', 'makhana', 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Products + variants
-- ---------------------------------------------------------------------

insert into products (id, category_id, name, slug, short_description, is_active, is_featured, is_bestseller) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000211', 'Premium California Almonds', 'premium-california-almonds', 'Jumbo, rich in nutrition', true, true, true),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000212', 'Premium Whole Cashews', 'premium-whole-cashews', 'Crunchy, whole, naturally rich', true, true, true),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000213', 'Roasted & Salted Pistachios', 'roasted-salted-pistachios', 'Roasted & salted', true, false, true),
  ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000214', 'Premium Walnut Kernels', 'premium-walnut-kernels', 'Rich in Omega-3', true, false, false),
  ('00000000-0000-0000-0000-000000000305', '00000000-0000-0000-0000-000000000215', 'Golden Raisins', 'golden-raisins', 'Naturally sweet', true, false, false),
  ('00000000-0000-0000-0000-000000000306', '00000000-0000-0000-0000-000000000216', 'Medjool Dates', 'medjool-dates', 'Soft, caramel-sweet', true, false, false),
  ('00000000-0000-0000-0000-000000000307', '00000000-0000-0000-0000-000000000217', 'Roasted Makhana', 'roasted-makhana', 'Lightly roasted fox nuts', true, false, false)
on conflict (id) do nothing;

insert into product_variants (id, product_id, sku, weight_value, weight_unit, price, mrp, is_active) values
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000301', 'GP-ALM-100', 100, 'g', 199, 229, true),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000301', 'GP-ALM-250', 250, 'g', 449, 549, true),
  ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000301', 'GP-ALM-500', 500, 'g', 849, 999, true),
  ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000302', 'GP-CSH-250', 250, 'g', 499, 599, true),
  ('00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000302', 'GP-CSH-500', 500, 'g', 949, 1149, true),
  ('00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-000000000303', 'GP-PIS-250', 250, 'g', 599, 699, true),
  ('00000000-0000-0000-0000-000000000431', '00000000-0000-0000-0000-000000000304', 'GP-WAL-250', 250, 'g', 549, 649, true),
  ('00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000305', 'GP-RAI-250', 250, 'g', 199, 229, true),
  ('00000000-0000-0000-0000-000000000451', '00000000-0000-0000-0000-000000000306', 'GP-DAT-250', 250, 'g', 349, 399, true),
  ('00000000-0000-0000-0000-000000000461', '00000000-0000-0000-0000-000000000307', 'GP-MAK-100', 100, 'g', 149, 179, true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Inventory — deliberately uneven across stores, so "out of stock at
-- store B, available at store C" is demonstrable out of the box.
-- ---------------------------------------------------------------------

insert into inventory (store_id, product_variant_id, quantity, reserved_quantity, reorder_level)
select s.id, pv.id, v.qty, 0, 5
from stores s
cross join product_variants pv
join (values
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000401'::uuid, 40),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000402'::uuid, 35),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000403'::uuid, 20),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000411'::uuid, 30),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000412'::uuid, 15),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000421'::uuid, 25),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000431'::uuid, 18),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000441'::uuid, 50),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000451'::uuid, 22),
  ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000461'::uuid, 3),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000401'::uuid, 12),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000402'::uuid, 0),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000411'::uuid, 40),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000421'::uuid, 0),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000441'::uuid, 28),
  ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000461'::uuid, 30),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000401'::uuid, 60),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000403'::uuid, 15),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000412'::uuid, 20),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000431'::uuid, 25),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000451'::uuid, 40),
  ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000461'::uuid, 12)
) as v(store_id, variant_id, qty) on v.store_id = s.id and v.variant_id = pv.id
on conflict (store_id, product_variant_id) do nothing;

-- ---------------------------------------------------------------------
-- Coupons, offers, banners
-- ---------------------------------------------------------------------

insert into coupons (code, description, discount_type, discount_value, max_discount, min_order_value, expires_at, usage_limit, per_user_limit) values
  ('GP15', 'Get 15% off up to Rs.300', 'percent', 15, 300, 999, now() + interval '90 days', 1000, 1),
  ('WELCOME50', 'Rs.50 off on your first order', 'flat', 50, null, 299, now() + interval '90 days', null, 1)
on conflict (code) do nothing;

insert into banners (title, subtitle, image_url, cta_label, target_type, sort_order) values
  ('Premium Almonds', 'Naturally rich. Carefully selected.', 'https://images.unsplash.com/photo-1430163393927-3dab9af7ea38', 'Shop Almonds', 'category', 1),
  ('Build Your Own Dry Fruit Box', 'Pick your favourites & create a perfect box', 'https://images.unsplash.com/photo-1633536705550-c06044327482', 'Build Now', 'url', 2);

insert into offers (title, subtitle, image_url, category, sort_order) values
  ('First Order Offer', 'Flat Rs.50 off with WELCOME50', 'https://images.unsplash.com/photo-1525790428446-ad5140bdd234', 'first_order', 1),
  ('Free Delivery Weekend', 'On orders above Rs.499', 'https://plus.unsplash.com/premium_photo-1664475726646-9a5469b728b7', 'free_delivery', 2);

commit;
