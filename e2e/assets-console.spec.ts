import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email or employee ID').fill('admin@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Admin@12345!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('advanced asset filters apply, removable chips clear them, and cards retain real records', async ({
  page,
}) => {
  await login(page);
  await page.goto('/assets');
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Status', { exact: true }).selectOption('AVAILABLE');
  await page.screenshot({ animations: 'disabled', path: '.local/ui-review-filters.png' });
  await panel.getByRole('button', { name: 'Apply filters' }).click();
  await expect(panel).not.toBeVisible();
  await expect(page).toHaveURL(/status=AVAILABLE/);
  await expect(page.locator('.asset-filter-chips')).toContainText('Available');
  await page.getByRole('button', { name: 'Card view', exact: true }).click();
  await expect(page.locator('.asset-inventory-card').first()).toBeVisible();
  for (const text of await page.locator('.asset-inventory-card .badge').allTextContents())
    expect(text).toBe('Available');
  await page
    .locator('.asset-filter-chips')
    .getByRole('button', { name: /Remove.*Available.*filter/ })
    .click();
  await expect(page).not.toHaveURL(/status=AVAILABLE/);
  await expect(page.locator('.asset-filter-chips')).toHaveCount(0);
  await page.getByRole('button', { name: 'Table view', exact: true }).click();
  await expect(page.locator('main table')).toBeVisible();
  const quickView = page.getByRole('button', { name: /^Quick view / }).first();
  const tag = (await quickView.getAttribute('aria-label'))!.replace('Quick view ', '');
  await quickView.click();
  const preview = page.getByRole('dialog', { name: 'Asset quick view' });
  await expect(preview.getByRole('heading', { name: tag, exact: true })).toBeVisible();
  await expect(preview.getByRole('link', { name: 'Open full record' })).toHaveAttribute('href', /\/assets\//);
  await page.screenshot({ animations: 'disabled', path: '.local/ui-review-asset-preview.png' });
  await page.keyboard.press('Escape');
  await expect(preview).not.toBeVisible();
  await expect(quickView).toBeFocused();
});

test('CSV import saves valid records and bulk move reports a concurrent change without losing successes', async ({
  page,
  request,
}) => {
  const session = await request.post('/api/auth/login', {
    data: { identifier: 'admin@example.com', password: 'Admin@12345!' },
  });
  expect(session.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await session.json()).data.accessToken}` };
  const lookups = (await (await request.get('/api/lookups', { headers })).json()).data;
  const source = lookups.locations[0],
    destination = lookups.locations[1];
  expect(destination).toBeTruthy();
  const prefix = `CSV-UI-${Date.now()}`;
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csv = [
    ['assetTag', 'assetType', 'category', 'manufacturer', 'model', 'serialNumber', 'location'],
    [
      `${prefix}-A`,
      'Laptop',
      lookups.categories[0].name,
      'Console Test',
      'Import fixture A',
      `${prefix}-SN-A`,
      source.name,
    ],
    [
      `${prefix}-B`,
      'Laptop',
      lookups.categories[0].name,
      'Console Test',
      'Import fixture B',
      `${prefix}-SN-B`,
      source.name,
    ],
  ]
    .map((row) => row.map(cell).join(','))
    .join('\r\n');
  await login(page);
  await page.goto('/assets');
  await page.getByRole('button', { name: /^Import(?: CSV)?$/ }).click();
  let dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Asset CSV file')
    .setInputFiles({ name: 'assets.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(dialog.getByText('Ready', { exact: true })).toHaveCount(2);
  await page.screenshot({ animations: 'disabled', path: '.local/ui-review-import.png' });
  await dialog.getByRole('button', { name: 'Import 2 valid assets' }).click();
  await expect(dialog.getByText('Imported', { exact: true })).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByLabel('Search asset tag, serial, model or employee…').fill(prefix);
  await expect(page.locator('main tbody tr')).toHaveCount(2);
  await page.getByLabel('Select all records on this page').check();
  await page
    .getByRole('region', { name: 'Selected asset actions' })
    .getByRole('button', { name: 'Move', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('New location', { exact: true }).selectOption(destination.id);
  await dialog.getByLabel('Movement notes').fill('Verified bulk handover');
  await dialog.getByRole('button', { name: 'Review changes' }).click();
  const records = (await (await request.get(`/api/assets?search=${prefix}`, { headers })).json()).data;
  expect(records).toHaveLength(2);
  const moved = await request.post(`/api/assets/${records[1].id}/move`, {
    headers,
    data: { locationId: destination.id, notes: 'Concurrent move before bulk confirmation' },
  });
  expect(moved.ok()).toBeTruthy();
  await dialog.getByRole('button', { name: 'Confirm location move' }).click();
  await expect(dialog.locator('.asset-outcomes > div')).toHaveCount(2);
  await expect(dialog.locator('.asset-outcomes')).toContainText('Completed');
  await expect(dialog.locator('.asset-outcomes')).toContainText('already at this location');
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  const saved = (await (await request.get(`/api/assets?search=${prefix}`, { headers })).json()).data;
  expect(saved.every((asset: any) => asset.locationId === destination.id)).toBeTruthy();
});
