# Website launch notes (2026-10-30)

The online store lives in `website/` and uses the **same Supabase project** as the mobile app. This file says what was checked, what was not, and what
the owner still has to do. Nothing in the database or in the mobile app was changed for the website.

## What was checked (and how)

| Check | Result |
|---|---|
| Type check, lint | clean |
| Unit tests (`npm test` in `website/`) | 71 pass: catalogue/stock merging, cart, search & filters, order timeline, sign-in rules, address rules, checkout gate, payment-failure wording, link safety, Agra place search |
| Production build, installed and built from the zip in an empty folder | succeeds |
| 36 routes × desktop and phone in a real browser (Edge): status codes, console errors, broken images, sideways scrolling | 72 loads, 0 problems |
| Guest journey in a real browser: add to cart, drawer, quantities, reload keeps the cart, cart page, checkout sends to sign-in, search overlay, filters/sort/paging, delivery check answered by the server, mobile menu, reduced motion, welcome screen once | 18 of 18 |
| Automated accessibility audit (axe-core, WCAG 2.1 A/AA + best practice), 15 pages × 2 sizes | 0 violations |
| Payment routes' guards (signed out, malformed, foreign website) | 401 / 400 / 403 as designed |

## What was NOT checked — do this before real customers

These need a real one-time SMS code or real money, so they were only checked by reading the code and by unit tests:

1. Sign in with a mobile number and code, and the "tell us your name" step.
2. Signed-in cart merging (browser cart → server cart).
3. Placing a cash-on-delivery order from the website.
4. **Paying online.** The Razorpay functions have no CORS headers, so the website calls them from its own server (`website/app/api/payments/*`). This is untested with a real payment. Test one small real payment (and one cancelled payment, which must give the cart back), then check the order shows "paid" in the admin panel.
5. Order tracking page and its live updates; cancelling an order; saved addresses; wishlist.

Also: Razorpay must have the website's domain registered for live payments, and the webhook secret (`RAZORPAY_WEBHOOK_SECRET`) is not yet set in Supabase.

## Decisions made on the owner's behalf

- **Stock.** The public stock view (`product_availability`) returns **no rows** to a signed-out visitor in the live database, although it worked on 2026-08-25. Rather than show everything as "sold out", the website shows stock as *unknown* (still buyable); the checkout enforces real stock. If the view should be readable by visitors, ask a developer to check why (the definition in migration `20260825000011` says it is). Until then no "In stock / Low stock" labels appear.
- **Offers.** "First Order Offer — WELCOME50" is not shown: coupons are not applied by the checkout. The app's "Build your own box" banner is not shown: the website has no box builder.
- **"Sweets".** The app's About text mentions sweets; the catalogue has none, so the website does not promise them.
- **Delivery numbers** (radius, charge, minimum, free-delivery level, minutes) are read live from the delivery settings; none are typed into the website. Today: 10 km, ₹49, ₹299, free above ₹499, about 35 minutes.
- **Contact details** are hidden until real ones are set (the app's number is a placeholder).
- **Address search** uses the app's Agra place list first, then OpenStreetMap inside Agra only. OpenStreetMap's free service is for light use; use a paid geocoder at real traffic.
- **3D.** No 3D model of a Govind Pansari pack exists, so "Discover the Goodness Inside" is a layered, scroll-driven presentation of real product photographs — labelled as such, not 3D. Nothing from three.js / React Three Fiber is installed.
- **Newsletter** is not built: there is no table to store sign-ups and none was invented.
- **Policy pages** were derived from the app's own terms and corrected for online payment. They are not legal advice; have them reviewed. Refund timings for online payments are deliberately not stated.

## Catalogue problems seen on the live data (fix in the admin panel)

These show on the website exactly as in the app.

- **Wrong pictures:** *Californian Biscuit* (a black boot), *Red chilli* (a road), the **Dry spices** category image (a screenshot of the app), *California Cashew* (only the logo).
- **Test or unclear products:** *Pp, Fgh, Ghu, jjllk, sauff, Sauce, High 1, Hing2, Mamaearth Shampoo*.
- **Duplicates / spellings:** *White Sauce* and *White sauce*; *Tata salt lite* twice; *Vanaspati tail*, *Vanspati tel*.
- **No category (11 products):** Pp, Fgh, Red powder, Mamaearth Shampoo, White Sauce, Namkeen, Jira, Kasuri methi, Pulse, Vanaspati tail, **Iranian Mabroom Dates** (a real product).
- **Wrong category:** *Vanspati tel* is filed under Pistachios.
- **Overlapping categories:** *Dry spices*, *masala*, *Spices & Masalas*.
- **MRP vs price:** 63 of 66 products show a saving, some very large (*White Sauce* ₹200 against an MRP of ₹900 = "Save 78%"). Check the MRPs; printed discounts that are not real can be a consumer-protection problem.
- Only one product is in *Gift Hampers*.

## Other open items from earlier work that affect launch

See `docs/production-readiness.md`: `qa_test_mode` is ON in production, QA phone numbers must be removed, Razorpay live keys and webhook secret, and the Supabase access token that was pasted into a chat earlier must be revoked.
