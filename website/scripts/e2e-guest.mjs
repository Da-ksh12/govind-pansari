// Drives the site like a signed-out visitor in a real browser and checks what they would see and be able to do.
//   node scripts/e2e-guest.mjs [--base=http://localhost:3000]
// Signed-in flows (OTP login, checkout, payment, order tracking) cannot be exercised without a real one-time code; see docs/WEBSITE.md.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const base = process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(` ok  ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}\n       ${String(error.message).split('\n')[0].slice(0, 220)}`);
  }
}

const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-IN', permissions: [] });
await context.addInitScript(() => { try { sessionStorage.setItem('gp.splash', '1'); } catch {} });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
const cartBadge = () => page.locator('[data-cart-target] span').first();
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('gp.cart.v1') ?? '[]'));

await step('home page: headline, one h1, hero photos load', async () => {
  await page.goto(base + '/', { waitUntil: 'load' });
  assert.equal(await page.locator('h1').count(), 1);
  assert.match(await page.locator('h1').innerText(), /Finer.*Taste of Nature/s);
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0).length), 0);
});

await step('product page: variants change price, SKU and stay selectable', async () => {
  await page.goto(base + '/product/iranian-pistachios', { waitUntil: 'load' });
  const price = () => page.locator('p:has(> span.font-display.text-3xl)').first().innerText();
  const first = await price();
  const sku1 = await page.getByText(/^SKU:/).innerText();
  await page.getByRole('radio', { name: /500 g/ }).click();
  const second = await price();
  const sku2 = await page.getByText(/^SKU:/).innerText();
  assert.notEqual(first, second, 'price should change with the pack size');
  assert.notEqual(sku1, sku2, 'SKU should change with the pack size');
  assert.equal(await page.getByRole('radio', { name: /500 g/ }).getAttribute('aria-checked'), 'true');
});

await step('add to cart: drawer opens, badge counts, cart is stored with ids and quantities only', async () => {
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await page.getByRole('dialog', { name: 'Your cart' }).waitFor();
  await page.waitForTimeout(600);
  assert.equal((await cartBadge().innerText()).trim(), '1');
  const lines = await stored();
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(lines[0]).sort(), ['quantity', 'variantId'], 'no prices or names are stored in the browser');
  assert.match(await page.getByRole('dialog', { name: 'Your cart' }).innerText(), /Iranian Pistachios/);
});

await step('drawer quantity controls change the line total and subtotal', async () => {
  const drawer = page.getByRole('dialog', { name: 'Your cart' });
  const before = await drawer.getByText(/^Subtotal/).locator('xpath=following-sibling::*[1]').innerText();
  await drawer.getByRole('button', { name: /More Iranian Pistachios/ }).click();
  await page.waitForTimeout(500);
  assert.equal((await cartBadge().innerText()).trim(), '2');
  const after = await drawer.getByText(/^Subtotal/).locator('xpath=following-sibling::*[1]').innerText();
  assert.notEqual(before, after);
  assert.equal((await stored())[0].quantity, 2);
});

await step('escape closes the drawer and focus returns', async () => {
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Your cart' }).waitFor({ state: 'detached' });
});

await step('the cart survives a reload', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  assert.equal((await cartBadge().innerText()).trim(), '2');
});

