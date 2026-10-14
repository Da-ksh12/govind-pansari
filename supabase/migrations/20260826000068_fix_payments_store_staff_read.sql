-- payments_owner_read only allowed the order's own customer or
-- is_admin() (super_admin only, post-041's redefinition) to read a
-- payments row. Store staff processing an order at their own store
-- had no way to see the real payment method/status at all — RLS
-- silently returned an empty embedded array (not an error), so
-- StoreOrderDetail's payments(method) embed always fell back to its
-- 'cod' default, showing every order as COD regardless of how it was
-- actually paid. Found via live testing while auditing an unrelated
-- crash report.
drop policy if exists "payments_owner_read" on payments;

create policy "payments_owner_read"
  on payments for select
  using (
    exists (
      select 1 from orders
      where orders.id = payments.order_id
        and (orders.user_id = auth.uid() or is_store_staff(orders.store_id) or is_admin())
    )
  );
