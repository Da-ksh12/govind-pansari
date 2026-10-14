-- Final Dispatch pass: multi-rider concurrent offer/acceptance system.
--
-- This is genuinely new — audited first (no existing "dispatch round"/
-- "offer" concept anywhere in the schema; see docs/rider-assignment.md,
-- which documents the single-assignee model this extends rather than
-- replaces). Today `assign_rider()` puts exactly one rider up for
-- accept/decline; this adds a real "offer it to every eligible rider
-- at once, first to accept wins" round on top, reusing assign_rider's
-- capacity/authorization/notification machinery for the actual win
-- rather than duplicating it (see 20260826000093).
--
-- Split into its own migration per this project's established rule:
-- never add and use a new enum value in the same transaction.

alter type notification_event_type add value 'delivery_offer';
alter type notification_event_type add value 'dispatch_round_expired';

-- 'dispatch_offer': set on the delivery_assignments row created the
-- instant a rider wins a dispatch round (accept_delivery_offer), so
-- it's auditable apart from a store manager's manual pick ('manual')
-- or the older single-candidate auto-assign ('auto') — see
-- docs/rider-assignment.md for what each source means.
alter type delivery_assignment_source add value 'dispatch_offer';
