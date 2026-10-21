import { expect, test } from '@playwright/test';

/** Runs in the "mobile" project (Pixel 7). */
test.describe('phone layout', () => {
  for (const path of ['/', '/city', '/dashboard', '/depot', '/settings']) {
    test(`${path} fits the screen without sideways scrolling`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test('the menu drawer opens and navigates', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const drawer = page.getByRole('dialog', { name: 'Menu' });
    await drawer.getByRole('link', { name: /Depot/ }).click();
    await expect(page).toHaveURL(/\/depot/);
  });

  test('inputs are at least 16px so iOS never zooms', async ({ page }) => {
    await page.goto('/settings');
    const size = await page.getByLabel('Display name').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });
});