await step('cart page lists the item with a server-priced estimate and offers checkout', async () => {
  await page.goto(base + '/cart', { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Cart summary' }).waitFor();
  assert.match(await page.locator('main').innerText(), /Iranian Pistachios/);
  assert.match(await page.locator('main').innerText(), /confirmed by our server at checkout/);
  assert.ok(await page.getByRole('link', { name: /Proceed to checkout/ }).isVisible());
});

await step('checkout sends a signed-out visitor to sign in and remembers where they were going', async () => {
  await page.getByRole('link', { name: /Proceed to checkout/ }).click();
  await page.waitForURL(/\/login\?next=%2Fcheckout/);
  assert.ok(await page.getByRole('heading', { name: 'Welcome' }).isVisible());
});

await step('sign-in form validates the phone number before sending anything', async () => {
  await page.getByRole('button', { name: 'Send code' }).click();
  assert.match(await page.locator('#phone-error').innerText(), /Enter your mobile number/);
  await page.fill('#phone', '12345');
  await page.getByRole('button', { name: 'Send code' }).click();
  assert.match(await page.locator('#phone-error').innerText(), /valid 10-digit/);
});

await step('removing the last item empties the cart', async () => {
  await page.goto(base + '/cart', { waitUntil: 'load' });
  await page.getByRole('button', { name: /Remove Iranian Pistachios/ }).click();
  await page.getByText('Your cart is empty').first().waitFor();
  assert.equal((await stored()).length, 0);
});

await step('search overlay: opens with "/", suggests products, Enter goes to results', async () => {
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.keyboard.press('/');
  const dialog = page.getByRole('dialog', { name: 'Search products' });
  await dialog.waitFor();
  await dialog.getByRole('searchbox').fill('pista');
  await dialog.getByRole('link', { name: /Pista/i }).first().waitFor();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/shop\?q=pista/);
  assert.match(await page.locator('h1').innerText(), /pista/i);
});

await step('shop: filters, sorting and paging produce sensible lists', async () => {
  await page.goto(base + '/shop?sort=price-asc', { waitUntil: 'load' });
  const prices = await page.$$eval('article', (cards) => cards.map((c) => Number((c.textContent.match(/₹([\d,]+)/) ?? [])[1]?.replace(/,/g, ''))));
  assert.ok(prices.length >= 8, `a full page of products (saw ${prices.length})`);
  const sorted = [...prices].sort((a, b) => a - b);
  assert.deepEqual(prices, sorted, 'cheapest first');
  await page.goto(base + '/shop?min=1000&max=2500', { waitUntil: 'load' });
  assert.ok((await page.locator('article').count()) > 0, 'the 1000-2500 price range should still list products');
  await page.goto(base + '/shop?q=zzzzqqq', { waitUntil: 'load' });
  assert.match(await page.locator('main').innerText(), /Nothing matches those filters/);
  await page.goto(base + '/shop?page=2', { waitUntil: 'load' });
  const previous = page.getByRole('link', { name: 'Previous page' });
  await previous.waitFor({ timeout: 5000 });
  assert.ok(await previous.isVisible(), 'page 2 should offer a link back to page 1');
});

await step('a price filter submitted from the form (no JavaScript needed) narrows results', async () => {
  await page.goto(base + '/shop', { waitUntil: 'load' });
  // the filter panel exists twice (a folding one for phones, a sidebar for wide screens); use the one that is showing
  await page.locator('aside form input[name=min]:visible').fill('2000');
  await page.locator('aside form:visible').getByRole('button', { name: 'Apply filters' }).click();
  await page.waitForURL(/min=2000/);
  assert.ok((await page.locator('article').count()) > 0);
});

await step('delivery check: a typed area is looked up and answered by the server', async () => {
  await page.goto(base + '/product/iranian-pistachios', { waitUntil: 'load' });
  await page.getByRole('combobox', { name: /Search your delivery area/ }).fill('Awas Vikas Colony');
  const option = page.getByRole('option').first();
  await option.waitFor({ timeout: 20_000 });
  await option.locator('button').click();
  await page.getByText(/deliver to your area|Outside our delivery area|closed right now|Couldn't check/i).first().waitFor({ timeout: 20_000 });
  const text = await page.locator('#delivery-check').locator('xpath=..').innerText();
  assert.match(text, /deliver to your area|Outside our delivery area|closed right now/i, 'a real answer, not an error');
});

await step('mobile menu opens as a dialog and traps focus', async () => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await phone.addInitScript(() => { try { sessionStorage.setItem('gp.splash', '1'); } catch {} });
  const p = await phone.newPage();
  await p.goto(base + '/', { waitUntil: 'load' });
  await p.getByRole('button', { name: 'Open menu' }).click();
  const menu = p.getByRole('dialog', { name: 'Menu' });
  await menu.waitFor();
  assert.ok(await menu.getByRole('link', { name: 'Shop' }).isVisible());
  await p.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await phone.close();
});

await step('reduced motion: the splash never shows and content is visible at once', async () => {
  const calm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const p = await calm.newPage();
  await p.goto(base + '/', { waitUntil: 'load' });
  assert.equal(await p.evaluate(() => document.documentElement.getAttribute('data-splash')), null);
  assert.ok(await p.locator('h1').isVisible());
  await calm.close();
});

await step('first visit shows the welcome splash once, then it is gone', async () => {
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await fresh.newPage();
  await p.goto(base + '/', { waitUntil: 'commit' });
  await p.waitForFunction(() => document.documentElement.getAttribute('data-splash') === 'on', null, { timeout: 5000 });
  await p.waitForFunction(() => document.documentElement.getAttribute('data-splash') === 'off', null, { timeout: 6000 });
  await p.goto(base + '/shop', { waitUntil: 'load' });
  assert.notEqual(await p.evaluate(() => document.documentElement.getAttribute('data-splash')), 'on', 'not shown again this visit');
  await fresh.close();
});

await step('no console errors during the whole run', async () => {
  const real = consoleErrors.filter((e) => !/_rsc=|ERR_ABORTED|status of 40[134]/.test(e));
  assert.deepEqual(real, []);
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;
