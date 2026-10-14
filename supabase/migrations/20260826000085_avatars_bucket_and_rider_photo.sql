-- Premium admin redesign: rider (and staff) profile photos. profiles
-- already has an avatar_url column (20260825000003) and self-update
-- privilege on it, but there was no storage bucket for it at all, and
-- no way for an ADMIN (as opposed to the person themselves) to set a
-- rider's photo — exactly what the redesign's Rider Profile screen
-- needs ("Admin should be able to: upload rider photo, replace rider
-- photo... Do not allow arbitrary customers to upload/change rider
-- photos"). Same public-read/restricted-write shape as product-images
-- (20260826000056) — an avatar isn't sensitive like a delivery-proof
-- location photo, so a public bucket is the right, simpler choice
-- here, not a signed-URL one.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');

create policy "avatars_admin_write" on storage.objects
  for insert with check (bucket_id = 'avatars' and (has_permission('riders.manage') or has_permission('users.manage') or is_admin()));

create policy "avatars_admin_update" on storage.objects
  for update using (bucket_id = 'avatars' and (has_permission('riders.manage') or has_permission('users.manage') or is_admin()));

create policy "avatars_admin_delete" on storage.objects
  for delete using (bucket_id = 'avatars' and (has_permission('riders.manage') or has_permission('users.manage') or is_admin()));

-- ---------------------------------------------------------------------
-- admin_set_rider_avatar: profiles' own RLS only lets a user edit
-- their OWN avatar_url, or a full is_admin() super admin edit anyone's
-- — a scoped admin with just riders.manage couldn't set a rider's
-- photo directly via REST. This closes that gap the same way every
-- other rider-scoped admin action already does (see
-- admin_permission_rls.sql's riders_permission_write).
-- ---------------------------------------------------------------------
create or replace function admin_set_rider_avatar(p_rider_id uuid, p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if not (has_permission('riders.manage') or is_admin()) then
    raise exception 'not authorized';
  end if;

  select profile_id into v_profile_id from riders where id = p_rider_id;
  if v_profile_id is null then
    raise exception 'rider not found';
  end if;

  update profiles set avatar_url = p_avatar_url where id = v_profile_id;

  perform log_audit_event('rider_avatar_updated', 'rider', p_rider_id, jsonb_build_object('avatarUrl', p_avatar_url));
end;
$$;

comment on function admin_set_rider_avatar is 'Lets a riders.manage-scoped admin (not just a full is_admin() super admin) set a rider''s profile photo — profiles'' own RLS only allows self-edit or full-admin-edit of avatar_url otherwise. p_avatar_url null removes the photo (falls back to the initials Avatar tile client-side).';

revoke all on function admin_set_rider_avatar from public, anon;
grant execute on function admin_set_rider_avatar to authenticated;
