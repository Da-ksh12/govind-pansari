# Admin Audit Logging

## What's logged

`log_audit_event(action, resource_type, resource_id, metadata)` is called from every sensitive admin mutation added this phase:

| Action | From |
|---|---|
| `order_cancelled` | `update_order_status()`, only when the canceller isn't the order's own customer |
| `rider_reassigned` | `cancel_assignment()` |
| `inventory_adjusted` | `adjust_inventory()` — before/after quantity, movement type, reason |
| `staff_role_assigned` / `staff_deactivated` | `assign_store_staff_role()` / `deactivate_store_staff()` |
| `admin_role_changed` | `assign_admin_role()` |
| `settings_changed` / `feature_flag_changed` | `update_app_settings()` / `set_feature_flag()` |
| `customer_status_changed` | `set_customer_active()` |

Every one of these fires from inside the same `SECURITY DEFINER` function that performs the actual mutation, in the same transaction — there's no separate "remember to log this" step a client could skip, and no path where the mutation succeeds but the log entry doesn't (or vice versa).

## Never modifiable, even by an ordinary admin (section 32/36)

```sql
alter table audit_logs enable row level security;
create policy "audit_logs_read" on audit_logs for select using (has_permission('audit_logs.view'));
-- no insert/update/delete policy for any client role at all
```

Verified live: a `POST` to `/rest/v1/audit_logs` — even authenticated as a full super admin — is rejected. The only insert path is `log_audit_event()`, itself unreachable from the client (`revoke all ... from public, anon, authenticated`) — it's only ever called internally by the functions above.

## What's deliberately not logged as a metadata payload

`log_audit_event()`'s `metadata` is always a small, specific `jsonb_build_object(...)` of the fields relevant to that one action (a before/after quantity, a reason string, a new role) — never a dump of the full row or request. No secrets, tokens, or credentials pass through it anywhere in this phase, matching section 32's explicit instruction.

## Reading the log

`get_audit_logs(cursor, limit, resourceType)` — cursor-paginated (capped at 100/page server-side), optionally filtered by resource type, gated by `audit_logs.view`. `app/admin/audit-logs.tsx` shows actor name, action, resource, and the raw metadata JSON inline — enough to answer "who changed what and why" without a second lookup, per section 32's own example format.
