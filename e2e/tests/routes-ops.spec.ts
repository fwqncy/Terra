import { expect, test } from '@playwright/test';

test.describe('sea and air routes', () => {
  test('quotes the Brisbane → Nouméa sea lane and trains ships', async ({ page }) => {
    await page.goto('/routes?domain=sea&from=PBNE&to=NOUP');
    await expect(page.locator('.quote')).toContainText('Port of Brisbane');
    await expect(page.locator('.quote')).toContainText(/1,4\d\d km/);
    await page.getByRole('button', { name: 'Start Training' }).click();
    await expect(page.locator('#routes-status')).toContainText(/ships under way/);
  });

  test('switches to airways via the URL-backed tabs', async ({ page }) => {
    await page.goto('/routes');
    await page.getByRole('link', { name: 'Air' }).click();
    await expect(page).toHaveURL(/domain=air/);
    await expect(page.getByLabel('From', { exact: true })).toHaveValue('BNE');
  });

  test('the default sea lanes are all in open water', async ({ page }) => {
    await page.goto('/routes?domain=sea');
    await page.getByRole('button', { name: /Chart Lanes/ }).click();
    await expect(page.getByText('Every lane is in open water.')).toBeVisible();
  });
});

test.describe('3D ops floor', () => {
  test('facilities can be selected without a mouse and expanded', async ({ page }) => {
    await page.goto('/ops');
    const port = page.getByRole('button', { name: /Port of Brisbane/ });
    await port.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/hub=PBNE/);
    await expect(page.getByRole('heading', { name: 'Port of Brisbane', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: /Expand to Lv 2/ })).toBeVisible();
  });
});
