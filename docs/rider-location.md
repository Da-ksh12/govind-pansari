# Rider Location Capture (Phase 09)

## The only write path

`services/location/riderLocationService.ts` never writes
`rider_locations` directly — everything goes through the
`submit_rider_location()` RPC. The old Phase 01
`rider_locations_self_insert` RLS policy (a direct client INSERT with
zero validation) was dropped in the same migration that added the
function, the same way Phase 07/08 superseded direct writes to
`inventory.quantity` and `riders.is_available`.

`submit_rider_location()` derives everything from the session, never
from client-supplied parameters:
- **rider identity** — `riders where profile_id = auth.uid()`, never a
  `p_rider_id` argument. A rider physically cannot submit a location
  claiming to be someone else.
- **active delivery** — the rider's own most recent
  `delivery_assignments` row with `status in ('accepted', 'at_store',
  'picked_up', 'in_transit')`. If none exists, the call is rejected
  outright ("no active delivery eligible for location tracking") —
  tracking literally cannot start before acceptance and cannot
  continue past completion, because there's no eligible row to attach
  it to.

## Capture settings (`riderLocationService.start()`)

```ts
Location.watchPositionAsync(
  { accuracy: Location.Accuracy.Balanced, timeInterval: 4000, distanceInterval: 15 },
  ...
)
```

Balanced accuracy, ~4s / 15m thresholds — frequent enough for a smooth
customer-facing map, not so frequent that it drains the rider's
battery or spams the outlier-detection/Realtime pipeline. Tracking is
started/stopped from `app/rider/delivery/[id].tsx` based on the
delivery's status (`TRACKABLE_STATUSES`), and stops the moment the
delivery leaves that set — including on navigation away, unless the
delivery is still genuinely active (so background-tabbing to Home
mid-delivery doesn't kill tracking, but completing/failing the
delivery does).

A `MAX_CONSECUTIVE_FAILURES` (5) circuit breaker means a rider with a
dead connection gets a visible error instead of the app silently
retrying a failing RPC call forever in the background.

## Outlier detection (section 10) — and the bug that disabled it

Each submission compares against the rider's own most recent ping *for
the same delivery leg* (`rider_id` + `delivery_id`), computes implied
speed via `ST_Distance` (geography, so it's a real great-circle
distance) over elapsed seconds, and flags — never rejects — anything
implying >120 km/h. The row is still stored (for audit), but
`sync_rider_current_location()` skips updating `riders.current_latitude/
longitude` for a flagged row, so a spoofed/glitched jump never reaches
`riders`' fast-read fields or the customer's map (see
`trackingRepository.subscribeToLocation`'s own `is_outlier` check as a
second line of defense on the read side).

**This was completely non-functional on first deployment.** The guard
was written as:

```sql
if v_prev is not null then ...
```

`v_prev` is a `rider_locations%rowtype` fetched via `select * into
v_prev from rider_locations where ... order by recorded_at desc limit
1`. In Postgres, `IS NOT NULL` on a composite/row value is true only
when **every field** is non-null — not "a row was found." Since
`accuracy`/`heading`/`speed`/`altitude` are nullable columns that test
calls routinely omit, `v_prev` almost always had at least one null
field, so the whole `IS NOT NULL` check silently evaluated false even
when a real previous row existed — and a 176km/1-second jump sailed
through unflagged in testing.

Found via a live test (not code review): a diagnostic version of the
function confirmed `prevFound: true` (a row genuinely existed) but
every computed field (`seconds`/`distanceM`/`impliedKmh`) came back
`null`, meaning the branch was never entered at all. Fixed by checking
one guaranteed-non-null column instead:

```sql
if v_prev.recorded_at is not null then ...
```

Deployed in `20260825000033_phase09_fix_outlier_null_check.sql`.
Re-verified: 15/15 tracking tests passing, including the specific
176km-jump outlier test that first caught this.

## Background location — a documented gap, not a fake

Tracking today is foreground-only: it runs while
`app/rider/delivery/[id].tsx` is mounted, which is realistically where
a rider needs it open anyway (turn-by-turn context, delivery actions).
Continuing to submit location while the app is backgrounded needs
`expo-task-manager`, additional iOS/Android background-location
permission modes (each with their own store-review justification
requirements), and real-device testing — none of which this
environment can do (no native build, no device). Implementing it
without that testing would mean shipping unverified background-mode
code, which is worse than not having it. Flagged here as the next
concrete step before this feature is considered production-complete,
not silently skipped.
