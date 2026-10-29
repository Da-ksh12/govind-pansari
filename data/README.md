# Agra place data

`agraPlaces.json` is what lets the address picker say **"Vijay Nagar Colony, Agra 282004"** instead of the map provider's
"Civil Lines" (OpenStreetMap's one big suburb, ~4 km wide, which has no feature called Vijay Nagar at all). It is read on the
device, with no network call. Code: `services/location/placeIndex.ts` (lookups), `localityIndex.ts` (nearest block),
`placeEnrichment.ts` (merges it into the provider's answer), `placeData.ts` (lazy load + the stores as anchors).

## What is in it

| Key | What | Used for |
|---|---|---|
| `localities` | colonies, sectors, areas: name, centre, extent (metres), how many map features carry the name, pincode if a post office has the same name | "In Vijay Nagar Colony" / "Near Kamla Nagar · 650 m" |
| `streets` | named roads as lines | the street, only when the pin is within 60 m of the line |
| `landmarks` | temples, mosques, schools, colleges, hospitals, markets, banks, fuel, police, stations, parks, hotels, malls | "Near Durga Mandir · 120 m" suggestion chip (offered, never filled in) |
| `pincodes` | postcodes written on real map features | a pincode for *this spot*: ≥3 within 600 m and ≥70% agreeing |
| `postalAreas` | India Post post-office names with their pincode (no coordinates) | a pincode for *this neighbourhood*, within 1.2 km of the area |

Rules that keep it honest: a pincode is only shown with evidence (nearby tagged addresses, then the India Post area name,
otherwise blank). A house number is never invented. A block farther than 2 km is not named. Where the data knows nothing, the
provider's answer is returned unchanged. The app's own stores (owner-managed `stores` rows) are added as anchors at run time,
so "Vijay Nagar Colony" exists even though the maps do not have it.

## Sources and licences

* **OpenStreetMap** via Overpass: © OpenStreetMap contributors, ODbL. Streets, places, landmarks, tagged postcodes.
* **India Post** pincode directory (`api.postalpincode.in`): post-office names per pincode.
* **GeoNames postal codes** (`IN.zip`): CC-BY 4.0. Names only; its coordinates are zone centroids and are not used.
* **Wikidata**: CC0. A few neighbourhood/settlement points.

OpenStreetMap and GeoNames require a visible credit. Today "© OpenStreetMap contributors" appears only under address-search results;
the map views hide their own attribution (`attribution={false}`) and the About screen has no credit line. Add one before a wide
release.

## Adding a place the maps do not know — the quick way

Edit **`agraPlaces.extra.json`**. Its entries are merged *in front* of the generated data, so an entry here wins over a map
entry of the same name. No build step, no script; ship it with the next app build.

```jsonc
{
  "localities": [{ "n": "Sector 9, Awas Vikas Colony", "la": 27.2051, "ln": 77.9661, "r": 350, "k": "sector", "s": 1, "p": "282007" }],
  "streets":    [{ "n": "Gali No. 3, Sector 11", "p": [[27.2041, 77.9650], [27.2043, 77.9655]] }],
  "landmarks":  [{ "n": "Durga Mandir", "la": 27.2045, "ln": 77.9651, "t": "temple" }],
  "pincodes":   [],
  "postalAreas": [{ "n": "Sector 9 Awas Vikas", "p": "282007" }]
}
```

`k` is `colony`, `sector` or `area`. `r` is the radius in metres (a sector ~300–400, a colony ~500–900). `s` is how sure you
are (1 is fine). Take coordinates from a real place (drop a pin there in any map app and copy the latitude/longitude), not from memory.

## Refreshing the generated file

```bash
node scripts/fetch-agra-osm.mjs          # Overpass → .cache/osm/*.json (skips files that exist; name a query to re-fetch it)
node scripts/fetch-india-post.mjs        # India Post → .cache/osm/india-post.json
node --no-warnings --import ./tests/unit/register-ts-resolver.mjs scripts/build-agra-places.mjs   # → data/agraPlaces.json
npm run test:unit                        # tests/unit/agra-places.test.mjs checks the real data too
```

The build is deterministic and skips any input that is missing. Two inputs are **not** scripted (they were fetched by hand and
sit in the git-ignored `.cache/`): the GeoNames file (`https://download.geonames.org/export/zip/IN.zip`, `IN.txt` placed at
`.cache/geonames/postal4/IN.txt`) and `.cache/osm/wikidata.json` (a list of `{name, lat, lng, type}`). Without them the build
still works, with fewer post-office area names and no Wikidata points. Check the diff of `agraPlaces.json` after a rebuild.

## Known limits

* OpenStreetMap's coverage of Awas Vikas sectors is partial (sectors 1, 3, 4, 6, 7, 8, 11, 16 A at the time of the build). A sector
  the maps lack is answered as the nearest known block, shown as "Near …", never as a sector it cannot prove.
* Lanes and house-level detail are not in any free source. Use `agraPlaces.extra.json` for the ones that matter.
* Nothing here is verified against ground truth by walking the streets; the test pins use the stores' real coordinates.
