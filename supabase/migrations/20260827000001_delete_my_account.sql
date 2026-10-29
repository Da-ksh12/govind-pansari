-- App Store guideline 5.1.1(v): in-app account deletion.
-- Orders/payments keep a NOT NULL FK to profiles, so the profile row is
-- anonymized (not dropped) and the auth user is soft-deleted by the
-- `delete-account` Edge Function. Order snapshots (orders.delivery_address)
-- are retained for accounting; addresses/cart/wishlist/devices/notifications
-- are removed here.

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
  if exists (select 1 from orders where user_id = v_uid and status not in ('delivered', 'cancelled')) then
    raise exception 'active_orders_pending' using errcode = '23514';
  end if;

  delete from user_devices where user_id = v_uid;
  delete from notifications where user_id = v_uid;
  delete from notification_preferences where user_id = v_uid;
  delete from wishlists where user_id = v_uid;   -- cascades wishlist_items
  delete from carts where user_id = v_uid;       -- cascades cart_items
  delete from addresses where user_id = v_uid;   -- orders.address_id is on delete set null

  update profiles
     set full_name = 'Deleted user', phone = null, email = null, avatar_url = null, is_active = false
   where id = v_uid;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
