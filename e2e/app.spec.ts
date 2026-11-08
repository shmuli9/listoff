import { expect, test, type Page, type BrowserContext } from '@playwright/test';

const API = 'http://localhost:8787';
const LIST = '/#/list/l1';

test.beforeEach(async ({ request }) => { await request.post(API + '/__reset'); });

async function login(page: Page, user = 'alice') {
  await page.goto('/');
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: /Weekly shop/ })).toBeVisible();
}
async function open(page: Page, user = 'alice') {
  await login(page, user);
  await page.getByRole('link', { name: /Weekly shop/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toBeVisible();
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished)));
}
const add = async (page: Page, t: string) => { const i = page.getByLabel('Add an item'); await i.fill(t); await i.press('Enter'); };
const synced = (page: Page) => expect(page.getByTestId('sync')).toHaveCount(0, { timeout: 10000 });
const order = (page: Page) => page.locator('.row[data-active] .name').allInnerTexts();
async function setOffline(ctx: BrowserContext, page: Page, v: boolean) {
  await ctx.setOffline(v);
  await page.evaluate((off) => dispatchEvent(new Event(off ? 'offline' : 'online')), v);
}
async function swipe(page: Page, sel: string, dx: number) {
  const box = (await page.locator(sel).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const y = box.y + box.height / 2, x0 = box.x + box.width / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / 8, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('legacy data loads, grouped by category', async ({ page }) => {
  await open(page);
  await expect(page.locator('.cat-head')).toHaveText(['Produce', 'Dairy & Eggs', 'Bakery']);
  await expect(page.locator('.qty')).toHaveText('2');
});

test('smart add parses quantity and files the category', async ({ page }) => {
  await open(page);
  await add(page, '3 x shampoo');
  const row = page.locator('.row', { hasText: 'shampoo' });
  await expect(row.locator('.qty')).toHaveText('3');
  await expect(page.locator('.cat-head', { hasText: 'Toiletries' })).toBeVisible();
  await expect(page.getByLabel('Add an item')).toBeFocused();
  await synced(page);
  await page.reload();
  await expect(page.locator('.row', { hasText: 'shampoo' })).toBeVisible();
});

test('suggestions re-add from history', async ({ page }) => {
  await open(page);
  await page.getByLabel('Add an item').fill('oa');
  await page.getByRole('option', { name: /Oats/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Oats' })).toBeVisible();
});

test('tick moves to Done after settling, undo-free untick, clear with undo', async ({ page }) => {
  await open(page);
  const milk = page.getByRole('checkbox', { name: 'Milk' });
  await milk.click();
  await expect(milk).toBeChecked();
  await expect(page.locator('.row[data-key="i1"]')).toHaveAttribute('data-active', ''); // still in place while settling
  await expect(page.locator('.cat-head', { hasText: 'Done' })).toBeVisible({ timeout: 3000 });
  await page.getByRole('button', { name: 'Clear 1 done' }).click();
  await expect(milk).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toBeChecked();
});

test('editor saves changes', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Edit Bread' }).click();
  await page.getByLabel('Note').fill('sourdough');
  await page.getByLabel('Category').selectOption('Frozen');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.note', { hasText: 'sourdough' })).toBeVisible();
  await expect(page.locator('.cat-head', { hasText: 'Frozen' })).toBeVisible();
});

async function drag(page: Page, name: string, toY: (b: { y: number; height: number }) => number, targetBox: { y: number; height: number }) {
  const b = (await page.getByRole('button', { name: `Reorder ${name}` }).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, toY(targetBox), { steps: 12 });
  await page.waitForTimeout(120);
  await page.mouse.up();
}

test('drag reorders within a category and survives reload', async ({ page }) => {
  await open(page);
  expect((await order(page)).slice(0, 2)).toEqual(['Apples', 'Bananas']);
  const t = (await page.locator('.row[data-key="i3"]').boundingBox())!;
  await drag(page, 'Bananas', (x) => x.y + 4, t);
  await expect.poll(async () => (await order(page)).slice(0, 2)).toEqual(['Bananas', 'Apples']);
  await synced(page);
  await page.reload();
  await expect.poll(async () => (await order(page)).slice(0, 2)).toEqual(['Bananas', 'Apples']);
});

test('drag across a heading changes category, with undo', async ({ page }) => {
  await open(page);
  const t = (await page.locator('.row[data-key="i2"]').boundingBox())!;
  await drag(page, 'Bread', (x) => x.y + x.height / 2, t);
  await expect(page.getByText('Moved Bread to Dairy & Eggs')).toBeVisible();
  await expect(page.locator('.cat-head', { hasText: 'Bakery' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.cat-head', { hasText: 'Bakery' })).toBeVisible();
});

test('swipe right ticks, swipe left deletes with undo', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'CDP touch is Chromium only');
  await open(page);
  await swipe(page, '.row[data-key="i4"] .item', 150);
  await expect(page.getByRole('checkbox', { name: 'Bananas' })).toBeChecked();
  await swipe(page, '.row[data-key="i5"] .item', -150);
  await expect(page.getByRole('checkbox', { name: 'Bread' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('checkbox', { name: 'Bread' })).toBeVisible();
});

test('offline edits survive a restart and sync later', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'WebKit offline emulation with reload is unreliable on Windows');
  await open(page);
  await page.waitForFunction(() => navigator.serviceWorker.ready.then((r) => !!r.active));
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await setOffline(context, page, true);
  await add(page, 'Offline olives');
  await expect(page.getByTestId('sync')).toContainText('Offline');
  await page.reload(); // served entirely from the service worker + local store
  await expect(page.getByRole('checkbox', { name: 'Offline olives' })).toBeVisible();
  await setOffline(context, page, false);
  await synced(page);
  await page.evaluate(() => localStorage.clear());
  await login(page);
  await page.getByRole('link', { name: /Weekly shop/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Offline olives' })).toBeVisible();
});

test('failed saves retry, and a poll cannot lose pending edits', async ({ page, request }) => {
  await open(page);
  await request.post(API + '/__config', { data: { failPuts: 2 } });
  await add(page, 'Retry radish');
  await expect(page.getByTestId('sync')).toContainText('Retrying', { timeout: 5000 });
  await page.evaluate(() => dispatchEvent(new Event('focus'))); // triggers a refresh mid-retry
  await page.waitForTimeout(300);
  await expect(page.getByRole('checkbox', { name: 'Retry radish' })).toBeVisible();
  await synced(page);
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Retry radish' })).toBeVisible();
});

test('two people editing at once converge', async ({ page, browser, playwright: _ }, info) => {
  const ctx2 = await browser.newContext({ ...info.project.use, baseURL: 'http://localhost:4173' });
  const bob = await ctx2.newPage();
  await open(page); await open(bob, 'bob');
  await add(page, 'Alice apricots'); await add(bob, 'Bob beetroot');
  await synced(page); await synced(bob);
  for (const p of [page, bob]) {
    await p.evaluate(() => dispatchEvent(new Event('focus')));
    await p.reload();
    await expect(p.getByRole('checkbox', { name: 'Alice apricots' })).toBeVisible();
    await expect(p.getByRole('checkbox', { name: 'Bob beetroot' })).toBeVisible();
  }
  await ctx2.close();
});

test('favourites, activity, import, rename', async ({ page }) => {
  await open(page);
  await page.getByRole('link', { name: 'Favourites' }).click();
  await page.getByRole('button', { name: 'Favourite Oats' }).click();
  await expect(page.locator('.shelf-row').first()).toContainText('Oats');
  await page.getByRole('button', { name: 'Add Oats' }).click();
  await expect(page.getByRole('button', { name: 'Oats is on the list' })).toBeVisible();
  await page.getByRole('link', { name: 'Activity' }).click();
  await expect(page.locator('.log').first()).toContainText('added Oats');
  await page.getByRole('link', { name: 'Manage' }).click();
  await page.getByLabel(/Paste an AnyList/).fill('Baking:\n- xanthan gum\n2 x flour');
  await page.getByRole('button', { name: 'Import 2 items' }).click();
  await expect(page.getByRole('checkbox', { name: 'xanthan gum' })).toBeVisible();
  await page.getByRole('link', { name: 'Manage' }).click();
  await page.getByLabel('List name').fill('Big shop');
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.locator('.topbar h1')).toHaveText('Big shop');
});

test('create and delete a list removes its gist', async ({ page, request }) => {
  await login(page);
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByLabel('Name').fill('Party');
  await page.getByRole('button', { name: 'Create list' }).click();
  await expect(page.locator('.topbar h1')).toHaveText('Party');
  const before = (await (await request.get(API + '/__gists')).json()).ids.length;
  await page.getByRole('link', { name: 'Manage' }).click();
  await page.getByRole('button', { name: 'Delete this list' }).click();
  await page.getByRole('button', { name: /Tap again/ }).click();
  await expect(page.getByRole('link', { name: /Weekly shop/ })).toBeVisible();
  expect((await (await request.get(API + '/__gists')).json()).ids.length).toBe(before - 1);
});

test('wrong password shows an error', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Username').fill('alice');
  await page.getByLabel('Password').fill('nope');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wrong username or password');
});

test('sign out wipes cached lists', async ({ page }) => {
  await open(page);
  await page.goto('/#/account');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Username')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('listoff.doc') || k === 'listoff.token'))).toEqual([]);
});

test('mobile layout: no sideways scroll, 44px targets, inputs do not zoom iOS', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    small: [...document.querySelectorAll('.tick,.grip,.add-btn,.bottom-nav a')].filter((e) => { const b = e.getBoundingClientRect(); return b.height < 44 || b.width < 44; }).length,
    font: parseFloat(getComputedStyle(document.querySelector('input')!).fontSize),
  }));
  expect(r).toEqual({ overflow: 0, small: 0, font: 16 });
});

