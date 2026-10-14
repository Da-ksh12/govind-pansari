# Push Notifications (Phase 10)

## Provider: Expo Push Service

Asked directly (same pattern as Phase 09's map/routing provider
question) rather than assumed: no Firebase/APNs credentials existed
for this project. Chose Expo's own push service — it relays to
FCM/APNs on Expo's infrastructure, needs no Firebase/Apple developer
account of our own, and requires only an EAS project. One was created
during this phase (`daksh_2502/govind-pansari`,
`extra.eas.projectId` in `app.json`) via `eas init --non-interactive
--force` under the account already logged into the CLI on this
machine. Swapping to a self-managed FCM/APNs setup later means
implementing `PushProvider`-shaped logic against those APIs inside the
same Edge Function and changing nothing else — the mobile app, the
database schema, and every trigger stay untouched, since none of them
know which provider is behind `send-push-notifications`.

## The pipeline (verified live, end to end)

```
pg_cron (every minute)
  → invoke_push_worker()  [reads a Vault secret, calls pg_net]
    → POST /functions/v1/send-push-notifications  (service_role auth)
      → get_pending_push_deliveries()               [RPC, typed params]
      → POST https://exp.host/--/api/v2/push/send   [Expo, no API key]
      → mark_push_delivery_sent / _retry / _failed / _dead_token  [RPC]
```

This was tested against the real Expo endpoint, not mocked: a
notification was created for a syntactically-valid-but-fake Expo push
token, the cron job picked it up within a minute (no manual trigger),
Expo's API correctly returned `DeviceNotRegistered`, and the worker
correctly marked the delivery `failed` and deactivated the device
token — the full failure path, exercised for real.

## Why the service-role key isn't in any migration file

`pg_net`'s `net.http_post()` needs an `Authorization` header to pass
Supabase's Edge Function gateway (JWT verification is on by default,
deliberately not disabled — disabling it would mean the function
accepts unauthenticated requests from anyone). That header needs a
real secret value, and migration files are checked into git — a
secret embedded in one lives in git history forever, readable by
anyone with repo access. Instead:

- `supabase_vault` (a Supabase-provided Postgres extension) stores it
  encrypted, referenced by name (`push_worker_service_key`) from
  `invoke_push_worker()`
