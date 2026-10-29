#!/usr/bin/env node
/**
 * India Post pincode directory (api.postalpincode.in) for the pincodes that cover Agra → .cache/osm/india-post.json
 * Post-office NAMES per pincode (no coordinates). A colony whose name matches a post office gets that pincode reliably.
 *   node scripts/fetch-india-post.mjs
 */
import fs from 'node:fs';
const PINS = ['282001','282002','282003','282004','282005','282006','282007','282008','282009','282010','282011','282012','281301','283102','283105','283110','283111','283122','283125','283126'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
for (const pin of PINS) {
  for (let t = 1; t <= 3; t++) {
    try {
      const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { headers: { 'User-Agent': 'GovindPansariApp/1.0 (dataset build)' } });
      const j = (await res.json())[0];
      out[pin] = (j.PostOffice ?? []).map((p) => ({ name: p.Name, branch: p.BranchType, district: p.District }));
      console.log(pin, out[pin].length, 'post offices');
      break;
    } catch (e) { await sleep(2000 * t); }
  }
  await sleep(600);
}
fs.writeFileSync('.cache/osm/india-post.json', JSON.stringify(out));
