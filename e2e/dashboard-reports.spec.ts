import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function login(page: Page, employee = false) {
  await page.goto('/login');
  await page.getByLabel('Email or employee ID').fill(employee ? 'employee@example.com' : 'admin@example.com');
  await page.getByLabel('Password', { exact: true }).fill(employee ? 'Employee@12345!' : 'Admin@12345!');
  const response = page.waitForResponse(
    (result) => result.url().endsWith('/api/dashboard/summary') && result.status() === 200,
  );
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.dc-kpi')).toHaveCount(6);
  return (await (await response).json()).data;
}

test('dashboard metrics match the API and drill down into actual asset records', async ({ page }) => {
  const summary = await login(page);
  await expect(page.locator('.dc-kpi').nth(0).locator(':scope > strong')).toHaveText(
    summary.totalAssets.toLocaleString(),
  );
  await expect(page.locator('.dc-kpi').nth(1).locator(':scope > strong')).toHaveText(
    summary.assignedAssets.toLocaleString(),
  );
  await expect(page.locator('.dc-kpi').nth(4).locator(':scope > strong')).toHaveText(
    summary.lostAssets.toLocaleString(),
  );
  const assigned = page.waitForResponse(
    (result) =>
      result.url().includes('/api/assets?') &&
      new URL(result.url()).searchParams.get('status') === 'ASSIGNED' &&
      result.status() === 200,
  );
  await page.locator('.dc-kpi').nth(1).click();
  await expect(page).toHaveURL(/\/assets\?status=ASSIGNED/);
  expect(
    (await (await assigned).json()).data.every((asset: { status: string }) => asset.status === 'ASSIGNED'),
  ).toBeTruthy();

  await page.goto('/');
  await expect(page.locator('.dc-status-legend a')).not.toHaveCount(0);
  const statusLink = page.locator('.dc-status-legend a').first();
  const href = (await statusLink.getAttribute('href'))!;
  const expectedStatus = new URL(href, 'http://localhost').searchParams.get('status');
  const filtered = page.waitForResponse(
    (result) =>
      result.url().includes('/api/assets?') &&
      new URL(result.url()).searchParams.get('status') === expectedStatus &&
      result.status() === 200,
  );
  await statusLink.click();
  expect(
    (await (await filtered).json()).data.every(
      (asset: { status: string }) => asset.status === expectedStatus,
    ),
  ).toBeTruthy();

  await page.goto('/');
  const category = page.locator('.dc-distribution-list a[href*="categoryId="]').first();
  await expect(category).toBeVisible();
  const categoryId = new URL((await category.getAttribute('href'))!, 'http://localhost').searchParams.get(
    'categoryId',
  );
  const categoryResponse = page.waitForResponse(
    (result) =>
      result.url().includes('/api/assets?') &&
      new URL(result.url()).searchParams.get('categoryId') === categoryId &&
      result.status() === 200,
  );
  await category.click();
  expect(
    (await (await categoryResponse).json()).data.every(
      (asset: { categoryId: string }) => asset.categoryId === categoryId,
    ),
  ).toBeTruthy();
});

