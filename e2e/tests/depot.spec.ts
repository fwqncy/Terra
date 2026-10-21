import { expect, test } from '@playwright/test';

test.describe('the Depot idle game', () => {
  test('clicking earns coins that buy vehicles', async ({ page }) => {
    await page.goto('/depot');
    const dispatch = page.getByRole('button', { name: /Dispatch!/ });
    for (let i = 0; i < 16; i++) await dispatch.click();
    await page.getByRole('button', { name: /Buy 1 Courier Bike/ }).click();
    await expect(page.getByRole('heading', { name: /Courier Bike ×1/ })).toBeVisible();
    await expect(page.locator('p.rate')).toContainText('0.1 per second');
  });

  test('unaffordable purchases explain what is missing', async ({ page }) => {
    await page.goto('/depot');
    await page.getByRole('button', { name: /Buy 1 Delivery Van/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Not enough coins' })).toBeVisible();
  });

  test('offline earnings are paid when you come back', async ({ page }) => {
    const threeHoursAgo = Date.now() - 3 * 3600_000;
    await page.addInitScript((lastSeen) => {
      localStorage.setItem('terra.save.v1', JSON.stringify({ coins: 10, lifetime: 10, generators: { van: 5 }, lastSeen }));
    }, threeHoursAgo);
    await page.goto('/depot');
    const modal = page.getByRole('dialog', { name: /Your fleet kept/ });
    await expect(modal).toBeVisible();
    // 5 vans × 1 coin/s × 2 h cap × 50% = 18,000
    await expect(modal).toContainText('18');
    await modal.getByRole('button', { name: /Collect/ }).click();
    await expect(modal).toBeHidden();
  });

  test('cosmetics can be bought and equipped', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('terra.save.v1', JSON.stringify({ coins: 5000, lifetime: 5000, lastSeen: Date.now() })));
    await page.goto('/depot?tab=garage');
    await page.getByRole('button', { name: /Buy · 1.5K/ }).click();
    await expect(page.getByRole('button', { name: 'Equipped' }).first()).toBeVisible();
  });

  test('resetting asks for confirmation first', async ({ page }) => {
    await page.goto('/depot');
    await page.getByRole('button', { name: 'Reset Progress…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reset all Depot progress?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});
