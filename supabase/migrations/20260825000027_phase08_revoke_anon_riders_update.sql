-- Defense-in-depth cleanup found while verifying Phase 08's grants:
-- Phase 01's `revoke update on riders from authenticated;` never
-- revoked the same default table-level grant from `anon`. Not
-- practically exploitable — the only UPDATE policy
-- (riders_self_update) requires profile_id = auth.uid(), which is
-- always null for an anonymous request, so RLS already blocks every
-- row — but there's no reason to leave the raw privilege sitting
-- there while section 6 is specifically about rider access security.
revoke update on riders from anon;
