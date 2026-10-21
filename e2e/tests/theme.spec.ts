import { expect, test } from '@playwright/test';

test.describe('theming', () => {
  test('Nightshift is the default and light/dark toggles with theme-color', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-preset', 'nightshift');
    await expect(html).toHaveAttribute('data-mode', 'dark');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#24201A');

    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(html).toHaveAttribute('data-mode', 'light');
    await expect(page.locator('meta[name="theme-color"]')).not.toHaveAttribute('content', '#24201A');
  });

  test('presets and the colour wheel apply and persist', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('radio', { name: /Brooklyn Dusk/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'dusk');

    const wheel = page.getByRole('slider', { name: /hue and saturation/ });
    await wheel.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'custom');

    const hex = page.getByLabel('Hex');
    await hex.fill('#00AA88');
    await expect(page.getByRole('radio', { name: /Primary/ })).toContainText('#00AA88');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-preset', 'custom');
    await expect(page.getByRole('radio', { name: /Primary/ })).toContainText('#00AA88');
  });

  test('every preset passes the APCA contrast check in both modes', async ({ page }) => {
    await page.goto('/settings');
    for (const preset of ['Nightshift', 'Brooklyn Dusk', 'Ink & Halftone']) {
      for (const mode of ['Light', 'Dark']) {
        await page.getByRole('radio', { name: new RegExp(preset) }).click();
        await page.getByRole('group', { name: 'Colour mode' }).getByRole('button', { name: mode }).click();
        await expect(page.locator('table.contrast tbody')).not.toContainText('Low');
      }
    }
  });

  test('reduced motion is honoured', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
    await ctx.close();
  });
});
