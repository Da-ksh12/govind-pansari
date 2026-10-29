-- Audit trail for OTP text messages sent through Fast2SMS (functions/send-sms-hook,
-- functions/fast2sms-dlr). It answers "was this code delivered, and if not why" and
-- shows abuse or a drained wallet, WITHOUT storing the code or the full number:
-- only a masked number (+91XXXXXX1234) and the provider's request id.
--
--   status 'accepted'    the provider took the message (NOT proof it reached the phone)
--          'delivered'   a delivery report confirmed delivery to the handset
--          'undelivered' a delivery report said it failed
--          'failed'      we could not hand it to the provider (balance, key, timeout, ...)
--          'rejected'    refused by us before sending (not an Indian mobile, send budget exhausted)
--
-- Locked to the service role: row-level security is on with no policies, and the
-- client roles have no table privileges. Rows older than 60 days are pruned daily.
--
-- Rollback: select cron.unschedule('prune-sms-delivery-log'); drop table sms_delivery_log;

create table if not exists sms_delivery_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'fast2sms',
  route text,
  phone_masked text not null,
  request_id text,
  status text not null check (status in ('accepted', 'delivered', 'undelivered', 'failed', 'rejected')),
  failure_code text,
  failure_detail text,
  dlr_status text,
  dlr_reason text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sms_delivery_log_request_id_idx on sms_delivery_log (request_id) where request_id is not null;
create index if not exists sms_delivery_log_created_idx on sms_delivery_log (created_at desc);

alter table sms_delivery_log enable row level security;
revoke all on table sms_delivery_log from anon, authenticated;

comment on table sms_delivery_log is 'OTP SMS audit trail (masked number, provider request id, accepted vs delivered). Service role only; never holds the OTP or a full phone number.';

select cron.schedule(
  'prune-sms-delivery-log',
  '30 4 * * *',
  $job$delete from sms_delivery_log where created_at < now() - interval '60 days';$job$
);
