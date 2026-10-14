-- Bug found via live testing (not assumed): GoTrue's invite endpoint
-- creates the auth.users row with email still NULL, then sets it in a
-- separate UPDATE — confirmed directly against auth.users for a real
-- test invite (INSERT-time raw_user_meta_data already had
-- staff_invite_id, but email was null until a later update). The
-- INSERT-only trigger from 20260826000060 therefore ran with
-- new.email = null and never found the matching staff_invites row.
--
-- Fix: also fire handle_new_auth_user() on UPDATE of auth.users.email.
-- The function is already idempotent (matches on applied_at is null
-- and sets it), so re-running it on both the insert and the later
-- email-set update is safe — a phone-only customer signup (email
-- never set) is completely unaffected.
create trigger on_auth_user_email_set
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function handle_new_auth_user();