test('activity series controls and role-aware quick actions remain interactive', async ({ page }) => {
  await login(page);
  const trend = page.locator('.dc-trend-panel');
  await expect(trend.locator('.recharts-area')).toHaveCount(2);
  await trend.getByRole('button', { name: 'Returns', exact: true }).click();
  await expect(trend.getByRole('button', { name: 'Returns', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(trend.locator('.recharts-area')).toHaveCount(1);
  await trend.getByRole('button', { name: 'All', exact: true }).click();
  await expect(trend.locator('.recharts-area')).toHaveCount(2);
  await page.getByRole('link', { name: 'Report lost', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/\/requests/);
});

test('report library previews live counts and exports the full filtered CSV', async ({ page, request }) => {
  const auth = await request.post('http://127.0.0.1:5001/api/auth/login', {
    data: { identifier: 'admin@example.com', password: 'Admin@12345!' },
  });
  const token = (await auth.json()).data.accessToken;
  const headers = { Authorization: `Bearer ${token}` };
  const lookups = (await (await request.get('http://127.0.0.1:5001/api/lookups', { headers })).json()).data;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const damagedTag = `REPORT-DAMAGED-${suffix}`;
  const availableTag = `REPORT-AVAILABLE-${suffix}`;
  for (const [assetTag, condition] of [
    [damagedTag, 'DAMAGED'],
    [availableTag, 'GOOD'],
  ]) {
    const response = await request.post('http://127.0.0.1:5001/api/assets', {
      headers,
      data: {
        assetTag,
        assetType: 'Laptop',
        categoryId: lookups.categories[0].id,
        manufacturer: 'Report verification',
        model: 'Console export test',
        condition,
      },
    });
    expect(response.ok()).toBeTruthy();
  }
  await login(page);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports & insights' })).toBeVisible();
  await expect(page.locator('.dc-report-card')).toHaveCount(10);
  const inventory = page
    .locator('.dc-report-card')
    .filter({ has: page.getByRole('heading', { name: 'Asset inventory', exact: true }) });
  await expect(inventory.locator('.dc-record-count strong')).toBeVisible();
  await inventory.getByRole('button', { name: 'View Asset inventory', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Selected report preview' });
  await preview.getByRole('button', { name: 'Filters', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Filter report' });
  await dialog.getByLabel('Status', { exact: true }).selectOption('DAMAGED');
  const reportResponse = page.waitForResponse(
    (result) =>
      result.url().includes('/api/reports/inventory?') &&
      new URL(result.url()).searchParams.get('status') === 'DAMAGED' &&
      !new URL(result.url()).searchParams.has('format') &&
      result.status() === 200,
  );
  await dialog.getByRole('button', { name: 'Apply filters' }).click();
  const filtered = (await (await reportResponse).json()).data;
  expect(filtered.rows.length).toBeGreaterThan(0);
  expect(filtered.rows.every((row: { status: string }) => row.status === 'DAMAGED')).toBeTruthy();
  await expect(preview.getByRole('button', { name: 'Remove Status filter' })).toContainText('Damaged');
  await expect(preview.locator('.dc-report-preview-head .dc-counter')).toHaveText(
    `${filtered.rows.length.toLocaleString()} records`,
  );
  const exportResponse = page.waitForResponse(
    (result) =>
      result.url().includes('/api/reports/inventory?') &&
      new URL(result.url()).searchParams.get('format') === 'csv',
  );
  const downloadEvent = page.waitForEvent('download');
  await preview.getByRole('button', { name: 'CSV', exact: true }).click();
  const exported = await exportResponse;
  expect(new URL(exported.url()).searchParams.get('status')).toBe('DAMAGED');
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const content = await readFile((await download.path())!, 'utf8');
  expect(content).toContain(damagedTag);
  expect(content).not.toContain(availableTag);
  expect(content.split('\r\n').length - 1).toBe(filtered.rows.length);

  await page.getByRole('button', { name: 'View Employee exit assets', exact: true }).click();
  await preview.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(dialog.getByLabel('Employee', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Status', { exact: true })).toHaveCount(0);
});

test('notification inbox marks actual updates read and supports unread catch-up', async ({ page }) => {
  await login(page);
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notification center' })).toBeVisible();
  const unreadButton = page.locator('.dc-inbox-folder-list').getByRole('button', { name: /^Unread/ });
  await unreadButton.click();
  await expect(unreadButton).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.skeleton-stack')).toHaveCount(0);
  const unreadResponse = await page.locator('.dc-inbox-summary strong').textContent();
  if (Number(unreadResponse?.replaceAll(',', '')) > 0) {
    await page.getByRole('button', { name: 'Mark all as read', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'You’re all caught up' })).toBeVisible();
    await expect(page.locator('.dc-inbox-summary strong')).toHaveText('0');
  } else {
    await expect(page.getByRole('heading', { name: 'You’re all caught up' })).toBeVisible();
  }
  await page.getByRole('button', { name: 'View all notifications', exact: true }).click();
  await expect(
    page.locator('.dc-inbox-folder-list').getByRole('button', { name: /^All notifications/ }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('employee dashboard keeps scoped actions and console pages fit a mobile viewport', async ({ page }) => {
  await login(page, true);
  await expect(page.getByRole('heading', { name: 'My asset overview' })).toBeVisible();
  await expect(page.locator('.dc-action-bar').getByRole('link', { name: 'Assign', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.locator('.dc-action-bar').getByRole('link', { name: 'Add employee', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Report damage', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/notifications']) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('.skeleton-stack')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBeTruthy();
  }
});
