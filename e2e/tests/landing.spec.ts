import { expect, test } from '@playwright/test';

test.describe('landing page', () => {
  test('tells the story and offers clear next steps', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Terra — Build the roads. Teach the cars.');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Build the roads.');
    await expect(page.getByRole('link', { name: /Start Building/ })).toHaveAttribute('href', '/city');
    for (const chapter of ['City', 'Routes', 'Ops', 'Dashboard', 'Depot']) {
      await expect(page.getByRole('navigation', { name: 'Chapters' }).getByRole('link', { name: new RegExp(chapter) })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Asked before' })).toBeAttached();
  });

  test('skip link moves focus to the main content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });

  test('the live ticker can be paused', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Pause ticker' });
    await toggle.click();
    await expect(page.getByRole('button', { name: 'Resume ticker' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('dispatching from the Depot panel earns coins', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('.p-depot');
    await panel.scrollIntoViewIfNeeded();
    const before = await page.locator('.coins .value').innerText();
    await panel.getByRole('button', { name: /Dispatch!/ }).click();
    await panel.getByRole('button', { name: /Dispatch!/ }).click();
    await expect(page.locator('.coins .value')).not.toHaveText(before);
  });

  test('command palette navigates with the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    const box = page.getByRole('combobox');
    await expect(box).toBeFocused();
    await box.fill('dashboard');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page).toHaveTitle('Logistics Dashboard · Terra');
  });
});
