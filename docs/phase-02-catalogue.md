# Phase 02 — Product & Catalogue Backend

Connects the mobile app's existing repository layer to the real
Supabase schema from Phase 01. No UI/navigation/visual changes — this
phase only replaces what's behind `services/repositories/*`.

## Architecture

```
UI (screens/components)
      │  (unchanged)
useAsync() / useCartLines()
      │
services/repositories/*Repository.ts   ← same method names as the old mock repos
      │
services/supabase/mappers.ts           ← DB row -> types/models.ts, in one place
      │
services/supabase/client.ts            ← the one Supabase client instance
      │
Supabase (PostgREST + RLS, from Phase 01)
```

`services/supabase/productCache.ts` is the one addition that doesn't
fit that straight line: `useCartLines()` and the wishlist screen need
synchronous product/variant lookups by id, which a Supabase-backed
repository can't provide (everything is async now). The cache is
populated as a side effect of every `productRepository` fetch — see
its file comment for why this is safe (a customer can only reference a
product by id, from cart or wishlist, after having already seen and
fetched it somewhere).

## What changed

**New:**
- `services/supabase/{client,mappers,errors,productCache}.ts`
- `services/repositories/{bannerRepository,offerRepository,searchRepository}.ts`
- `types/supabase.ts` (hand-maintained row shapes — narrower than
  `supabase gen types`, so mappers.ts stays honest about exactly what's
  selected)
- `supabase/migrations/20260825000016_phase02_catalogue_additions.sql`
  — additive only: `products.tags`, trigram search indexes, banner
  `theme`/`eyebrow`/`target_url`, the `product_ratings` view
- `supabase/tests/phase02-catalogue.test.mjs` — live integration suite
- `.env` (git-ignored) with this project's client-safe URL/anon key

**Rewritten** (same exported method names/signatures — screens didn't need to change):
- `productRepository`, `categoryRepository`, `storeRepository`, `reviewRepository`

**Fixed** (found while inspecting — see "Problems discovered" below):
- `hooks/useCartLines.ts` — pointed at the static mock product index
- `app/wishlist.tsx` — same
- `app/build-your-box.tsx` — hardcoded a list of mock product ids;
  now pulls products tagged `diy-box` instead
- `app/(tabs)/index.tsx`, `app/offers.tsx`, `app/(tabs)/search.tsx`,
  `app/(tabs)/categories.tsx` — imported mock arrays directly, bypassing
  the repository layer entirely

**Explicitly left alone** (out of Phase 02 scope): `app/order/[id].tsx`,
`components/order/OrderCard.tsx`, and the mock order data they read —
orders are Phase 03+. They'll need the same treatment once real orders
exist.

## Store-aware availability

Every catalogue method takes an optional `storeId`. When given, each
variant's `stockStatus` comes from the `product_availability` view
(Phase 01) scoped to that store — not a global stock flag. When
omitted, `Product.availableInArea` defaults to `true` rather than
asserting unavailability (section 12: don't make a false claim either
way).

**Not wired up**: no screen currently passes a `storeId` — there's no
"current fulfilling store" concept in app state yet
(`store/locationStore.ts` only tracks the customer's chosen
coordinates, not a resolved store). Wiring that through is explicitly
fulfillment-phase work per the brief ("do not implement complicated
store-selection logic yet"); the capability exists and is tested
(`storeRepository.findNearest` already calls the real
`find_serviceable_stores()` RPC from Phase 01), it's just not threaded
through the UI yet.

## Search

`name`/`short_description` via `ilike`, backed by `pg_trgm` GIN
indexes (added in this phase's migration). Sufficient at the current
catalogue size per Phase 01's "upgrade later if needed" principle.

## Sorting

`featured` (is_featured desc, sort_order), `newest` (created_at desc),
`bestseller` (is_bestseller desc), `price_low_to_high`/
`price_high_to_low`. The two price sorts are the one known gap:
price lives on `product_variants` (one-to-many with products), which
PostgREST can't order a top-level `products` query by directly, so
they're sorted **client-side after fetch** — correct at the current
catalogue size (one page covers everything) but not globally-correct
pagination once the catalogue is large enough to need multiple pages
of price-sorted results. Fix, if/when needed: a `product_min_price`
view + a two-step (get sorted ids, then fetch by id) query, same
pattern already used for banner deep-link resolution.

## Pagination

`productRepository.list(options)` returns `{ items, total, page,
pageSize, hasMore }` using PostgREST `Range`/`Prefer: count=exact`
(verified — see test 8). The narrower existing methods
(`listBestsellers`, `listByCategory`, ...) call it internally with a
capped `pageSize` and return just `.items`, so existing screens keep
working unchanged; none of them have infinite-scroll UI yet, so a full
paginated experience is available for a screen to adopt without a new
query path being needed.

## Badges — derived, not stored

`Product.badges` (`bestseller` / `premium` / `new` / `organic` /
`limited`) has no matching set of DB columns — only `is_featured`/
`is_bestseller` exist. Derived in `mappers.ts`: `is_bestseller` →
`bestseller`, `is_featured` → `premium`, `created_at` within 30 days →
`new`. `organic`/`limited` have no backing signal and simply never
appear for real products — this is functionally load-bearing, not just
decorative: `app/category/[slug].tsx`'s Bestsellers/Premium/New tabs
filter on `badges.includes(...)`.

## Discount

Computed (`services/supabase/mappers.ts` → `discountPercentage`), never
stored — deriving from `price`/`mrp` on read is safer than a column
that could drift out of sync with them.

## "Shop by Need" tags

`products.tags text[]` (added this phase) backs both the Home screen's
tag rails and `app/needs/[slug].tsx`. The tag *labels/icons* shown in
the UI (`needTags` — "Healthy Snacking", its icon, its own image) are
still static frontend data: there's no catalogue entity for a
"need" itself, only the matching product tags. Found and fixed a
latent bug along the way: the old mock product tags (`'snacking'`,
`'protein'`) didn't actually match the tag slugs the Home/Needs screens
queried by (`'healthy-snacking'`, `'protein-rich'`) — so "Healthy
Picks" was silently always empty. The real seed data tags now use the
same vocabulary the screens query with.

## What Phase 02 deliberately does not do

Per the brief: no checkout, payment, order creation, inventory
reservation, rider tracking, or admin dashboard. `storeRepository`,
`productRepository`, etc. are read-only from the client's perspective —
every write path from Phase 01 (`checkout()`, inventory
reservation/adjustment, ...) remains untouched and still requires the
`authenticated` role + its own business-logic function, never a raw
table write.
