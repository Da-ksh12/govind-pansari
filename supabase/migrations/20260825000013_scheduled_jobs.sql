-- Scheduled maintenance via pg_cron. Both jobs are idempotent and safe
-- to run concurrently with normal traffic (release_expired_reservations
-- uses FOR UPDATE SKIP LOCKED; the retention delete is a plain bounded
-- DELETE).
--
-- NOTE: pg_cron is available on Supabase's hosted Postgres, but must be
-- enabled for the project (Database -> Extensions -> pg_cron) before
-- these schedules will actually run — the extension was requested in
-- the first migration, but confirm it's active after applying.

create or replace function prune_old_rider_locations(p_older_than interval default interval '30 days')
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted bigint;
begin
  delete from rider_locations where recorded_at < now() - p_older_than;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function prune_old_rider_locations is 'Keeps rider_locations bounded — 30 days of raw pings is enough for recent-delivery route review without the table growing unbounded. Adjust the retention window in docs/backend-architecture.md if the business needs longer analytics history (in which case aggregate first, don''t just widen this).';

revoke all on function prune_old_rider_locations from public, anon, authenticated;

select cron.schedule(
  'release-expired-order-reservations',
  '*/5 * * * *',
  $$select release_expired_reservations();$$
);

select cron.schedule(
  'prune-old-rider-locations',
  '0 3 * * *',
  $$select prune_old_rider_locations();$$
);
