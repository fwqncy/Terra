import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// A brain exported by Terra Trainer (trainer/py) loads through City Lab's own "Import Brain…" and drives.
const BRAIN = fileURLToPath(new URL('../../trainer/brains/terra-trainer-cmaes.json', import.meta.url));

test('a Terra Trainer brain imports into the brain library and drives', async ({ page }) => {
  await page.goto('/city?mode=train');
  await expect(page.locator('#city-status')).toContainText('Ready to train');
  await page.locator('label', { hasText: 'Import Brain' }).locator('input[type=file]').setInputFiles(BRAIN);
  await expect(page.getByText('Imported “Terra Trainer CMA-ES (all maps)”')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Terra Trainer CMA-ES (all maps)' })).toBeVisible();
  await expect(page.locator('#seed option:checked')).toHaveText('Terra Trainer CMA-ES (all maps)');

  // Choosing it in the "Starting brain" list reseeds the trainer, so generation 1's leader is this brain.
  await page.locator('#seed').selectOption('factory');
  await page.locator('#seed').selectOption({ label: 'Terra Trainer CMA-ES (all maps)' });
  await page.locator('#pop').fill('20'); // a light run, so it doesn't starve tests running in parallel
  await page.getByRole('button', { name: 'Start Training' }).click();
  await page.getByRole('button', { name: '2×' }).click();
  // It completes City Lab's default Brisbane route (756 m) in the C++ sim and in Node; here the leader
  // must drive at least 95% of it in generation 1. An arrival ends the generation within the same frame,
  // so the "arrived" count is not a reliable signal; the status is read every animation frame instead.
  await page.waitForFunction(
    () => /Gen 1 · .* leader (9[5-9]|100)(\.\d)?%/.test(document.querySelector('#city-status')?.textContent ?? ''),
    null,
    { polling: 'raf', timeout: 45_000 },
  );
});
