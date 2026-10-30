// Automated accessibility audit (axe-core, WCAG 2.1 A/AA rules) of the main pages at desktop and phone width, in light mode.
//   node scripts/a11y.mjs [--base=http://localhost:3000]
// It finds the machine-checkable problems (contrast, names, landmarks, ARIA misuse). It cannot judge reading order or screen-reader experience.
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const base = process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000';
const paths = ['/', '/shop', '/category/dry-fruits', '/product/iranian-pistachios', '/cart', '/login', '/collections', '/gift-hampers', '/offers', '/about', '/contact', '/faq', '/shipping', '/privacy', '/404-check'];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
let total = 0;
for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport, colorScheme: 'light' });
  await context.addInitScript(() => { try { sessionStorage.setItem('gp.splash', '1'); } catch {} });
  for (const path of paths) {
    const page = await context.newPage();
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    await page.addScriptTag({ path: axePath });
    const result = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + (n.any[0]?.message ? ' — ' + n.any[0].message.slice(0, 110) : '')), count: v.nodes.length }));
    });
    total += result.length;
    console.log(`${result.length ? 'ISSUES' : '  ok  '} ${label.padEnd(7)} ${path}`);
    for (const v of result) console.log(`        [${v.impact}] ${v.id} (${v.count}) ${v.help}\n          e.g. ${v.nodes[0]}`);
    await page.close();
  }
  await context.close();
}
await browser.close();
console.log(`\n${total} rule violation(s) across ${paths.length * 2} page loads`);
process.exitCode = total ? 1 : 0;
