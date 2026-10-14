# Notification Security (Phase 10)

## RLS: who can see what

`notifications` — `notifications_owner_read` (Phase 01, unchanged):
`user_id = auth.uid()`. A store staff member's `store_new_order`
notification and a customer's `order_placed` notification for the same
order are two separate rows, each owned by its own recipient — there
is no "store-scoped" notification visible to every staff member by
virtue of the store; each staff member gets their own row (resolved
via `store_staff_recipient_ids()` at creation time), and RLS scopes
each to its actual owner like any other notification.

`user_devices` — a user reads only their own rows
(`user_devices_owner_read`); admin can read any (`user_devices_owner_read`
+ `user_devices_admin_read`, section 44's "admin can read, not
casually query from a client app" — this is still gated by `is_admin()`,
not a client-supplied flag). No client insert/update/delete policy
exists at all — every write goes through `register_device_token()`/
`deactivate_device_token()`, which derive identity from `auth.uid()`.

`notification_preferences` — owner-only read/insert/update, standard
shape.

`notification_deliveries` — owner-only read (so a user can, in
principle, see their own push delivery status); no client write path.

`notification_dedupe` — **no policies at all**, RLS enabled with zero
grants. Nothing reads or writes this table except `SECURITY DEFINER`
functions running as the table owner, which bypasses RLS regardless —
enabling RLS here is an explicit "nobody gets in" default, matching
`order_events`/`delivery_events`' own posture.

## Idempotency is also a security property

`notification_dedupe`'s primary key
`(source_table, source_id, recipient_id, event_type)` doesn't just
prevent duplicate pushes (section 14/47/51) — it also means a
malicious or buggy retry of the same underlying event can never be
used to spam a specific user with repeated notifications, since the
second attempt is a silent no-op (`create_notification()` returns
`null` without inserting anything).

## Data minimization (section 43)

`notifications.data` (and therefore the push payload) carries only
`orderId`/`deliveryId`/`eventType` — enough for
`navigateForNotification()` to route a tap, nothing else. No payment
details, no full address, no auth tokens, no other user's information.
The app fetches the actual order/delivery detail after opening the
target screen, using the same authorization (`get_delivery_tracking()`,
`orders_owner_read`, etc.) that screen already enforces regardless of
how the user navigated there.

## Recipient resolution never trusts the client

Every trigger resolves *who* gets notified from the database itself —
`orders.user_id`, `riders.profile_id` (joined from the event's own
`rider_id`), `store_staff_recipient_ids(store_id)`,
`admin_recipient_ids()`. Nothing in the notification pipeline accepts
a client-supplied recipient id (section 46) — the one place a client
calls into this system with a payload at all is
`notify_arriving_soon(order_id)`, which re-derives `orders.user_id`
server-side and explicitly rejects a caller who isn't that order's own
customer (verified live, test 8).

## What's actually verified

`supabase/tests/phase10-notifications.test.mjs` — 19 live tests: the
full order→delivery lifecycle producing exactly the right notification
for exactly the right recipients with no duplicates (tests 1–6),
idempotency under a repeated client call (7–8), unread
count/read/mark-all/pagination correctness (9–11), cross-user RLS on
both read and write for `notifications` (12–13), device token
ownership/re-parenting/deactivation and its own RLS (14–17),
preference RLS (18), and the full failure path fanning out to
customer/rider/store/admin correctly (19). Re-run alongside Phases
05/07/08/09 — zero regressions, 121 live tests total across five
backend phases.
