import { expect, test } from '@playwright/test';

test('a large AnyList export stays fast', async ({ page, request }) => {
  await request.post('http://localhost:8787/__reset');
  await page.goto('/');
  await page.getByLabel('Username').fill('alice');
  await page.getByLabel('Password').fill('correct-horse');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: /Weekly shop/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Milk' })).toBeVisible();

  const history = Array.from({ length: 1500 }, (_, i) => `✓ Product number ${i % 1100} (2)\nSome shop`).join('\n');
  const text = `Big List\n\nDAIRY\n• Still needed cheese (3)\nCorner shop\n${history}\n\nOTHER\n• Spare widget\n`;

  await page.getByRole('link', { name: 'Manage' }).click();
  await page.getByLabel(/Paste an AnyList/).fill(text);
  await expect(page.getByText(/1,100 items already ticked off/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 items' }).click();

  await expect(page.getByRole('checkbox', { name: 'Still needed cheese' })).toBeVisible();
  await expect(page.locator('.note', { hasText: 'Corner shop' })).toBeVisible();
  await expect(page.locator('.row[data-active] .name')).toHaveCount(7); // 5 existing + 2, none of the history
  await expect(page.getByTestId('sync')).toHaveCount(0, { timeout: 10000 });
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Still needed cheese' })).toBeVisible();

  // Type-ahead over the whole history
  const input = page.getByLabel('Add an item');
  const ms = await input.evaluate(async (el: HTMLInputElement) => {
    el.focus(); const s = performance.now();
    el.value = 'number 10'; el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
    return performance.now() - s;
  });
  console.log('type-ahead frame ms over 1,100 entries', ms);
  await expect(page.getByRole('option').first()).toBeVisible();
  expect(ms).toBeLessThan(100);

  await input.evaluate((el: HTMLInputElement) => el.blur());
  const t0 = Date.now();
  await page.getByRole('link', { name: 'Favourites' }).click();
  await expect(page.locator('.shelf-row')).toHaveCount(100);
  console.log('favourites open ms', Date.now() - t0);
  await expect(page.getByText(/Showing your top 100 of 1,10/)).toBeVisible();
  await page.getByLabel('Search').fill('number 399');
  await expect(page.locator('.shelf-row')).toHaveCount(1);
  await expect(page.locator('.shelf-row')).toContainText('added 2 times');
});
