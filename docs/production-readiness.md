# Production readiness — what is left

Checked on 2026-10-27 against the live project (`swgwcsfnimodloakamtv`) and the repository. "Verified" means it was
read or tested live in that session; "Not checked" means nobody looked — do not read it as "fine".

## Must fix before a public launch

| # | Item | Evidence | What to do |
|---|---|---|---|
| 1 | **QA mode is ON in production** (`qa_test_mode = true`) | Live `feature_flags`. Store selection skips the 09:00–21:00 opening-hours check while it is on, so customers can order at any hour (since migration 20260827000018 this applies to customers and checkout alike; before it, customers were wrongly blocked after 9 pm). The flag's own description says "never enable in production". | `select set_feature_flag('qa_test_mode', false)` as an admin with `settings.manage` — but QA/demo ordering at night then stops, so do it at launch. |
| 2 | **39 fixed-code sign-in numbers** (code `123456`), incl. super-admin +919000000301 | Auth config `sms_test_otp`. | Remove them (keep one or two for store-review demo logins if wanted), then run `GO_LIVE=1 node supabase/tests/otp-auth.test.mjs`. |
| 3 | **Razorpay is not on the client's account** | Keys in secrets are `rzp_live_…` of an unknown account; no `RAZORPAY_WEBHOOK_SECRET` / `RAZORPAY_ACCOUNT_ID`; no webhook created. | Client's key id + secret, webhook (`razorpay-webhook`) in their dashboard, auto-capture on, then a ₹1 live test. |
| 4 | **Real OTP SMS arrival is not confirmed** | Fast2SMS accepted sends and billed them; nobody has reported the SMS arriving or typed a code. No delivery-report webhook, so the log only ever says "accepted". | Register with a real number on the new APK; create the Fast2SMS delivery webhook (URL in `.cache/fast2sms-webhook-url.txt`). If blocked: the DLT link whitelist (`…/GVPANS/` vs the template's `…govindpansari.com/`). |
| 5 | **Secrets were pasted in chat** | Fast2SMS API key, Supabase access token. | Rotate both. |
| 6 | **Auth emails point at localhost** | Auth `site_url = http://127.0.0.1:3000`. Staff-invite / reset links use it. Brevo SMTP also fails (sender `hr@aflix.co.in` unverified; `rate_limit_email_sent = 2`/hour). | Set the real site URL, verify the Brevo sender, raise the email limit. |
| 7 | **Launch crash of 2026-10-15 never diagnosed** | No crash log was ever captured. | Install the new APK on a real phone and capture `adb logcat -b crash` (or Play Android vitals) before any release. |
| 8 | **Test data in the live database** | 157 non-cancelled orders (61 on the deactivated Sanjay Place fixture), 20 demo customers, 5 demo riders, junk products `jjllk` / `ghgh`. | Archive/clean before launch so dashboards and reports are real. |
| 9 | **Open sign-up can be abused** | No CAPTCHA. Hook cap is 200 SMS/hour (≈₹50/hour at ₹0.25). Wallet was ₹49.25. | Low-balance alert + auto-recharge; add CAPTCHA if abuse appears. |

## Should fix soon

* Customers see "We don't deliver to this address yet" when a store is merely **closed** (code: `resolve_checkout` / `check_serviceability` return `OUTSIDE_SERVICE_AREA` when `find_serviceable_stores` is empty). Needs its own "store closed, opens 9 am" message once item 1 is done.
* Delivery fee ₹49, minimum order ₹299, free delivery over ₹499 were inferred from a test, never confirmed by the owner.
* Source-map upload to Sentry is disabled (`SENTRY_DISABLE_AUTO_UPLOAD=true`), so crash traces are minified.
* Everything from the last sessions is **uncommitted** on branch `migration/native-ownership`.
* EAS free builds are used up until 2026-11-01; APKs are built locally.
* Not checked: Supabase plan / backups / point-in-time recovery, RLS audit and the `qa_*` functions' grants as a dedicated pass, storage bucket policies, Play Console listing (privacy policy URL, data-safety form), iOS build, load testing.

## Store assignment by location — verified

* A customer's coordinates must fall inside a delivery-zone polygon (`ST_Covers`); the stores serving that zone are ranked by `priority`, then straight-line distance. All three priorities are 0, so **nearest store wins**.
* At checkout (`resolve_checkout`) the nearest store **that can fulfil the whole cart from its own stock** is chosen; otherwise `CART_NOT_FULFILLABLE`. No order splitting.
* Tested at 16 real Agra/regional coordinates: every in-area point picked the correct nearest store (0 mismatches against an independent haversine calculation); Mathura, Delhi, Firozabad, Gwalior, Fatehpur Sikri and far Fatehabad Road were refused. All 56 saved customer addresses resolve to a store.
* Past orders: of 157, 79 went to the nearest store, 61 to the deactivated Sanjay Place test store, 17 to a farther store (1 in the last 14 days — a farther store is correct when the nearest could not fulfil the cart; that order was not examined).
* Limits: distance is straight-line, not road distance; both live zones are ~200 km² and overlap heavily; the zone ignores the store's current stock when deciding "serviceable".

## Rider assignment — manual only (migration 20260827000017)

* No automatic assignment: the retry job is unscheduled, open automatic rounds were cancelled, `start_auto_assignment` / `auto_assign_rider` are not callable by app users, and the Auto-Assign / "Send to All Nearby Riders" buttons are gone from the store and admin apps. (The broadcast backend still exists for the admin QA demo panel.)
* "Choose a Rider" lists every active rider with a status (Free · Request pending · Heading to store · At a store · Delivering · Offline), load (n/limit) and distance from the store. Riders who cannot take the order are listed separately, greyed out, with the reason.
* A rider has 5 minutes (`assignment_expiry_minutes()`) to accept. If they decline or let it lapse, the order goes back to Ready for Pickup, the store's staff (and the admin who assigned) get a "Rider didn't accept" notification, and the open order screen asks "Choose another rider now?".
* Cancelling an assignment (until pickup) needs two separate confirmations, then the rider list opens at once. Available in the store app and on the admin delivery screen.
* Tests: `tests/unit/manual-rider-assignment.test.mjs`, live rolled-back `supabase/tests/manual-rider-assignment.test.mjs` (25 checks).
