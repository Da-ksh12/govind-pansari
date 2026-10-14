/**
 * Placeholder product photography.
 *
 * Real Govind Pansari product photography is not yet available. Per the
 * brand guidelines, we never fabricate packaging or brand claims — these
 * are generic, unbranded stock photos of the relevant ingredient, keyed
 * by topic so they can be swapped 1:1 for real shoot assets later
 * (see Product.images in /types/models.ts).
 *
 * Each mock-data call site passes a free-text keyword string (e.g.
 * `productImg('cashew nuts closeup')`); we match it against a small,
 * hand-picked set of verified Unsplash photo IDs rather than a
 * keyword-driven random-image service. (The previous implementation used
 * loremflickr.com, which is unreliable and frequently fails to load —
 * these are fixed, checked-working URLs instead.)
 */

type PhotoId = string;

// Verified Unsplash photo IDs, one representative shot per ingredient/theme.
const ALMONDS = 'photo-1430163393927-3dab9af7ea38';
const CASHEWS = 'photo-1573555657105-47a0bb37c3ea';
const WALNUTS = 'photo-1512905024369-fe9701b6d8f1';
const PISTACHIOS = 'photo-1610137512859-aa919f651a05';
const RAISINS = 'photo-1691657917109-c6e027eac44a';
const DATES = 'premium_photo-1725618795756-13c4b58bf2fc';
const TEA = 'photo-1503242656214-176c681bfef7';
const SPICES = 'premium_photo-1705433052991-8ebe1c81ce35';
const MAKHANA = 'photo-1633536705550-c06044327482';
const SEEDS = 'photo-1447903196606-76e102ef24f9';
const GIFT_HAMPER = 'photo-1764385827352-78c20131fd47';
const DELIVERY_SCOOTER = 'premium_photo-1664475726646-9a5469b728b7';
const MIXED_NUTS = 'photo-1525790428446-ad5140bdd234';
const FIGS = 'photo-1524593313283-1e092f06b2f0';
const SAFFRON = 'photo-1615885108069-7d5bef9a7e22';
const PUMPKIN_SEEDS = 'photo-1601368156156-fb9e52e2f5dd';
const SUNFLOWER_SEEDS = 'photo-1613500788522-89c4d55bdd0e';

// Ordered most-specific-first: the first substring match wins.
const KEYWORD_MAP: [match: string, photo: PhotoId][] = [
  ['almond', ALMONDS],
  ['cashew', CASHEWS],
  ['walnut', WALNUTS],
  ['pistachio', PISTACHIOS],
  ['raisin', RAISINS],
  ['date', DATES],
  ['tea', TEA],
  ['makhana', MAKHANA],
  ['fox nuts', MAKHANA],
  ['fig', FIGS],
  ['anjeer', FIGS],
  ['saffron', SAFFRON],
  ['kesar', SAFFRON],
  ['pumpkin seed', PUMPKIN_SEEDS],
  ['sunflower seed', SUNFLOWER_SEEDS],
  ['seed', SEEDS],
  ['turmeric', SPICES],
  ['masala', SPICES],
  ['spice', SPICES],
  ['gift', GIFT_HAMPER],
  ['hamper', GIFT_HAMPER],
  ['scooter', DELIVERY_SCOOTER],
  ['delivery', DELIVERY_SCOOTER],
  ['trail', MIXED_NUTS],
];

const DEFAULT_PHOTO = MIXED_NUTS;

function resolvePhoto(keywords: string): PhotoId {
  const q = keywords.toLowerCase();
  for (const [match, photo] of KEYWORD_MAP) {
    if (q.includes(match)) return photo;
  }
  return DEFAULT_PHOTO;
}

const unsplash = (photo: PhotoId, w: number, h: number) =>
  `https://${photo.startsWith('premium_') ? 'plus' : 'images'}.unsplash.com/${photo}` +
  `?auto=format&fit=crop&w=${w}&h=${h}&q=80`;

export const productImg = (keywords: string, _variant = 1) => unsplash(resolvePhoto(keywords), 900, 900);

export const bannerImg = (keywords: string, _variant = 1) => unsplash(resolvePhoto(keywords), 1200, 720);

export const categoryImg = (keywords: string, _variant = 1) => unsplash(resolvePhoto(keywords), 700, 700);

export const avatarImg = (seed: string) =>
  `https://api.dicebear.com/9.x/notionists/png?seed=${encodeURIComponent(seed)}&backgroundColor=f6ead8`;
