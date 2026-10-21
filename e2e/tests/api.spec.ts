import { expect, test } from '@playwright/test';

/** Full-stack checks: Angular ⇄ .NET API ⇄ SQL + NoSQL. */
test.describe('backend integration', () => {
  test('the app detects the API and reads server-side logistics', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.locator('.api')).toHaveAttribute('data-status', 'online');
    await page.getByRole('button', { name: 'API', exact: true }).click();
    await expect(page.locator('app-kpi-tile').first()).toContainText('%');
  });

  test('a trained brain is stored in the NoSQL library', async ({ page, request }) => {
    const name = `E2E ${Date.now()}`;
    await page.goto('/city?mode=train');
    await page.getByRole('button', { name: 'Start Training' }).click();
    await page.getByRole('button', { name: '10×' }).click();
    await expect(page.locator('#city-status')).toContainText(/Gen [2-9]/, { timeout: 30_000 });
    await page.getByRole('textbox', { name: 'Brain name' }).fill(name);
    await page.getByRole('button', { name: 'Save Brain' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'cloud brain library' })).toBeVisible();
    const brains = await (await request.get('http://localhost:5080/api/brains?domain=city&take=100')).json();
    expect(brains.map((b: { name: string }) => b.name)).toContain(name);
  });

  test('saves sync to SQL Server and appear on the leaderboard', async ({ page, request }) => {
    await page.goto('/depot');
    for (let i = 0; i < 20; i++) await page.getByRole('button', { name: /Dispatch!/ }).click();
    await page.getByRole('button', { name: 'Sync Now' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Save synced' })).toBeVisible();
    const board = await (await request.get('http://localhost:5080/api/leaderboard?take=100')).json();
    expect(board.length).toBeGreaterThan(0);
  });

  test('OpenAPI is published for the Power Platform connector', async ({ request }) => {
    const v2 = await (await request.get('http://localhost:5080/swagger/v1/swagger-v2.json')).json();
    expect(v2.swagger).toBe('2.0');
    expect(Object.keys(v2.paths)).toContain('/api/logistics/shipments');
  });
});
