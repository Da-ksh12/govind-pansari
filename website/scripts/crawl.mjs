// Loads every public route in a real browser (Edge) at desktop and phone width and reports what a visitor would hit: HTTP status, console errors,
// failed requests, the page title, the number of H1s, images that failed to load, and sideways scrolling (a sign of broken mobile layout).
//   node scripts/crawl.mjs [--base=http://localhost:3000] [--only=/shop,/faq]
import { chromium } from 'playwright-core';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const base = arg('base') ?? 'http://localhost:3000';
const only = arg('only')?.split(',');

const ROUTES = [
  '/', '/shop', '/shop?q=almond', '/shop?category=dry-fruits&sort=price-asc', '/shop?page=2', '/shop?min=300&max=700&stock=1',
  '/category/dry-fruits', '/category/pistachios', '/product/iranian-pistachios', '/product/royal-dry-fruit-gift-box',
  '/collections', '/collections/gifting', '/gift-hampers', '/bestsellers', '/offers',
  '/about', '/contact', '/faq', '/shipping', '/refunds', '/privacy', '/terms',
  '/cart', '/login', '/login?next=/checkout',
  '/sitemap.xml', '/robots.txt', '/does-not-exist', '/product/not-a-product', '/category/nope',
];
// these must send a signed-out visitor to the sign-in page
const PROTECTED = ['/checkout', '/account', '/account/orders', '/account/addresses', '/account/wishlist', '/account/profile'];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const rows = [];

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport, locale: 'en-IN' });
  await context.addInitScript(() => { try { sessionStorage.setItem('gp.splash', '1'); } catch {} });
  for (const path of [...ROUTES, ...PROTECTED].filter((p) => !only || only.includes(p))) {
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 160)}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 160)}`));
    // background link prefetches (?_rsc=) are cut off when the page closes; that is the crawler's doing, not a failure
    page.on('requestfailed', (r) => r.url().includes('_rsc=') && r.failure()?.errorText === 'net::ERR_ABORTED' ? undefined : problems.push(`failed: ${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/_next/image')) problems.push(`http ${r.status()}: ${r.url().slice(0, 100)}`); });
    let status = 0;
    let finalPath = path;
    let info = {};
    try {
      const response = await page.goto(base + path, { waitUntil: 'load', timeout: 90_000 });
      status = response?.status() ?? 0;
      await page.waitForTimeout(900);
      finalPath = new URL(page.url()).pathname + new URL(page.url()).search;
      if (!/\.(xml|txt)$/.test(path)) {
        info = await page.evaluate(() => ({
          title: document.title,
          h1: document.querySelectorAll('h1').length,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          brokenImages: [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc).map((i) => i.currentSrc.slice(0, 80)).length,
        }));
      }
    } catch (error) {
      problems.push(`navigation: ${String(error).slice(0, 120)}`);
    }
    rows.push({ label, path, status, finalPath, ...info, problems: [...new Set(problems)] });
    await page.close();
  }
  await context.close();
}
await browser.close();

let bad = 0;
for (const r of rows) {
  const expected404 = /does-not-exist|not-a-product|\/nope/.test(r.path);
  const redirected = PROTECTED.includes(r.path);
  const okStatus = expected404 ? r.status === 404 : r.status === 200;
  const okRedirect = !redirected || r.finalPath.startsWith('/login');
  const issues = [];
  if (!okStatus) issues.push(`status ${r.status}`);
  if (!okRedirect) issues.push(`expected sign-in redirect, ended at ${r.finalPath}`);
  if (r.overflow) issues.push('sideways scroll');
  if (r.brokenImages) issues.push(`${r.brokenImages} broken image(s)`);
  if (r.h1 !== undefined && !expected404 && !redirected && r.h1 !== 1 && !r.path.startsWith('/login')) issues.push(`${r.h1} h1`);
  const real = r.problems.filter((p) => !(expected404 && /http 404|Failed to load resource.*404/.test(p)) && !(redirected && /http 40[13]/.test(p)));
  issues.push(...real);
  if (issues.length) bad++;
  console.log(`${issues.length ? 'FAIL' : ' ok '} ${r.label.padEnd(7)} ${r.path.padEnd(46)} ${String(r.status).padEnd(4)} ${(r.title ?? '').slice(0, 44)}${issues.length ? '\n        -> ' + issues.join('\n        -> ') : ''}`);
}
console.log(`\n${rows.length} page loads, ${bad} with problems`);
process.exitCode = bad ? 1 : 0;
