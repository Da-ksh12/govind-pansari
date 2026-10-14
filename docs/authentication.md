# Authentication

Supabase Auth, phone number + OTP, India-only (+91) for now. No custom
OTP system — Supabase's own phone provider issues and verifies every
code; the app never generates, stores, or logs one.

## Dev/demo note: no SMS provider configured

This project has no Twilio (or other SMS provider) account attached —
`external_phone_enabled` was `false` and `sms_provider` had no
credentials when this phase started. Real SMS delivery to arbitrary
numbers needs that configured (Dashboard → Authentication → Providers →
Phone) before going to production.

For development, phone auth is enabled with a **test OTP** list
(`sms_test_otp` project setting) — a fixed code for specific numbers
that skips real SMS sending entirely, while still exercising the real
`signInWithOtp`/`verifyOtp` flow, real session creation, and the real
`handle_new_auth_user` profile-creation trigger:

| Phone | OTP | Maps to |
|---|---|---|
| `+919000000201` | `123456` | existing demo customer |
| `+919000000202` | `123456` | existing demo rider |
| `+919000000203` | `123456` | existing demo store manager |
| `+919000000299` | `123456` | fresh number — exercises new-profile creation |

Configured via the Management API (`PATCH
/v1/projects/{ref}/config/auth`), not a migration — it's an Auth
service setting, not a database change.

## Architecture

```
app/login.tsx  →  authService.requestOtp(phone)   →  Supabase sends OTP
app/otp.tsx    →  authService.verifyOtp(phone,otp) →  creates a session
                                                          │
                                    store/authStore.ts's onAuthStateChange
                                    listener (subscribed once, in
                                    app/_layout.tsx) picks up SIGNED_IN,
                                    fetches the profile, sets status
```

`services/supabase/authService.ts` is the only place that calls
`supabase.auth.*` directly for sign-in — screens call it, never the
raw client. Errors are classified into `AuthFlowError` with a `code`
(`INVALID_PHONE` / `INVALID_OTP` / `RATE_LIMITED` / `NETWORK_ERROR` /
`UNKNOWN`) from Supabase's error `code`/`status`, so the OTP screen can
show a specific message without knowing anything about the Auth API.

## Auth state (section 3)

`store/authStore.ts` has a `status: 'loading' | 'authenticated' |
'unauthenticated'` field. It does **not** persist this itself — Supabase's
own client (configured in `services/supabase/client.ts` with
`persistSession: true` against AsyncStorage) already persists the
session, and `authStore` only *mirrors* Supabase's live state via
`onAuthStateChange`, subscribed once at the root layout. `status`
starts `'loading'` and only resolves once the listener's first callback
(`INITIAL_SESSION`) fires — `app/index.tsx` (Splash) waits for that
before deciding where to navigate, so a returning authenticated user
never flashes through `/login` while the session is still being
restored.

Every one of SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED / USER_UPDATED /
INITIAL_SESSION goes through the same listener — there's no separate
manual "am I logged in" check anywhere else in the app.

## Profile creation & role assignment (sections 6-7)

Entirely server-side, from Phase 01 (`handle_new_auth_user` trigger on
`auth.users` insert) — unchanged by this phase, just now actually
exercised by a real sign-in flow instead of a demo-mode stub. New rows
always get `role = 'customer'` (the column default) — the mobile
client has no code path that could set any other role. `role` is not
in the client-writable columns of `profiles` (see below), so even a
request crafted by hand against the REST API can't change it.

## Profile update, and why `phone` isn't editable (section 8)

Client-writable columns on `profiles`: `full_name`, `email`,
`avatar_url` (a Postgres column grant, not just an RLS policy — see
`20260825000017_phase03_identity_and_location.sql`). `phone` was
removed from that list in this phase: it's the *authentication
identity*, not contact info like email, and Phase 01 had it in the
writable set, which would let a raw table UPDATE desync
`profiles.phone` from the actually-verified `auth.users.phone`.
Changing your number should go through Supabase Auth's own
`updateUser({ phone })` + OTP re-verification (not built in this
phase — not in the completion criteria) — the migration adds a trigger
(`sync_profile_phone`) that keeps `profiles.phone` correct automatically
whenever that *does* happen in a future phase, without the column ever
being directly writable.

## Logout (sections 12, 41)

`authStore.logout()` calls `authService.signOut()` (revokes the
Supabase session — verified live: a second request with the same
access token gets rejected) and clears local cart/wishlist state
(`useCartStore.clear()`, `useWishlistStore.clear()`) so nothing carries
over to the next account signed in on the same device. It does not
touch server-side data — the customer's addresses/profile/history are
untouched, exactly as section 12 asks.

## Phone formatting (section 11)

`services/phone.ts` is the one place that knows about `+91` —
`isValidIndianMobile`, `toE164` (the only format ever sent to
Supabase), `formatPhoneDisplay`. Nothing else in the app hardcodes the
country code or does its own digit-stripping.

## Verified live (`supabase/tests/phase03-auth-location.test.mjs`)

New customer sign-in creates a `role='customer'` profile; existing
customer sign-in resolves to the same `auth.users` row; a wrong OTP is
rejected; logout actually revokes the session; a customer cannot PATCH
their own `role` to `'admin'` (403) or edit another user's profile.
