-- Phase 10: notification schema. Extends what Phase 01/07/08 already
-- built rather than duplicating it:
--   - `notifications` (Phase 01, content.sql) already exists with the
--     coarse UI category (order/delivery/offer/payment/product/
--     promotional) — kept as-is for the customer's All/Orders/
--     Delivery/Offers filter (section 32) and the transactional-vs-
--     promotional preference split (section 29/30). This migration
--     adds the fine-grained per-event type, read_at, priority, expiry.
--   - `order_events` (Phase 07) and `delivery_events` (Phase 08) are
--     the already-firing, already-tested BUSINESS EVENT stream the
--     spec's architecture diagram calls for — see
--     docs/notification-events.md for the full event-to-notification
--     mapping this phase builds on top of them via triggers, in the
--     next migration. Nothing about those tables changes here.
--   - `order_status_history` (Phase 01, log_order_status_change
--     trigger) is the third existing event source, used for the
--     order-level transitions that don't have a matching order_events/
--     delivery_events row (confirmed/preparing/packed/cancelled).

-- ---------------------------------------------------------------------
-- Fine-grained notification event type. `notifications.type` (the
-- existing coarse enum) stays the UI-category column; this is the
-- specific-event column used for templates, dedup keys, and
-- navigation. See docs/notification-events.md for what triggers each
-- value and why some spec-listed types (e.g. rider CUSTOMER_UNAVAILABLE,
-- a standalone rider DELIVERY_CANCELLED) were deliberately not given a
-- distinct value — this app has no event that would ever fire them
-- independently of one already covered below.
-- ---------------------------------------------------------------------

create type notification_event_type as enum (
  -- customer (+ store, where the same real-world event has a store-facing copy)
  'order_placed',
  'order_confirmed',
  'order_preparing',
  'order_packed',
  'rider_assigned',
  'rider_at_store',
  'order_picked_up',
  'order_out_for_delivery',
  'delivery_arriving',
  'order_delivered',
  'delivery_failed',
  'order_cancelled',
  -- rider-specific (distinct content from the customer/store copies above)
  'delivery_assigned',
  'delivery_reminder',
  'delivery_reassigned',
  'delivery_exception',
  -- store-specific
  'store_new_order',
  -- admin-specific
  'admin_unassigned_delivery',
  'admin_failed_delivery',
  'admin_system_alert'
);

create type notification_priority as enum ('low', 'normal', 'high', 'urgent');

-- Admin operational alerts don't fit any existing coarse category.
alter type notification_type add value if not exists 'system';

-- ---------------------------------------------------------------------
-- notifications: extend Phase 01's table in place.
-- ---------------------------------------------------------------------

alter table notifications
  add column event_type notification_event_type,
  add column priority notification_priority not null default 'normal',
  add column read_at timestamptz,
  add column expires_at timestamptz,
  -- Where this notification came from, for idempotency (see
  -- notification_dedupe below) and debugging — never exposed to the
  -- client as anything more than an implementation detail.
  add column source_table text,
  add column source_id uuid;

-- Backfill: every pre-existing row (there shouldn't be any in a real
-- environment yet, but this keeps the column genuinely NOT NULL-able
-- for new rows without a broken migration on a non-empty table) gets a
-- best-effort event_type from its coarse category so the column can be
-- made mandatory for everything created from here on.
update notifications set event_type = 'order_placed' where event_type is null and type = 'order';
update notifications set event_type = 'delivery_arriving' where event_type is null and type = 'delivery';

-- is_read stays as a real column (Phase 01's RLS grant already targets
-- it specifically — see below) but is now derived from read_at so the
-- two can never disagree. mark_notification_read()/mark_all_read()
-- (next migration) set read_at; nothing sets is_read directly anymore.
-- The old partial index depends on is_read, so it has to go first.
drop index if exists notifications_unread_idx;
alter table notifications drop column is_read;
alter table notifications add column is_read boolean generated always as (read_at is not null) stored;

create index notifications_unread_idx on notifications (user_id, created_at desc) where read_at is null;
create index notifications_user_type_idx on notifications (user_id, type, created_at desc);

comment on column notifications.event_type is 'Fine-grained event (see notification_event_type) — drives templates, dedup, and tap-to-navigate. notifications.type stays the coarse UI category.';
comment on column notifications.data is 'Minimal navigation metadata only (order_id/delivery_id/etc, section 43) — never payment details, tokens, or a full address.';

-- notifications_owner_mark_read (Phase 01) already restricts updates to
-- the owner; the column grant just needs to follow read_at instead of
-- is_read now that is_read is generated (a generated column can never
-- be the target of a client UPDATE).
revoke update on notifications from authenticated;
grant update (read_at) on notifications to authenticated;

-- ---------------------------------------------------------------------
-- notification_dedupe: idempotency (section 14/47/51). Every trigger/
-- function that creates a notification inserts here first, keyed by
-- the source row that caused it — a unique-constraint conflict means
-- "already processed," not an error, so create_notification() (next
-- migration) uses ON CONFLICT DO NOTHING and skips the rest of the
-- work when it doesn't insert.
-- ---------------------------------------------------------------------

