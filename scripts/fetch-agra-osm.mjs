#!/usr/bin/env node
/**
 * Fetches the raw OpenStreetMap extracts for the Agra delivery area into .cache/osm/ (build input for scripts/build-agra-places.mjs).
 * The public Overpass servers are slow and answer 502/429 to big queries, so the data is fetched as many SMALL queries, each retried
 * across mirrors with a growing pause. Safe to re-run: a query that already has a file is skipped unless you name it explicitly.
 *
 *   node scripts/fetch-agra-osm.mjs                 every query that has no file yet
 *   node scripts/fetch-agra-osm.mjs colonies        just that one (re-fetches)
 */
import fs from 'node:fs';

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
// About 10 km around each store.
const BOX = '27.10,77.86,27.31,78.12'; // south,west,north,east
const WEST = '27.10,77.86,27.31,77.99';
const EAST = '27.10,77.99,27.31,78.12';
const UA = 'GovindPansariApp/1.0 (delivery app, Agra; dataset build)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const q = (body, kind = 'center') => `[out:json][timeout:90];(${body});out tags ${kind};`;
const QUERIES = {
  // every named road with its line, so a pin can be matched to the nearest street
  streets: `[out:json][timeout:120];way["highway"]["name"](${BOX});out tags geom;`,
  // the small places people give directions by
  worshipW: q(`nwr["amenity"="place_of_worship"]["name"](${WEST});`),
  worshipE: q(`nwr["amenity"="place_of_worship"]["name"](${EAST});`),
  education: q(`nwr["amenity"~"^(school|college|university|kindergarten)$"]["name"](${BOX});`),
  health: q(`nwr["amenity"~"^(hospital|clinic|pharmacy)$"]["name"](${BOX});`),
  civic: q(`nwr["amenity"~"^(marketplace|bank|fuel|police|post_office|bus_station|community_centre|library|townhall|fire_station|courthouse)$"]["name"](${BOX});`),
  leisure: q(`nwr["leisure"~"^(park|garden|playground|stadium|sports_centre)$"]["name"](${BOX});nwr["railway"~"^(station|halt)$"]["name"](${BOX});`),
  places: q(`nwr["place"~"^(suburb|neighbourhood|quarter|locality|hamlet|village|town|city_block|borough)$"]["name"](${BOX});nwr["tourism"~"^(hotel|attraction|museum|guest_house)$"]["name"](${BOX});nwr["shop"~"^(mall|supermarket|department_store)$"]["name"](${BOX});`),
  // colony / nagar / sector names carried by any feature
  colonies: q(`nwr["name"~"(Nagar|Colony|Vihar|Puram|Enclave|Kunj|Bagh|Ganj|Pura|Extension|Awas|Avas|Vikas|Sector|Sec |Phase|Mohalla|Vatika|Khand|Puri|Dham)",i](${BOX});`),
  // postal codes and suburb names written on individual map features
  postcodes: q(`nwr["addr:postcode"](${BOX});nwr["postal_code"](${BOX});`),
  addrplace: q(`nwr["addr:suburb"](${BOX});nwr["addr:neighbourhood"](${BOX});nwr["addr:place"](${BOX});`),
};

async function run(name) {
  const query = QUERIES[name];
  for (let attempt = 1; attempt <= 4; attempt++) {
    const ep = ENDPOINTS[(attempt - 1) % ENDPOINTS.length];
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 100_000);
      const res = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        console.log(`${name}: ${new URL(ep).host} -> HTTP ${res.status} (try ${attempt})`);
        await sleep(5000 * attempt);
        continue;
      }
      const json = await res.json();
      fs.writeFileSync(`.cache/osm/${name}.json`, JSON.stringify(json));
      console.log(`${name}: ${json.elements.length} elements from ${new URL(ep).host}`);
      return true;
    } catch (e) {
      console.log(`${name}: ${new URL(ep).host} -> ${e.name} (try ${attempt})`);
      await sleep(5000 * attempt);
    }
  }
  console.log(`${name}: FAILED`);
  return false;
}

fs.mkdirSync('.cache/osm', { recursive: true });
const wanted = process.argv[2];
for (const name of Object.keys(QUERIES)) {
  if (wanted && wanted !== name) continue;
  if (!wanted && fs.existsSync(`.cache/osm/${name}.json`)) {
    console.log(`${name}: already fetched, skipping`);
    continue;
  }
  await run(name);
  await sleep(3000);
}
console.log('done');
