-- profiles_permission_read (migration 044) merged two distinct
-- intents into one OR'd policy: customers.view should only ever see
-- CUSTOMER profiles (that's the whole point of the permission name),
-- but the policy had no role filter, so any admin role holding
-- customers.view alone (support_agent, operations_manager — neither
-- holds users.view) could read every profile in the system, including
-- other admins' and colleagues' phone/email/admin_role. users.view is
-- correctly broad already (Staff & Roles genuinely needs to see
-- non-customer profiles) and is untouched here. Found via security audit.
drop policy if exists "profiles_permission_read" on profiles;

create policy "profiles_customers_view_read"
  on profiles for select
  using (has_permission('customers.view') and role = 'customer');

create policy "profiles_users_view_read"
  on profiles for select
  using (has_permission('users.view'));
