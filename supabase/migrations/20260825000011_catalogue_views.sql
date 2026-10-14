-- Client-facing views that re-derive just enough from restricted tables
-- (inventory) to power the storefront, without widening RLS on the
-- underlying table itself.
--
-- Views run with the *caller's* privileges by default in Postgres 15+
-- (security_invoker). We explicitly want the opposite here — the view
-- needs to read `inventory` (staff/admin-only) on behalf of any
-- customer — so security_invoker is left off (the default,
-- definer-style behaviour: the view runs as its owner).

create view product_availability
with (security_invoker = false)
as
select
  i.product_variant_id,
  i.store_id,
  case
    when not i.is_available or (i.quantity - i.reserved_quantity) <= 0 then 'out_of_stock'
    when (i.quantity - i.reserved_quantity) <= i.reorder_level then 'low_stock'
    else 'in_stock'
  end::stock_status as stock_status
from inventory i;

comment on view product_availability is 'Public-safe projection of inventory: stock_status only, never raw quantity/reserved_quantity. Grant select to anon/authenticated, not the base table.';

grant select on product_availability to anon, authenticated;

-- Convenience view for "is this product deliverable to this store at
-- all", independent of current stock — i.e. does a variant have any
-- inventory row for the store.
create view store_product_catalogue
with (security_invoker = false)
as
select
  pv.id as product_variant_id,
  pv.product_id,
  i.store_id,
  pv.is_active and i.is_available as is_orderable
from product_variants pv
join inventory i on i.product_variant_id = pv.id;

grant select on store_product_catalogue to anon, authenticated;
