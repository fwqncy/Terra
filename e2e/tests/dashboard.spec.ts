import { expect, test } from '@playwright/test';

test.describe('logistics dashboard', () => {
  test('shows KPIs, charts with legends and a table view', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByText('On-time delivery')).toBeVisible();
    await expect(page.locator('app-kpi-tile').first()).toContainText('%');
    const throughput = page.locator('section.card', { has: page.getByRole('heading', { name: /Throughput by mode/ }) });
    await expect(throughput.getByRole('list', { name: 'Legend' })).toContainText('Road');
    await throughput.getByRole('button', { name: 'View as table' }).click();
    await expect(throughput.getByRole('table')).toBeVisible();
  });

  test('filters and tabs live in the URL', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Air' }).click();
    await expect(page).toHaveURL(/mode=air/);
    await page.getByRole('group', { name: 'Time range' }).getByRole('button', { name: 'Last 48 h' }).click();
    await expect(page).toHaveURL(/range=48/);
    await page.goBack();
    await expect(page).not.toHaveURL(/range=48/);
  });

  test('shipments sort, filter, open and export', async ({ page }) => {
    await page.goto('/dashboard?tab=shipments');
    const charge = page.getByRole('columnheader', { name: /Charge/ });
    await charge.getByRole('button').click();
    await expect(page).toHaveURL(/sort=costAud/);
    await expect(charge).toHaveAttribute('aria-sort', 'ascending');

    await page.getByLabel('Status').selectOption('Delivered');
    await expect(page).toHaveURL(/status=Delivered/);
    await expect(page.locator('tbody .badge').first()).toContainText('Delivered');

    await page.getByRole('button', { name: /^TRA-/ }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Booked');
    await page.keyboard.press('Escape');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/^terra-shipments-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('expediting a shipment confirms the new ETA', async ({ page }) => {
    await page.goto('/dashboard?tab=shipments&status=In%20Transit');
    await page.getByRole('button', { name: 'Expedite', exact: true }).first().click();
    await expect(page.getByRole('status').filter({ hasText: 'expedited' })).toBeVisible();
  });

  test('every tab renders', async ({ page }) => {
    for (const [tab, text] of [['lanes', 'Lane performance'], ['fleet', 'Carrier scorecard'], ['sustainability', 'Mode-shift what-if'], ['ai', 'Brain library']]) {
      await page.goto(`/dashboard?tab=${tab}`);
      await expect(page.getByRole('heading', { name: new RegExp(text) })).toBeVisible();
    }
  });
});
