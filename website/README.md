# Govind Pansari — online store

The website for Govind Pansari, Agra. It is a second front-end on the **same Supabase project as the mobile app**: the same products, stock,
prices, carts, orders, payments and accounts. Nothing here duplicates a business table or business rule; where the app already has the rule
(serviceability, checkout totals, order creation, payment verification) the website asks the same server function.

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Motion · GSAP ScrollTrigger · Supabase (`@supabase/ssr`) · React Hook Form + Zod.

## Run it on your computer

```powershell
cd website
npm install
copy .env.example .env.local      # then fill in the two Supabase values (same as the app's .env)
npm run dev                       # http://localhost:3000
```

Production mode, as the host will run it: `npm run build` then `npm start`.

Checks: `npm run typecheck` · `npm run lint` · `npm test` (unit tests). With the site running: `node scripts/e2e-guest.mjs`, `node scripts/crawl.mjs`,
`node scripts/a11y.mjs` (browser checks using the Microsoft Edge on your machine; pass `--base=http://localhost:3000`).

## Settings (environment variables)

All are public values (they are visible in the browser). **Never** put a Supabase service-role key, a Razorpay key *secret* or a webhook secret in this project.

| Name | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The same project as the app. Required. |
| `NEXT_PUBLIC_SITE_URL` | The public address, e.g. `https://yourdomain.com` (no trailing slash). Used for links, the sitemap and social previews. |
| `NEXT_PUBLIC_SUPPORT_PHONE`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_WHATSAPP_NUMBER` | Real customer-care details. Anything empty is simply not shown (the numbers inside the app are placeholders). |
| `NEXT_PUBLIC_INSTAGRAM_URL`, `NEXT_PUBLIC_FACEBOOK_URL` | Optional `https://` links for the footer. |

`NEXT_PUBLIC_*` values are fixed into the site **when it is built**, so set them before the build, and rebuild after changing one.

## How it fits together

- `app/` pages · `components/` UI · `lib/` pure logic (catalogue, cart, query, timeline, address rules — all unit-tested) · `data/` the Agra place index (copied from the app).
- **Catalogue** is read with the public (anonymous) key and cached for 60 seconds (`lib/data/`). Stock is merged across the two ACTIVE shops only.
- **Cart**: signed out = this browser (variant ids + quantities only, never prices); signed in = the server cart through the app's own `add_to_cart` / `set_cart_item_quantity` / `remove_cart_item`. The two are merged once on sign-in.
- **Checkout** asks the server for the real total (`get_checkout_summary`) and places the order (`create_order_from_cart`, idempotent). The browser never sets a price.
- **Online payment**: Razorpay's payment window opens in the browser; the result is sent to the server, which verifies Razorpay's signature (`verify-razorpay-payment`). The browser never marks anything paid. The Razorpay edge functions have no CORS headers (they were written for the app), so the website's own server calls them (`app/api/payments/*`, `lib/server/edge.ts`) using the customer's session; the functions need no change.
- **Sign-in**: mobile number + 6-digit code (Supabase phone login, same SMS as the app). `proxy.ts` keeps the session fresh and sends signed-out visitors away from `/account` and `/checkout`.
- **Row-level security is untouched.** No service-role key exists in this project.

## Before going live (owner's list)

1. Real support phone / email / WhatsApp in the settings above.
2. Razorpay: live keys and the webhook secret set as Supabase Edge Function secrets; the website's domain registered with Razorpay for live payments; one real small payment tested end to end.
3. Review the policy pages (`/terms`, `/privacy`, `/shipping`, `/refunds`) with whoever advises on legal matters. They were derived from the app's own terms and corrected for online payment; refund timings for online payments are deliberately not promised.
4. Fix catalogue data in the admin panel (see `docs/website-launch-notes.md` in the main project, if present): wrong product photos, test products, categories.
5. Replace the interim 3D-style showcase with a real 3D model if one is produced (none exists yet).
