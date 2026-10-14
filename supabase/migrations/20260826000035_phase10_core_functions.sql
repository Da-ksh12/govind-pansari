-- Phase 10: NotificationService core. create_notification() is the one
-- function every event trigger (next migration) calls — it owns
-- idempotency, the promotional-preference gate, and fan-out to the
-- push/in_app delivery rows. Nothing else inserts into `notifications`
-- directly.

create or replace function create_notification(
  p_recipient_id uuid,
  p_event_type notification_event_type,
  p_category notification_type,
  p_title text,
  p_body text,
  p_data jsonb default '{}'::jsonb,
  p_priority notification_priority default 'normal',
  p_source_table text default null,
  p_source_id uuid default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notification_id uuid;
  v_promotions_enabled boolean;
begin
  if p_recipient_id is null then
    return null;
  end if;

  -- Idempotency (section 14/47/51): a NULL source_id (e.g. a future
  -- admin broadcast tool with no backing event row) skips dedup
  -- entirely — there's nothing to key it on, and it isn't produced by
  -- a re-processable event anyway.
  if p_source_table is not null and p_source_id is not null then
    insert into notification_dedupe (source_table, source_id, recipient_id, event_type)
    values (p_source_table, p_source_id, p_recipient_id, p_event_type)
    on conflict do nothing;
    if not found then
      return null;
    end if;
  end if;

  -- Transactional categories always send (section 29) — only
  -- 'promotional' is ever gated by preference, and only for a customer
  -- who has explicitly opted out (default is enabled, section 30).
  if p_category = 'promotional' then
    select promotions_enabled into v_promotions_enabled
    from notification_preferences where user_id = p_recipient_id;
    if coalesce(v_promotions_enabled, true) = false then
      return null;
    end if;
  end if;

  insert into notifications (user_id, title, body, type, event_type, data, priority, source_table, source_id, expires_at)
  values (p_recipient_id, p_title, p_body, p_category, p_event_type, p_data, p_priority, p_source_table, p_source_id, p_expires_at)
  returning id into v_notification_id;

  -- in_app channel: the row itself is the delivery (Realtime is
  -- already enabled on `notifications` below) — marked delivered
  -- immediately, nothing async to track.
  insert into notification_deliveries (notification_id, user_id, channel, status, sent_at, delivered_at)
  values (v_notification_id, p_recipient_id, 'in_app', 'delivered', now(), now());

  -- push channel: one pending row per active device. Picked up
  -- asynchronously by the Edge Function on its own schedule
  -- (docs/push-notifications.md) — this function returns immediately
  -- either way, so a slow/unreachable push provider can never delay
  -- the business transaction that called it (section 17).
  insert into notification_deliveries (notification_id, user_id, device_id, channel, status)
  select v_notification_id, p_recipient_id, ud.id, 'push', 'pending'
  from user_devices ud where ud.user_id = p_recipient_id and ud.is_active;

  return v_notification_id;
end;
$$;

comment on function create_notification is 'The only path that writes `notifications` (section 8: NotificationService, not scattered UI calls). Idempotent per (source_table, source_id, recipient_id, event_type); business logic (the event triggers) never talks to a push provider directly (section 8/16).';

revoke all on function create_notification from public, anon, authenticated;
-- SECURITY DEFINER, called only from other SECURITY DEFINER trigger
-- functions (next migration) — no role needs direct EXECUTE.

-- Enable Realtime so an open notification screen/bell updates live
-- (section 9/51) without polling — same mechanism Phase 09 used for
-- rider_locations/delivery_assignments.
alter publication supabase_realtime add table notifications;

-- ---------------------------------------------------------------------
-- Recipient-resolution helpers, shared by the event triggers.
-- ---------------------------------------------------------------------

create or replace function admin_recipient_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from profiles where role = 'admin' and is_active;
$$;

create or replace function store_staff_recipient_ids(p_store_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id from store_staff where store_id = p_store_id and is_active;
$$;

comment on function admin_recipient_ids is 'Every active admin — used by the ADMIN-audience event triggers. No store scoping (admin alerts are operational, not per-store, section 26/45).';
comment on function store_staff_recipient_ids is 'A store''s active staff (all roles, not just manager) — section 45: only that store''s own people, never every store''s staff.';

-- ---------------------------------------------------------------------
-- Device token lifecycle (section 5/6/54/55/56).
-- ---------------------------------------------------------------------

create or replace function register_device_token(
  p_device_token text,
  p_platform device_platform,
  p_app_version text default null,
  p_device_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to register a device';
  end if;

  -- Identity always comes from the session (section 6: never a
  -- client-supplied user id). ON CONFLICT re-parents the row to
  -- whoever is registering now — the correct behaviour both for a
  -- refreshed token (section 54, same user) and a different account
  -- signing in on a shared device (section 56): the previous owner
  -- simply stops being able to receive pushes on this token, since it
  -- no longer points to them.
  insert into user_devices (user_id, device_token, platform, app_version, device_id, is_active, last_seen_at)
  values (auth.uid(), p_device_token, p_platform, p_app_version, p_device_id, true, now())
  on conflict (device_token) do update
    set user_id = excluded.user_id,
        platform = excluded.platform,
        app_version = excluded.app_version,
        device_id = excluded.device_id,
        is_active = true,
        last_seen_at = now(),
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function register_device_token is 'The only write path for user_devices (section 6/44) — no direct client insert/update policy exists on the table at all.';

revoke all on function register_device_token from public, anon;
grant execute on function register_device_token to authenticated;

create or replace function deactivate_device_token(p_device_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update user_devices set is_active = false, updated_at = now()
  where device_token = p_device_token and user_id = auth.uid();
$$;

comment on function deactivate_device_token is 'Called client-side just before sign-out (session still valid at call time) — deactivates only the calling device''s own token, never another device (section 56).';

revoke all on function deactivate_device_token from public, anon;
grant execute on function deactivate_device_token to authenticated;

-- ---------------------------------------------------------------------
-- In-app notification center reads (section 9/10/11/50).
-- ---------------------------------------------------------------------

create or replace function get_notifications(p_cursor timestamptz default null, p_limit int default 20)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select id, title, body, type, event_type, data, priority, read_at, created_at, expires_at
    from notifications
    where user_id = auth.uid()
      and (expires_at is null or expires_at > now())
      and (p_cursor is null or created_at < p_cursor)
    order by created_at desc
    limit least(coalesce(p_limit, 20), 50)
  ) t;
$$;

comment on function get_notifications is 'Cursor-paginated (section 50) — pass the last row''s created_at back as p_cursor for the next page. Expired notifications (expires_at) are excluded, not just visually suppressed (section 41).';

revoke all on function get_notifications from public, anon;
grant execute on function get_notifications to authenticated;

create or replace function get_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from notifications
  where user_id = auth.uid() and read_at is null and (expires_at is null or expires_at > now());
$$;

comment on function get_unread_notification_count is 'Backed by notifications_unread_idx (partial index, read_at is null) — section 10: counts, never fetches, every row.';

revoke all on function get_unread_notification_count from public, anon;
grant execute on function get_unread_notification_count to authenticated;

create or replace function mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update notifications set read_at = now()
  where user_id = auth.uid() and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function mark_all_notifications_read is 'Section 11 bulk mark-read. Marking a single notification read goes through the direct, RLS-scoped read_at column grant instead (notifications_owner_mark_read) — simple enough not to need its own RPC.';

revoke all on function mark_all_notifications_read from public, anon;
grant execute on function mark_all_notifications_read to authenticated;