create table notification_dedupe (
  source_table text not null,
  source_id uuid not null,
  recipient_id uuid not null,
  event_type notification_event_type not null,
  created_at timestamptz not null default now(),
  primary key (source_table, source_id, recipient_id, event_type)
);

comment on table notification_dedupe is 'Idempotency ledger, not user-facing data — one row per (source event, recipient, event type) that has already produced a notification. Written only by create_notification() and the cron scan functions.';

alter table notification_dedupe enable row level security;
-- No policies at all: this table is never read or written by any
-- client role, only by SECURITY DEFINER functions running as the
-- table owner (which bypasses RLS regardless) — enabling RLS with zero
-- policies is the explicit "nobody gets in" default rather than an
-- oversight (same posture as order_events/delivery_events having no
-- client policies).

-- ---------------------------------------------------------------------
-- user_devices: push-token registry (section 5/6). A user may have
-- several active devices; deactivating one never touches the others
-- (section 56).
-- ---------------------------------------------------------------------

create type device_platform as enum ('ios', 'android');

create table user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  device_token text not null,
  platform device_platform not null,
  app_version text,
  device_id text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One token belongs to exactly one (user, token) pair at a time — a
  -- fresh Expo push token re-registering under a different account on
  -- a shared device re-parents the row rather than creating a
  -- duplicate (see register_device_token() in the next migration).
  unique (device_token)
);

create index user_devices_user_idx on user_devices (user_id) where is_active;

create trigger user_devices_set_updated_at
  before update on user_devices
  for each row execute function set_updated_at();

comment on table user_devices is 'Push token registry (section 5). RLS restricts a user to their own rows for read; all writes go through register_device_token()/deactivate_device_token() (next migration), which is also where "token belongs to a different account now" re-parenting is handled deliberately rather than left to a raw upsert.';

alter table user_devices enable row level security;

create policy "user_devices_owner_read" on user_devices for select using (user_id = auth.uid());
create policy "user_devices_admin_read" on user_devices for select using (is_admin());
-- No insert/update/delete policy for clients — section 44: "Admins
-- should not casually query all tokens from client applications" is
-- read-only anyway, and every write (register/deactivate) goes through
-- a SECURITY DEFINER function that re-derives user_id from auth.uid(),
-- never a client-supplied value (section 6: "never allow User A to
-- register User B's token" — there is no column-level path to do that
-- even by mistake).

-- ---------------------------------------------------------------------
-- notification_preferences (section 29). Transactional categories
-- (order/delivery/system) are NOT stored here as toggles — section 29
-- is explicit that they "must remain enabled." Only the categories a
-- customer may legitimately opt out of are represented.
-- ---------------------------------------------------------------------

create table notification_preferences (
  user_id uuid primary key references profiles (id) on delete cascade,
  promotions_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_set_updated_at
  before update on notification_preferences
  for each row execute function set_updated_at();

comment on table notification_preferences is 'Only the PROMOTIONS toggle (section 30) is a real preference today. Order/delivery/system notifications are transactional and always sent — create_notification() (next migration) only consults this table for type = ''promotional''.';

alter table notification_preferences enable row level security;

create policy "notification_preferences_owner_read" on notification_preferences for select using (user_id = auth.uid());
create policy "notification_preferences_owner_upsert" on notification_preferences for insert with check (user_id = auth.uid());
create policy "notification_preferences_owner_update" on notification_preferences for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- notification_deliveries: per-channel delivery attempt log
-- (section 19). One row per (notification, channel, device) — a
-- notification with 2 active devices produces 2 push rows; in_app
-- delivery is a single row per notification, marked delivered
-- immediately (the notifications row existing + Realtime already
-- enabled on it, per Phase 09's established pattern, IS the in-app
-- delivery).
-- ---------------------------------------------------------------------

create type notification_channel as enum ('push', 'in_app');
create type notification_delivery_status as enum ('pending', 'sent', 'delivered', 'failed', 'expired');

create table notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references notifications (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  device_id uuid references user_devices (id) on delete set null,
  channel notification_channel not null,
  status notification_delivery_status not null default 'pending',
  provider_message_id text,
  attempt_count int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

create index notification_deliveries_pending_idx on notification_deliveries (next_attempt_at) where channel = 'push' and status = 'pending';
create index notification_deliveries_notification_idx on notification_deliveries (notification_id);

comment on table notification_deliveries is 'Push attempt log (section 19). The pending-push index is what the Edge Function (send-push-notifications, invoked on a schedule — see docs/push-notifications.md) polls; a notification''s business success never depends on any row here reaching ''delivered'' (section 17/59).';

alter table notification_deliveries enable row level security;
create policy "notification_deliveries_owner_read" on notification_deliveries for select using (user_id = auth.uid());
-- No client insert/update/delete: written by create_notification() and
-- the push-sending Edge Function (service_role, bypasses RLS).
