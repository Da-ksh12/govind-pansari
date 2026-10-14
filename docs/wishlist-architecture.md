# Wishlist Architecture

## Granularity: product, not variant (section 26)

Wishlist references `product_id`, matching Phase 01's schema
(`wishlist_items.product_id`) and the pre-existing frontend
`WishlistItem` type — a customer saves "Premium Cashews", not
specifically "Premium Cashews, 500g". This was already the established
architecture from Phase 01/02, not a new decision made in this phase;
kept as-is per the brief's "inspect before deciding" instruction.

## No new database functions (unlike cart)

Deliberately — toggle/add/remove is a trivial, unvalidated operation
fully covered by Phase 01's `wishlist_items_owner_all` RLS policy and
its `unique(wishlist_id, product_id)` constraint (which already
prevents duplicates: a second insert of the same product hits the
constraint and is treated as a no-op by `wishlistRepository.add()`,
not surfaced as an error). Adding a `SECURITY DEFINER` function here
would be exactly the "database function for every trivial operation"
the brief says not to build — there's no price/inventory/availability
validation question for "did the customer favorite this," unlike cart
quantities.

## Data flow

```
components/product/ProductCard.tsx  ─┐
app/product/[slug].tsx              ─┼─→ store/wishlistStore.ts (toggle/remove,
app/wishlist.tsx                    ─┘    optimistic + rollback, same pattern as cartStore)
                                                │
                                     services/repositories/wishlistRepository.ts
                                                │
                                  wishlists / wishlist_items (Phase 01, RLS unchanged)
```

`wishlistRepository.list()` returns full, enriched `Product[]` objects
(current price, MRP, rating, images — reusing `productRepository`, not
a second product-shaping path), not raw `wishlist_item` rows — so
`app/wishlist.tsx` can render exactly the same `ProductCard` used
everywhere else, satisfying section 27's "current price, MRP,
discount, availability" without a bespoke wishlist card.

## Optimistic UI + rollback (same pattern as cart)

`wishlistStore.toggle()` flips the heart icon immediately, then syncs
in the background; on failure it reverts and shows a toast. This is
why the heart in `ProductCard`/Product Detail responds instantly with
no loading state, matching section 29's "toggle instantly."

## Wishlist → Cart (section 28)

No special-cased "move" operation — `app/wishlist.tsx` renders the
same `ProductCard`/`AddToCartControl` used on Home/Search/Category, so
adding to cart from the wishlist calls the exact same
`cartStore.addItem()` path as everywhere else. Default behavior is to
**keep** the item in the wishlist after adding to cart (nothing removes
it), matching the brief's explicit default.

## Logout / account switching

Same shape as cart: `authStore.logout()` calls
`wishlistStore.clearLocal()` (local-only, the server-side wishlist is
untouched), and the auth-state listener calls
`wishlistStore.loadWishlist()` once per new sign-in. Verified live
across two separate login sessions (see test 19 in
`supabase/tests/phase04-cart-wishlist.test.mjs`).

## RLS (unchanged from Phase 01, re-verified this phase)

`wishlists`/`wishlist_items` are owner-only via the same join-based
policy pattern as `carts`/`cart_items`. Verified live with a *second
real authenticated user* (not just an anonymous request): the rider
account gets an empty result querying the customer's wishlist — the
row isn't merely inaccessible, RLS makes it not exist for them at all.
