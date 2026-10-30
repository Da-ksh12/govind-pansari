// Finding Agra places by name or pincode from the shop's own index.
import test from 'node:test';
import assert from 'node:assert/strict';
import index from '../data/agra-places.json' with { type: 'json' };
import { normalize, sameSpot, searchLocalities } from '../lib/places.ts';

const names = (query) => searchLocalities(index, query).map((p) => p.locality);

test('names are compared without case, punctuation or accents', () => {
  assert.equal(normalize('  Awas-Vikas  Colony! '), 'awas vikas colony');
});

test('the shops\' own colonies are found, however they are spelled', () => {
  assert.ok(names('Awas Vikas').some((n) => /vikas/i.test(n)), 'Awas Vikas');
  assert.deepEqual(names('avas vikas'), names('awas vikas'), 'Avas / Awas are the same place');
  // the index has no "Vijay Nagar"; the shop's own area (from the stores table) is added to it by the search route
  const withShop = { ...index, localities: [...index.localities, { n: 'Vijay Nagar Colony', la: 27.20341, ln: 78.022594, r: 600, k: 'colony', s: 3 }] };
  assert.deepEqual(searchLocalities(withShop, 'vijay nagar').map((p) => p.locality), ['Vijay Nagar Colony']);
  assert.deepEqual(searchLocalities(index, 'vijay nagar'), [], 'and without it, nothing is invented');
});

test('"Agra" or "near" in the text does not stop a match, and every result carries a usable position', () => {
  const found = searchLocalities(index, 'Awas Vikas Colony Agra');
  assert.ok(found.length > 0);
  for (const p of found) {
    assert.ok(p.lat > 26.9 && p.lat < 27.5 && p.lng > 77.7 && p.lng < 78.3, `${p.label} lies in the Agra area`);
    assert.match(p.label, /, Agra$/);
  }
});

test('a pincode gives that pincode\'s area; an unknown one gives nothing', () => {
  const found = searchLocalities(index, '282007');
  assert.equal(found.length, 1);
  assert.equal(found[0].postcode, '282007');
  assert.deepEqual(searchLocalities(index, '999999'), []);
});

test('too-short or unknown text finds nothing rather than something random', () => {
  assert.deepEqual(searchLocalities(index, 'a'), []);
  assert.deepEqual(searchLocalities(index, 'zzzzqqqq'), []);
  assert.deepEqual(searchLocalities(index, 'agra'), []);
});

test('results are capped and not duplicated', () => {
  const found = searchLocalities(index, 'nagar', 6);
  assert.ok(found.length <= 6);
  assert.equal(new Set(found.map((p) => p.locality)).size, found.length);
});

test('two nearby positions count as the same spot', () => {
  assert.equal(sameSpot({ lat: 27.2, lng: 78 }, { lat: 27.2005, lng: 78.0004 }), true);
  assert.equal(sameSpot({ lat: 27.2, lng: 78 }, { lat: 27.25, lng: 78 }), false);
});
