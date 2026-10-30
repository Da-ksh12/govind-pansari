// Visual check with the Microsoft Edge already on this machine (no browser download). Usage:
//   node scripts/shots.mjs <name> <path> [width] [height] [--full] [--wait=ms] [--scrollTo=selector] [--skip-splash=0]
// Pictures go to website/.screens/ (git-ignored). Console errors and failed requests are printed so a "pretty" page that is quietly broken shows up.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [name, path = '/', w = '1440', h = '900', ...flags] = process.argv.slice(2);
const flag = (key) => flags.find((f) => f.startsWith(`--${key}`));
const full = !!flag('full');
const wait = Number(flag('wait=')?.split('=')[1] ?? 1500);
const scrollTo = flag('scrollTo=')?.split('=')[1];
const scrollY = flag('scrollY=')?.split('=')[1];
const skipSplash = flag('skip-splash=')?.split('=')[1] !== '0';
const base = process.env.SHOT_BASE ?? 'http://localhost:3000';

mkdirSync('.screens', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1, locale: 'en-IN' });
if (skipSplash) await context.addInitScript(() => { try { sessionStorage.setItem('gp.splash', '1'); } catch {} });
const page = await context.newPage();

const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`[console.${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message.slice(0, 300)}`));
page.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.url().slice(0, 140)} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) problems.push(`[http ${r.status()}] ${r.url().slice(0, 140)}`); });

const response = await page.goto(base + path, { waitUntil: 'load', timeout: 90_000 });
await page.waitForTimeout(wait);
if (scrollTo) {
  await page.locator(scrollTo).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
}
if (scrollY) {
  // scroll in steps so scroll-linked animations (pin, scrub) run exactly as they would for a person scrolling
  const target = Number(scrollY);
  for (let y = 0; y <= target; y += 150) { await page.evaluate((top) => window.scrollTo(0, top), y); await page.waitForTimeout(40); }
  await page.evaluate((top) => window.scrollTo(0, top), target);
  await page.waitForTimeout(1300);
}
if (full) {
  // walk down the page so scroll-triggered reveals fire before the full-page picture is taken
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 500) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
}
const file = `.screens/${name}.png`;
await page.screenshot({ path: file, fullPage: full });
console.log(`status ${response?.status()}  ->  ${file}  (${w}x${h}${full ? ', full page' : ''})`);
console.log(problems.length ? `${problems.length} problem(s):\n${[...new Set(problems)].join('\n')}` : 'no console errors, no failed requests');
await browser.close();
