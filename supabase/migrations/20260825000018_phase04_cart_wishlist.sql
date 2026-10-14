-- Phase 04 (Cart + Wishlist): server-validated cart mutations.
--
-- Wishlist gets no new functions — toggle/remove is a trivial,
-- unvalidated operation already fully covered by Phase 01's
-- wishlist_items_owner_all RLS policy + its unique(wishlist_id,
-- product_id) constraint (which already prevents duplicates). Adding
-- a function there would be exactly the "database function for every
-- trivial operation" this phase says not to build.
--
-- Cart is different: adding/changing quantity needs to validate the
-- variant/product are still active (section 6) and enforce a quantity
-- ceiling, atomically, without a client read-then-write race (sections
-- 7, 9, 21). So cart_items write access moves from direct RLS-mediated
-- table access to these three functions, matching the same pattern
-- checkout()/orders used in Phase 01.

-- Documented, not a magic number: 20 units of a single variant is
-- already well beyond normal hyperlocal-quick-commerce basket size for
-- a dry-fruits/spices retailer — a ceiling to catch fat-finger/bot
-- input, not a real business constraint. Revisit if the catalogue
-- later includes something bought in bulk.
create or replace function max_cart_item_quantity() returns int
language sql immutable as $$ select 20 $$;

-- ---------------------------------------------------------------------
-- add_to_cart: creates the item if new, or atomically increments an
-- existing line's quantity (never a second row for the same variant —
-- the ON CONFLICT target is the same unique(cart_id, variant_id)
-- constraint from Phase 01). price_snapshot is set only on first
-- insert, deliberately never touched on increment — see
-- docs/cart-architecture.md for why (it's a display-only "price when
-- you added this" reference; checkout() already never trusts it).
-- ---------------------------------------------------------------------

create or replace function add_to_cart(p_variant_id uuid, p_quantity int default 1)
returns cart_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_cart_id uuid;
  v_price numeric(10, 2);
  v_result cart_items;
begin
  if v_user_id is null then
    raise exception 'add_to_cart requires an authenticated user';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'quantity must be at least 1';
  end if;
  if p_quantity > max_cart_item_quantity() then
    raise exception 'quantity exceeds the maximum of % per item', max_cart_item_quantity();
  end if;

  select pv.price into v_price
  from product_variants pv
  join products p on p.id = pv.product_id
  where pv.id = p_variant_id and pv.is_active and p.is_active;

  if v_price is null then
    raise exception 'this product is currently unavailable';
  end if;

  insert into carts (user_id) values (v_user_id)
    on conflict (user_id) do nothing;
  select id into v_cart_id from carts where user_id = v_user_id;

  insert into cart_items (cart_id, product_variant_id, quantity, price_snapshot)
  values (v_cart_id, p_variant_id, p_quantity, v_price)
  on conflict (cart_id, product_variant_id) do update
    set quantity = least(cart_items.quantity + excluded.quantity, max_cart_item_quantity()),
        updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

revoke execute on function add_to_cart(uuid, int) from anon;
grant execute on function add_to_cart(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- set_cart_item_quantity: absolute set on an existing line (0 removes
-- it). Deliberately does not re-validate variant/product availability
-- the way add_to_cart does — you can always reduce or remove a line
-- regardless of whether the product is still active, but expressing
-- *new* intent to buy (add_to_cart) is where that check belongs.
-- ---------------------------------------------------------------------

create or replace function set_cart_item_quantity(p_variant_id uuid, p_quantity int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_cart_id uuid;
begin
  if v_user_id is null then
    raise exception 'set_cart_item_quantity requires an authenticated user';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'quantity cannot be negative';
  end if;
  if p_quantity > max_cart_item_quantity() then
    raise exception 'quantity exceeds the maximum of % per item', max_cart_item_quantity();
  end if;

  select id into v_cart_id from carts where user_id = v_user_id;
  if v_cart_id is null then
    raise exception 'cart is empty';
  end if;

  if p_quantity = 0 then
    delete from cart_items where cart_id = v_cart_id and product_variant_id = p_variant_id;
  else
    update cart_items set quantity = p_quantity, updated_at = now()
      where cart_id = v_cart_id and product_variant_id = p_variant_id;
    if not found then
      raise exception 'this item is not in your cart';
    end if;
  end if;
end;
$$;

revoke execute on function set_cart_item_quantity(uuid, int) from anon;
grant execute on function set_cart_item_quantity(uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- remove_cart_item: thin, explicit wrapper (equivalent to
-- set_cart_item_quantity(variant, 0)) — kept as its own function since
-- "remove" is a distinct, named operation in the brief and reads more
-- clearly from the client than "set to zero".
-- ---------------------------------------------------------------------

create or replace function remove_cart_item(p_variant_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  select set_cart_item_quantity(p_variant_id, 0);
$$;

revoke execute on function remove_cart_item(uuid) from anon;
grant execute on function remove_cart_item(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Narrow cart_items to read-only for direct client access — all
-- mutation goes through the three functions above (which run as their
-- owner, so they're unaffected by this). Matches section 43: the
-- client sends variant id + quantity, the server validates/owns
-- everything else.
-- ---------------------------------------------------------------------

drop policy "cart_items_owner_all" on cart_items;

create policy "cart_items_owner_read"
  on cart_items for select
  using (exists (select 1 from carts where carts.id = cart_items.cart_id and carts.user_id = auth.uid()));