test('PWA: manifest and iOS metadata', async ({ page, request }) => {
  await page.goto('/');
  const m = await (await request.get('/manifest.webmanifest')).json();
  expect(m.display).toBe('standalone');
  expect(m.icons.some((i: any) => i.purpose === 'maskable')).toBe(true);
  await expect(page.locator('link[rel=apple-touch-icon]')).toHaveCount(1);
  await expect(page.locator('meta[name=apple-mobile-web-app-capable]')).toHaveAttribute('content', 'yes');
  expect(await page.locator('link[rel=apple-touch-startup-image]').count()).toBeGreaterThan(5);
});

test('performance: warm launch shows the list from cache without waiting on the API', async ({ page, request }) => {
  await open(page);
  await synced(page);
  await request.post(API + '/__config', { data: { latency: 3000 } }); // a terrible connection
  const t0 = Date.now();
  await page.goto('/' + LIST.slice(1));
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toBeVisible();
  const ms = Date.now() - t0;
  console.log('warm launch ms', ms);
  expect(ms).toBeLessThan(1500);
  // A tick must paint before its network round trip finishes.
  const paint = await page.evaluate(async () => {
    const b = document.querySelector('.row[data-key="i2"] .tick') as HTMLElement;
    const s = performance.now(); b.click();
    await new Promise((r) => requestAnimationFrame(r));
    return { ms: performance.now() - s, on: b.getAttribute('aria-checked') };
  });
  console.log('tick to frame ms', paint.ms);
  expect(paint.on).toBe('true');
  expect(paint.ms).toBeLessThan(100);
});
