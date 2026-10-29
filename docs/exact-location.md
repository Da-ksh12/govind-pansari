# Exact location (Blinkit / Zepto style)

Changed 2026-10-28, after a tester reported that "use my location" landed on the *area*, not the exact spot. Tested only with
unit tests and live OpenStreetMap lookups — **not on a phone** (see the end).

## Why the old build landed on the area

1. **First reading wins.** `getCurrentFix()` took the first reading Android returned. That is often a quick network/Wi-Fi fix good to
   hundreds of metres; the satellite fix (≈10 m) arrives a few seconds later. The old code only complained above 150 m.
2. **"Approximate" permission.** Android 12+ lets the customer grant *Approximate* instead of *Precise*. Such a grant can never give an
   exact spot, and the app never noticed.
3. **Wide map.** After locating, the map stayed at zoom 15 (a whole neighbourhood in view), with no sign of how sure the phone was.
4. **Coarse address text.** The phone's own geocoder usually answers an Indian coordinate with just "Agra, Uttar Pradesh".

## What it does now

* `locationService.getCurrentFix()` listens for up to 12 s, keeps the **most precise** reading, moves the pin to each better one, and
  stops the moment one is good to **≤ 25 m**. Cached/old readings are ignored (`services/location/fixRefinement.ts`, tested with
  simulated GPS sessions). It still never falls back to a last-known or default position.
* If Android granted only *Approximate*, the app asks once more for *Precise* and, if refused, says so plainly with an **Open app
  settings** button.
* The map **zooms to street level** (17.5) after a precise fix, wider when the fix is rough, and shows a chip:
  *Exact location · ±12 m* / *Check the pin · ±80 m* / *Approximate area only*. Dragging the pin away from the GPS reading drops the
  claim — it is then the customer's own choice.
* **Opening the picker locates automatically** (only if permission was already granted — it never pops a dialog by itself).
  **"Use Current Location" in Add Address opens the map already on the customer's spot**, to check and nudge the pin before saving.
  Re-opening an existing pin never re-locates over it.
* **Street-level address text.** OpenStreetMap's reverse lookup (zoom 18) is tried before the phone's geocoder:
  `Wazirpura Road, Swadhesi Bima Colony, Civil Lines, Agra` instead of `Agra, Uttar Pradesh`. The lookup runs once the pin has rested
  (500 ms) so GPS refinement does not fire a request per step.
* **Wrong PINs are not pre-filled.** OpenStreetMap returned 402004 (a Maharashtra PIN) for a point in Agra; a PIN whose first digit does
  not match its state is dropped (`sanePostalCode`). The customer types it, or it comes from the correct source.
* The home location screen uses the same exact fix and a street-level label.

Where OpenStreetMap only knows the *area* (e.g. the point near Balkeshwar), the picker says so and does **not** invent a street — the
customer fills street/house in the form, as always. House number is never filled in automatically.

## Not verified

* Not run on a device: how fast a real phone reaches ≤ 25 m outdoors vs indoors, the Android Precise/Approximate dialogs, the "improved
  accuracy" settings prompt, the chip and zoom on screen. Indoors GPS may never reach 25 m; the app then settles on the best reading
  after 12 s and tells the customer how precise it is.
* OpenStreetMap coverage varies by street; some points will still resolve only to an area.
* Nominatim's usage policy allows ~1 request/second and expects modest traffic. Fine for the current scale (one request per resting
  pin); a paid geocoder (or the Google path in `docs/google-address-setup.md`) is the upgrade if volume grows.
