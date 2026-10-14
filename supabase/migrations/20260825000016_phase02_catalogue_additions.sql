-- Phase 02 (Product & Catalogue Backend): small, additive schema
-- support for things the approved frontend design already needs but
-- Phase 01 didn't model — none of this touches existing columns/rows,
-- all additive.

-- ---------------------------------------------------------------------
-- 1. Product tags — backs the "Shop by Need" rails (Healthy Snacking,
-- Protein Rich, Immunity, Gifting, ...) that both the Home screen and
-- app/needs/[slug].tsx already call productRepository.listByTag() for.
-- Plain text[] + GIN, not a join table: the tag vocabulary is small and
-- editorial (curated by whoever manages the catalogue), not a normalized
-- entity with its own attributes.
-- ---------------------------------------------------------------------

alter table products add column tags text[] not null default '{}';
create index products_tags_idx on products using gin (tags);

-- ---------------------------------------------------------------------
-- 2. Search. Catalogue is small for now (production-grade, but not yet
-- production-scale) — trigram indexes on Postgres are plenty per
-- docs/backend-architecture.md's "upgrade later if needed" principle
-- from Phase 01. Covers name (primary signal) and short_description.
-- ---------------------------------------------------------------------

create extension if not exists pg_trgm;

create index products_name_trgm_idx on products using gin (name gin_trgm_ops);
create index products_short_description_trgm_idx on products using gin (short_description gin_trgm_ops);

-- ---------------------------------------------------------------------
-- 3. Banner presentation fields the HeroCarousel component already
-- renders (theme for light/dark text-on-image, eyebrow label) plus a
-- raw target_url for banners that don't point at a product/category
-- (e.g. "Build Your Own Box" -> /build-your-box, which is a route, not
-- a catalogue entity).
-- ---------------------------------------------------------------------

alter table banners add column theme text not null default 'dark' check (theme in ('dark', 'light'));
alter table banners add column eyebrow text;
alter table banners add column target_url text;

-- ---------------------------------------------------------------------
-- 4. Rating aggregation. Products/ProductCard need `rating` +
-- `reviewCount`; reviews are individual rows. A view over the existing
-- (already public-read for status='published') reviews table, rather
-- than a denormalized column on products that could drift out of sync.
-- ---------------------------------------------------------------------

create view product_ratings as
select
  product_id,
  round(avg(rating)::numeric, 2) as rating,
  count(*) as review_count
from reviews
where status = 'published'
group by product_id;

grant select on product_ratings to anon, authenticated;
