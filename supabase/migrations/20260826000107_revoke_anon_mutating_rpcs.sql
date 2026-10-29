-- QA-005: these SECURITY DEFINER RPCs compare ownership with auth.uid(). For an
-- unauthenticated caller auth.uid() is NULL, so `owner <> NULL` is NULL (not true)
-- and the "not authorized" branch never fires. Verified: anon could cancel any order
-- and flip any address's default flag by UUID. Only signed-in users may call them.
revoke all on function public.update_order_status(uuid, order_status, text) from public, anon;
grant execute on function public.update_order_status(uuid, order_status, text) to authenticated;
revoke all on function public.set_default_address(uuid) from public, anon;
grant execute on function public.set_default_address(uuid) to authenticated;
