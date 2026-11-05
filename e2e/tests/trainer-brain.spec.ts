import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// A brain exported by Terra Trainer (trainer/py) loads through City Lab's own "Import Brain…" and drives.
const BRAIN = fileURLToPath(new URL('../../trainer/brains/terra-trainer-cmaes.json', import.meta.url));
const weightsOf = (network: { levels: { weights: number[][]; biases: number[] }[] }) =>
  network.levels.map((l) => ({ weights: l.weights, biases: l.biases }));

test('a Terra Trainer brain imports into the brain library and drives', async ({ page }) => {
  await page.goto('/city?mode=train');
  await expect(page.locator('#city-status')).toContainText('Ready to train');
  await page.locator('label', { hasText: 'Import Brain' }).locator('input[type=file]').setInputFiles(BRAIN);
  await expect(page.getByText('Imported “Terra Trainer CMA-ES (all maps)”')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Terra Trainer CMA-ES (all maps)' })).toBeVisible();
  await expect(page.locator('#seed option:checked')).toHaveText('Terra Trainer CMA-ES (all maps)');

  // Importing reseeds the trainer: saving straight away stores the imported weights, not the factory brain's.
  await page.locator('#brain-name').fill('Seed check');
  await page.getByRole('button', { name: 'Save Brain' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Seed check' }).click();
  const saved = JSON.parse(fs.readFileSync(await (await download).path(), 'utf8'));
  const imported = JSON.parse(fs.readFileSync(BRAIN, 'utf8'));
  expect(weightsOf(saved.network)).toEqual(weightsOf(imported.network));

  await page.locator('#pop').fill('20'); // a light run, so it doesn't starve tests running in parallel
  await page.getByRole('button', { name: 'Start Training' }).click();
  await page.getByRole('button', { name: '2×' }).click();
  // It completes City Lab's default Brisbane route (756 m) in the C++ sim and in Node; here the leader
  // (generation 1's elite is the imported brain) must drive at least 95% of it. An arrival ends the
  // generation within the same frame, so the "arrived" count is not a reliable signal; the status is
  // read every animation frame instead.
  await page.waitForFunction(
    () => /Gen 1 · .* leader (9[5-9]|100)(\.\d)?%/.test(document.querySelector('#city-status')?.textContent ?? ''),
    null,
    { polling: 'raf', timeout: 45_000 },
  );
});