- the secret's actual *value* was seeded via a one-off `supabase db
  query --file` command against a temp file outside the repo,
  immediately deleted after — never committed anywhere

**To reactivate this on a fresh project** (new Supabase project, key
rotated, etc.): run once, not as a migration —

```sql
select vault.create_secret('<service_role_key>', 'push_worker_service_key', 'service_role key for the push worker');
```

`invoke_push_worker()` no-ops silently (not an error) if this secret
doesn't exist yet, so a fresh environment doesn't spam the cron log
before it's configured.

## Device tokens (section 5/6/54/55/56)

- `user_devices` has no client insert/update/delete RLS policy at
  all — every write goes through `register_device_token()`/
  `deactivate_device_token()`, both `SECURITY DEFINER`, both deriving
  identity from `auth.uid()` (never a client-supplied user id).
- **Refresh**: `register_device_token()` is an `UPSERT` on the unique
  `device_token` column — calling it again with the same token just
  updates `last_seen_at`/`is_active`.
- **Multi-device**: one row per `(user, token)`; a user can have any
  number of active devices, and deactivating one never touches the
  others (section 56) — there's no "one active device per user"
  constraint anywhere.
- **Shared-device account switch**: the same physical token
  re-registering under a *different* signed-in user re-parents the
  row (`ON CONFLICT (device_token) DO UPDATE SET user_id = ...`) — the
  previous account simply stops being able to receive pushes on it,
  verified live (test 14).
- **Logout**: `authStore.logout()` calls
  `deactivateCurrentDeviceToken()` *before* `signOut()`, while the
  session (and therefore `auth.uid()`) is still valid — deactivating
  after sign-out would have nothing to authenticate the call with.
- **Dead tokens**: only the push worker deactivates a token based on
  Expo's own `DeviceNotRegistered` response — nothing else
  second-guesses whether a token is still good.

## Retries (section 18)

`notification_deliveries.attempt_count` + `next_attempt_at` drive
exponential backoff (30s → 60s → 120s → 240s, capped) for any failure
that isn't `DeviceNotRegistered` (which never retries — the token is
just dead) — up to `MAX_ATTEMPTS = 5`, after which the delivery is
marked permanently `failed`. A whole-batch failure (Expo's API itself
unreachable) retries every delivery in that batch rather than
discarding them.

## Client-side setup (`services/notifications/pushRegistration.ts`)

- Registration happens once per sign-in (`authStore`'s auth-state
  listener), never on cold app launch before login (section 53) — and
  never blocks sign-in if it fails (permission denied, simulator with
  `Device.isDevice === false`, no `projectId` configured, offline).
- Foreground behavior (section 36): the native handler is configured
  to *not* show a system alert while the app is open
  (`shouldShowBanner: false`) — the Realtime-driven in-app banner
  (`InAppNotificationBanner`, fed by `notificationsStore`) already
  covers that case, and arrives faster than a push round-trip would
  anyway. Background/killed-app notifications are the only case the
  OS actually presents anything, which is exactly the state that
  needs it.
- Tap navigation (section 12/31): `Notifications.useLastNotificationResponse()`
  at the root layout covers cold-start and background taps uniformly,
  routed through the same `navigateForNotification()` mapping the
  in-app list and banner both use — one mapping, not three copies.

## Rider "New Delivery" alert — dedicated channel (section: rider background/lock-screen alert hardening)

A rider missing a delivery assignment because it blended into generic
"urgent" notification traffic is a real failure mode (a real customer's
order sits un-picked-up) — distinct from every other high-priority
notification (new order to store staff, admin alerts), so it gets its
own Android channel instead of sharing `urgent`:

- **Channel**: `rider-delivery-alerts` (`pushRegistration.ts`) — HIGH
  importance, a bundled custom sound, a distinct short-short-long
  vibration pattern (`[0, 250, 120, 250, 120, 600]`, vs. `urgent`'s
  even short-short-short), and `lockscreenVisibility: PUBLIC`.
- **Sound**: `assets/sounds/rider_delivery_alert.wav` — a synthesized
  ~1.1s three-note chime (ding-ding-alert), bundled via the
  `expo-notifications` config plugin's `sounds` array in `app.json`.
  Android resource-name rules forced the underscore filename (no
  hyphens allowed). **Custom notification sounds require the native
  Android project to be regenerated** (`npx expo prebuild --platform
  android`, or a fresh EAS/`eas build`) before they take effect — just
  changing `app.json` and rebuilding with an already-generated
  `android/` folder does nothing; the sound file has to actually land
  in `android/app/src/main/res/raw/` first. Also: Android notification
  channels are **immutable per install** once created — a device that
  already has this channel from an earlier build won't pick up a
  changed sound/vibration/importance without a full uninstall, not
  just a reinstall over the existing app.
- **Routing**: `get_pending_push_deliveries()` already merges each
  notification's `event_type` into the outbound push `data` payload;
  `send-push-notifications`'s Edge Function reads `data.eventType` and
  routes `delivery_assigned`/`delivery_reminder`/`delivery_reassigned`/
  `delivery_exception` to this channel (Android) and this sound
  (both platforms) — every other event type is completely unaffected
  (still `urgent`/`default`, no `sound` field, exactly as before).
- **Body content**: `notify_on_delivery_event()`'s `delivery_assigned`
  branch now includes real item count and order total —
  `"Order #GP26091600921 • 1 item • ₹849 — pickup at <store>."` —
  live-verified in the `notifications` table after a real test
  assignment. Still no customer name/address/phone (see
  `docs/notification-security.md`) — safe to show at
  `lockscreenVisibility: PUBLIC`.
- **Settings fallback**: `app/rider/profile.tsx` now shows a "Delivery
  Alerts" card (re-checked every time the screen gains focus, since
  there's no permission-change event to listen for) with an "Open
  Notification Settings" button (`Linking.openSettings()`) whenever
  permission isn't granted — covers the case the OS permission prompt
  was already dismissed/denied and can't be re-triggered programmatically.

Everything else in the pipeline (dedup via `notification_dedupe`,
retry/backoff, dead-token deactivation, RLS, tap-to-navigate routing to
`/rider/delivery/[deliveryId]`, the in-app `NewDeliveryPrompt` for the
foreground case) was already built and is unchanged by this work — see
the sections above.

## Known limitation

None of this has been exercised on a real device — this sandboxed
environment has no physical Android device. The server-side pipeline
(trigger → `create_notification` → push delivery row → cron worker →
Expo API) is verified for real, live, end-to-end against Supabase and
Expo's actual push API, including the new channel-routing/sound logic
and the enriched notification body (confirmed via direct queries after
a real test delivery assignment) — the SQL/Edge Function/config are
provably correct. What remains genuinely unverified is on-device
behavior only a physical phone can show: the permission prompt, the
actual sound playing (as opposed to the WAV file being structurally
valid and correctly bundled), heads-up/lock-screen rendering, and
whether a given OEM's battery-optimization settings interfere. Get
this onto a real device/EAS dev-client build — and reinstall the app
fresh rather than updating over an existing install, since the Android
notification channel this depends on is immutable per-install — before
treating push as production-ready.
