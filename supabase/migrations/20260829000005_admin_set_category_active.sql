-- The category on/off switch in the admin panel was a bare table write: nothing in the audit log said who switched a category off or when. On
-- 2026-10-29 all 13 categories were switched off within eight minutes (customers saw no categories) and the log could not say by whom. This is the
-- same change, made through a checked function that records it. Saving a category's details was already audited (admin_update_category).
create or replace function public.admin_set_category_active(p_category_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not has_permission('categories.manage') then
    raise exception 'not authorized';
  end if;
  if p_active is null then
    raise exception 'say whether the category should be shown or hidden';
  end if;
  select name into v_name from categories where id = p_category_id;
  if not found then
    raise exception 'category not found';
  end if;
  update categories set is_active = p_active where id = p_category_id and is_active is distinct from p_active;
  if found then
    perform log_audit_event(case when p_active then 'category_shown' else 'category_hidden' end, 'category', p_category_id, jsonb_build_object('name', v_name));
  end if;
end;
$$;

revoke all on function public.admin_set_category_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_category_active(uuid, boolean) to authenticated;
