import { expect, test } from '@playwright/test';

test.describe('City Lab', () => {
  test('loads the real Brisbane network with a ready-made route', async ({ page }) => {
    await page.goto('/city');
    await expect(page).toHaveTitle('City Lab · Terra');
    await expect(page.locator('#city-status')).toContainText(/\d+ intersections/);
    await expect(page.getByText(/Route: [\d,]+ m through \d+ road segments/)).toBeVisible();
    await expect(page.getByText(/Built in \d+\s?ms \(Web Worker\)/)).toBeVisible();
  });

  test('tools switch by keyboard shortcut', async ({ page }) => {
    await page.goto('/city');
    await expect(page.locator('#city-status')).toContainText('intersections');
    await page.keyboard.press('h');
    await expect(page.getByRole('button', { name: /^Pan/ })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('t');
    await expect(page.getByRole('button', { name: /^Target/ })).toHaveAttribute('aria-pressed', 'true');
  });

  test('drawing a road adds an intersection', async ({ page }) => {
    await page.goto('/city?map=sandbox');
    await expect(page.locator('#city-status')).toContainText('0 intersections');
    await page.getByRole('button', { name: /^Roads/ }).click();
    const canvas = page.locator('canvas.canvas');
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
    await expect(page.locator('#city-status')).toContainText('2 intersections · 1 roads');
  });

  test('cars train on the route and the URL remembers the mode', async ({ page }) => {
    await page.goto('/city');
    await page.getByRole('link', { name: 'Train', exact: true }).click();
    await expect(page).toHaveURL(/mode=train/);
    await page.getByRole('button', { name: 'Start Training' }).click();
    await page.getByRole('button', { name: '10×' }).click();
    await expect(page.locator('#city-status')).toContainText(/Gen \d+ · \d+\/\d+ driving/);
    await expect(page.locator('#city-status')).toContainText(/Gen [2-9]/, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Stop Training' }).click();
  });

  test('the 3D view orbits the same city while the cars train', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/city?mode=train');
    await page.getByRole('link', { name: '3D View' }).click();
    await expect(page).toHaveURL(/view=3d/);
    await expect(page.getByRole('link', { name: '3D View' })).toHaveAttribute('aria-current', 'page');
    const scene = page.getByRole('application', { name: /in 3D/ });
    await expect(scene).toHaveClass(/is-ready/, { timeout: 30_000 });
    await expect(page.getByText('Drag to orbit · right-drag to pan · scroll to zoom')).toBeVisible();

    await page.getByRole('button', { name: 'Start Training' }).click();
    await expect(page.locator('#city-status')).toContainText(/Gen \d+ · \d+\/\d+ driving/);
    const box = (await scene.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2 - 60, { steps: 12 });
    await page.mouse.up();
    await page.mouse.wheel(0, -400);
    await expect(page.locator('#city-status')).toContainText(/driving/);

    // editing happens in 2D: picking a tool hands the map back
    await page.getByRole('link', { name: 'Build', exact: true }).click();
    await page.keyboard.press('r');
    await expect(page).not.toHaveURL(/view=3d/);
    await expect(scene).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('the M1 motorway trainer runs', async ({ page }) => {
    await page.goto('/city?mode=motorway');
    await page.getByRole('button', { name: 'Start the M1 Trainer' }).click();
    await expect(page.locator('#city-status')).toContainText(/leader passed \d+ cars/);
  });
});
