-- Admin Control Center, part 2: audit logging (section 32/33).

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles (id),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on audit_logs (created_at desc);
create index audit_logs_actor_idx on audit_logs (actor_id, created_at desc);
create index audit_logs_resource_idx on audit_logs (resource_type, resource_id);

comment on table audit_logs is 'Append-only — no update/delete policy for anyone (section 36: "logs cannot be modified by ordinary admins" applies to every admin, full stop). Written exclusively by log_audit_event(), called from every sensitive admin function in this phase, never inserted to directly.';

alter table audit_logs enable row level security;

create policy "audit_logs_read" on audit_logs for select using (has_permission('audit_logs.view'));
-- No insert/update/delete policy for any client role at all —
-- log_audit_event() is SECURITY DEFINER and writes as the table owner.

create or replace function log_audit_event(p_action text, p_resource_type text, p_resource_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into audit_logs (actor_id, action, resource_type, resource_id, metadata)
  values (auth.uid(), p_action, p_resource_type, p_resource_id, p_metadata);
$$;

comment on function log_audit_event is 'Called from every admin mutation function in this phase (never from the client directly, never storing secrets/tokens in metadata — section 32).';

revoke all on function log_audit_event from public, anon, authenticated;

create or replace function get_audit_logs(p_cursor timestamptz default null, p_limit int default 30, p_resource_type text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select al.id, al.action, al.resource_type, al.resource_id, al.metadata, al.created_at,
           p.full_name as actor_name
    from audit_logs al
    left join profiles p on p.id = al.actor_id
    where has_permission('audit_logs.view')
      and (p_resource_type is null or al.resource_type = p_resource_type)
      and (p_cursor is null or al.created_at < p_cursor)
    order by al.created_at desc
    limit least(coalesce(p_limit, 30), 100)
  ) t;
$$;

revoke all on function get_audit_logs from public, anon;
grant execute on function get_audit_logs to authenticated;
