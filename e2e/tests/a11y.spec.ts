import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGES = ['/', '/city', '/city?mode=train&view=3d', '/routes', '/ops', '/dashboard', '/dashboard?tab=shipments', '/depot', '/settings'];

test.describe('accessibility', () => {
  for (const path of PAGES) {
    test(`${path} has no serious axe violations and one h1`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        // colour contrast is governed by APCA (see theme tests); canvases are labelled images
        .disableRules(['color-contrast'])
        .analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
    });
  }

  test('icon-only buttons all have accessible names', async ({ page }) => {
    for (const path of ['/', '/city', '/dashboard', '/depot']) {
      await page.goto(path);
      const unnamed = await page.locator('button').evaluateAll((buttons) =>
        buttons.filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim() || b.getAttribute('aria-labelledby'))).length,
      );
      expect(unnamed, `unnamed buttons on ${path}`).toBe(0);
    }
  });
});
