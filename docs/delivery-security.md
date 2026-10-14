# Delivery Security / RLS (Phase 08)

## Access matrix (section 6/49)

| | Own rider profile | Own deliveries | Other riders' data | Other stores' deliveries | Order price/inventory |
|---|---|---|---|---|---|
| **Rider** | read + limited self-update | read + act (via functions) | ❌ | ❌ | ❌ (no write path at all) |
| **Store manager/staff** | ❌ (not their row) | read/act, own store only | ❌ | ❌ | store's own inventory only, via `record_inventory_adjustment()` |
| **Customer** | ❌ | read-only, own active order's rider | ❌ | ❌ | ❌ |
| **Admin** | full | full | full | full | full |

Every "❌" is enforced at the RLS/function level, not just hidden in
the UI — verified live: a rider cannot read another rider's
`delivery_assignments` row (test 26), cannot call
`record_inventory_adjustment` (test 27), a direct `PATCH` of
`orders.total` from a rider session silently affects zero rows (test
28), a rider cannot view a store dashboard (test 3).

## A real bug this phase's tests caught: RLS recursion

`delivery_events`' read policy queries `riders` (to check "is the
caller this event's rider"). `riders`' own `riders_active_delivery_read`
policy (Phase 01) queries `delivery_assignments`. `delivery_assignments`'
own read policy (Phase 01) queries `riders` right back — a
Phase‑01‑era mutual cross-reference between the two tables' policies
that had simply never been exercised by any query traversing both
sides of the cycle before this phase. Adding `delivery_events` (whose
policy also touches `riders`) closed the loop: even a store manager's
otherwise-unrelated read (which should have matched the
`is_store_staff()` branch first) could still trigger it, because
Postgres doesn't guarantee left-to-right short-circuit evaluation of
an `OR`'d `USING` clause.

```
42P17: infinite recursion detected in policy for relation "riders"
```

**Fix**: `is_own_rider(rider_id)` and
`is_customer_of_rider_delivery(rider_id)` — `SECURITY DEFINER` helper
functions, the same pattern `is_store_staff()`/`is_admin()` already
use everywhere else. A `SECURITY DEFINER` function's internal queries
run as the function owner, not the RLS-restricted caller — so calling
one from inside a policy never re-triggers the *other* table's RLS,
breaking the cycle completely. `riders_active_delivery_read`,
`rider_locations_read`, and `delivery_assignments_read` (all Phase 01)
were rewritten to call these functions instead of embedding the
cross-table subquery inline; `delivery_events_read` (this phase) was
built with the fix from the start.

**A second mistake caught immediately after**: the first attempt
`REVOKE`d `EXECUTE` on these two new helper functions from
`authenticated`, reasoning "clients never call them directly." That's
true but irrelevant — a policy's `USING` clause still evaluates with
the *querying* role's privileges, so revoking `EXECUTE` broke every
policy that referenced them (`permission denied for function
is_own_rider`). `SECURITY DEFINER` only changes which privileges the
function *body* runs with; it does not exempt the *call* from needing
its own `EXECUTE` grant. Fixed by granting to `PUBLIC`, matching
`is_store_staff()`/`is_admin()`'s own (never-revoked) default grant.

**Lesson for next time a policy needs a helper function**: match the
existing `is_store_staff()`/`is_admin()` pattern exactly (`SECURITY
DEFINER`, left on the default `PUBLIC` grant) rather than reasoning
about grants from scratch — both mistakes here came from not doing
that the first time.

## Pickup verification is a security control, not just a UX nicety

`mark_picked_up()` requires the order number and rejects a mismatch
server-side (section 20's "do NOT trust a rider simply pressing
PICKED UP without validating the delivery/order relationship") — this
is enforced in the function itself, so even a modified/scripted client
can't skip it.

## Column-level grants — checked directly, not assumed

Same discipline as Phase 07's inventory fix: `riders.is_available`'s
direct column grant is fully revoked from `authenticated` (superseded
by `set_rider_availability()`), and a stray Phase‑01 table-level
`UPDATE` grant on `riders` for `anon` (never practically exploitable —
RLS's `profile_id = auth.uid()` check already blocks every row for an
anonymous request, since `auth.uid()` is null — but worth closing
while already in this exact area) was revoked too. Verified via
`information_schema.column_privileges`/`role_table_grants` directly,
not inferred from the migration SQL alone.
