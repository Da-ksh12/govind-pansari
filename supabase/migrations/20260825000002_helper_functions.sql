-- Generic helpers used by many tables' triggers/policies.

-- Maintains `updated_at` on any table that has the column. Attached
-- per-table where needed (see later migrations).
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- (handle_new_auth_user + its trigger on auth.users live in
-- 20260825000003_profiles.sql, right after the profiles table it
-- depends on — kept together rather than split across files so the
-- dependency is obvious at a glance.)
