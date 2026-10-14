# Notification Testing (Phase 10)

## Live suite: `supabase/tests/phase10-notifications.test.mjs`

Same philosophy as every prior phase — real Supabase Auth sessions,
real RPC/REST calls, real RLS, no mocks. 19 tests, all passing:

1–6. **Full lifecycle fan-out** — places a real order and drives it
   through accept → preparing → packed → rider assignment → at_store →
   picked_up → out_for_delivery → delivered via the real Phase 05/07/08
   RPCs, asserting the exact expected notification (event type,
   recipient, priority) appears at each step, that internal
   picking/packing sub-phases produce *no* customer notification, and
   that the full lifecycle produces zero duplicate
   `(event_type, source_table, source_id)` combinations.
7–8. **`notify_arriving_soon` idempotency** — calls it twice in a row,
   asserts exactly one notification; asserts a different customer
   can't call it for someone else's order.
9–11. **In-app center mechanics** — `get_unread_notification_count()`
   matches the real unread row count, mark-read decrements it,
   `mark_all_notifications_read()` zeroes it, and cursor pagination
   returns non-overlapping pages.
12–13. **Cross-user RLS on `notifications`** — a second customer can
   neither read nor mark-read the first customer's rows.
14–17. **Device tokens** — registration under the caller's own
   identity, re-registration re-parenting a token to a different user,
   `deactivate_device_token()` only affecting the caller's own token,
   RLS blocking cross-user reads, and admin's broader read access.
18. **Notification preferences RLS**.
19. **Failure fan-out** — a `fail_delivery()` call notifies the
   customer, the rider, store staff, *and* every admin, with the admin
   copy at `urgent` priority.

## Bootstrap notes specific to this suite

- **No admin account existed anywhere in the seed data before this
  phase.** The suite creates one: `+919000000301` was added to the
  project's `sms_test_otp` allowlist via the Management API, signed
  up through the normal OTP flow, then promoted to `role = 'admin'`
  via a service-role `PATCH` — the same "OTP creates a profile,
  service-role patches its role for test purposes" pattern already
  used for store managers/staff in Phase 07/08's suites.
- **Notifications accumulate across debugging runs** the same way
  orders/inventory did in earlier phases — the suite wipes all
  participants' `notifications` rows at startup for count-exact
  assertions (unread count, pagination) to be reliable.
- **Real bug found by this suite, not by review**: a `CASE` expression
  passed directly as `create_notification()`'s `p_priority` argument
  resolves to plain `text` before the function call is matched against
  its overload — unlike a bare string literal (which stays untyped and
  auto-casts), a `CASE`'s result doesn't, so
  `notify_on_order_status_change()` failed with "function
  create_notification(...) does not exist" the moment any order
  reached `confirmed`/`preparing`/`packed`/`cancelled`. Every downstream
  test failed as a result. Fixed with an explicit
  `::notification_priority` cast
  (`20260826000038_phase10_fix_priority_cast.sql`) — same *shape* of
  bug as Phase 09's composite-NULL issue: correct-looking SQL, silently
  broken, caught only by exercising the real deployed function.
- **Real bug found in the test script itself, not the backend**:
  `mark_picked_up()` requires the *actual* order number of the delivery
  being picked up — an early draft of tests 7 and 19 reused the first
  test's order number for a second and third order, causing
  `mark_picked_up` to reject silently downstream (no assertion caught
  it at the time) and leaving those deliveries stuck mid-lifecycle,
  which then surfaced as a confusing "rider is at capacity" failure two
  tests later. Fixed by fetching each order's own `order_number` before
  calling `mark_picked_up`.

## Push pipeline: verified manually against the real Expo API

Not part of the automated suite (it depends on pg_cron's own schedule,
not something to assert on a tight test-run timeline), but exercised
live once: a notification was created for a fake-but-well-formed Expo
push token, the cron-driven worker picked it up within a minute
without any manual trigger, Expo's API correctly identified it as
`DeviceNotRegistered`, and the worker correctly marked the delivery
failed and deactivated the token. See `docs/push-notifications.md`.

## Not covered (see "Known limitation" in `docs/push-notifications.md`)

Anything requiring a real device or simulator: the permission prompt,
`getExpoPushTokenAsync()` actually succeeding, a push notification
rendering on-device, and the foreground in-app banner's visual
behavior. This environment has neither.
