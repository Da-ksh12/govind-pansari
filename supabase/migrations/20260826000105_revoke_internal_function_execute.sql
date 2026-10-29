-- Internal SECURITY DEFINER functions were still executable by PUBLIC (the
-- Postgres default), so any anon/authenticated client could call them over
-- /rest/v1/rpc. pg_cron (postgres) and trigger/definer callers are unaffected.
revoke all on function expire_stale_dispatch_rounds() from public, anon, authenticated;
revoke all on function retry_auto_assignment_rounds() from public, anon, authenticated;
revoke all on function admin_recipient_ids() from public, anon, authenticated;
revoke all on function notify_on_order_created() from public, anon, authenticated;
revoke all on function notify_on_order_status_change() from public, anon, authenticated;
revoke all on function notify_on_delivery_event() from public, anon, authenticated;
revoke all on function sync_profile_phone() from public, anon, authenticated;
