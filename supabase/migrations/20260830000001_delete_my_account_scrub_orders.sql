-- Account deletion (Google Play "Account deletion" + App Store 5.1.1(v)). Replaces delete_my_account() from 20260827000001.
--
-- What changed from v1: v1 left every past order's delivery_address snapshot untouched, which still held the customer's recipient
-- name, phone number, street address and exact map position after the account was "deleted". An order must stay (it is a sales and tax
-- record), but the personal part of it does not. This version keeps only city / state / pincode on each old order, and also removes the
-- customer's product reviews (public text written under their name).
--
-- Kept on purpose (records the business must hold for tax and consumer-protection law): the orders themselves (number, date, items,
-- amounts, payment method and status, the store, the delivery photo taken at the door), and the profile row, which is anonymized
-- rather than dropped because orders and payments point at it. The sign-in itself (auth user) is soft-deleted by the `delete-account`
-- Edge Function right after this returns: its phone and email are released, so the same number can register again as a new customer.
--
-- Safe to run again: a second call changes nothing further.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- Staff/rider/admin accounts are managed by an admin, never self-deleted.
  if current_profile_role() <> 'customer' then
    raise exception 'staff_account_not_self_deletable' using errcode = '42501';
  end if;
  -- An order that is still on its way needs the delivery address; once it is delivered or cancelled the account can go.
  if exists (select 1 from orders where user_id = v_uid and status not in ('delivered', 'cancelled')) then
    raise exception 'active_orders_pending' using errcode = '23514';
  end if;

  delete from user_devices where user_id = v_uid;
  delete from notifications where user_id = v_uid;          -- cascades notification_deliveries
  delete from notification_preferences where user_id = v_uid;
  delete from wishlists where user_id = v_uid;               -- cascades wishlist_items
  delete from carts where user_id = v_uid;                   -- cascades cart_items
  delete from reviews where user_id = v_uid;
  delete from addresses where user_id = v_uid;               -- orders.address_id is on delete set null

  -- Old orders keep what accounting needs (where, roughly) and lose who and exactly where.
  update orders
     set delivery_address = jsonb_strip_nulls(jsonb_build_object(
           'city', delivery_address -> 'city',
           'state', delivery_address -> 'state',
           'postal_code', delivery_address -> 'postal_code',
           'pincode', delivery_address -> 'pincode',
           'personal_details_removed', true
         ))
   where user_id = v_uid;

  update profiles
     set full_name = 'Deleted user', phone = null, email = null, avatar_url = null, is_active = false
   where id = v_uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
