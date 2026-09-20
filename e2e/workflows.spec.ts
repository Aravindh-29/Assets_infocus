import { test, expect, type Page } from '@playwright/test';

const suffix = `${Date.now()}`;
async function login(page: Page, role: 'admin' | 'manager' | 'employee' = 'admin') {
  await page.goto('/login');
  const accounts = {
    admin: ['admin@example.com', 'Admin@12345!'],
    manager: ['assetmanager@example.com', 'Manager@12345!'],
    employee: ['employee@example.com', 'Employee@12345!'],
  };
  await page.getByLabel('Email or employee ID').fill(accounts[role][0]);
  await page.getByLabel('Password', { exact: true }).fill(accounts[role][1]);
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('main')).toBeVisible();
}
async function addEmployee(page: Page, name: string, id: string) {
  await page.goto('/employees');
  await page.getByRole('button', { name: 'Add employee', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Employee ID', { exact: true }).fill(id);
  await dialog.getByLabel('Full name').fill(name);
  await dialog.getByLabel('Work email').fill(`${id.toLowerCase()}@example.test`);
  await dialog.getByLabel('Designation').fill('Browser test engineer');
  await dialog.getByLabel('Department', { exact: true }).selectOption({ label: 'Engineering' });
  await dialog.getByLabel('Location', { exact: true }).selectOption({ label: 'Malaysia Office' });
  await dialog.getByRole('button', { name: 'Add employee', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByPlaceholder('Search name, employee ID or email…').fill(id);
  await expect(page.getByRole('link').filter({ hasText: name }).first()).toBeVisible();
}
async function registerAsset(page: Page, tag: string) {
  await page.goto('/assets');
  await page.getByRole('button', { name: 'Register asset', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Asset tag', { exact: true }).fill(tag);
  await dialog.getByLabel('Asset type', { exact: true }).fill('Laptop');
  await dialog.getByLabel('Category', { exact: true }).selectOption({ label: 'Laptop' });
  await dialog.getByLabel('Manufacturer').fill('Dell');
  await dialog.getByLabel('Model', { exact: true }).fill('Latitude 5440');
  await dialog.getByLabel('Serial number').fill(`SN-${tag}`);
  await dialog.getByLabel('Location', { exact: true }).selectOption({ label: 'Malaysia Office' });
  await dialog.getByRole('button', { name: 'Register asset', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByPlaceholder('Search asset tag, serial, model or employee…').fill(tag);
  await page.getByRole('link').filter({ hasText: tag }).first().click();
  await expect(page.getByRole('heading', { name: tag, exact: true })).toBeVisible();
}
async function assign(page: Page, employeeName: string, employeeId: string) {
  await page.getByRole('button', { name: 'Assign asset', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Employee', { exact: true })
    .selectOption({ label: `${employeeName} · ${employeeId}` });
  await dialog.getByRole('button', { name: 'Continue to details' }).click();
  await dialog.getByRole('button', { name: 'Review assignment' }).click();
  await page.screenshot({ animations: 'disabled', path: '.local/ui-review-assignment.png' });
  await dialog.getByRole('button', { name: 'Assign asset', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator('.holder-panel').getByRole('heading', { name: employeeName, exact: true }),
  ).toBeVisible();
}

test('administrator completes registration, assignment, transfer, return, offboarding, and export', async ({
  page,
}) => {
  const john = `Browser John ${suffix}`,
    david = `Browser David ${suffix}`;
  const johnId = `WEB-J-${suffix}`,
    davidId = `WEB-D-${suffix}`,
    tag = `WEB-LAP-${suffix}`;
  await login(page);
  await addEmployee(page, john, johnId);
  await addEmployee(page, david, davidId);
  await registerAsset(page, tag);
  const assetUrl = page.url();
  await assign(page, john, johnId);
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Transfer to employee').selectOption({ label: `${david} · ${davidId}` });
  await dialog.getByLabel('Reason for transfer').fill('Acceptance workflow handover');
  await dialog.getByRole('button', { name: 'Review transfer' }).click();
  await page.screenshot({ animations: 'disabled', path: '.local/ui-review-transfer.png' });
  await dialog.getByRole('button', { name: 'Transfer asset', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator('.holder-panel').getByRole('heading', { name: david, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Return asset', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Accessories returned').fill('Charger, Laptop bag');
  await page.screenshot({ animations: 'disabled', path: '.local/ui-review-return.png' });
  await dialog.getByRole('button', { name: 'Return asset', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'No current holder' })).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: '.local/ui-review-asset-detail.png',
    fullPage: true,
  });
  await expect(page.getByText('Asset Transferred', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Asset Returned', { exact: true }).first()).toBeVisible();
  await assign(page, john, johnId);
  await page.locator('.holder-panel').getByRole('link', { name: 'View employee' }).click();
  await page.screenshot({
    animations: 'disabled',
    path: '.local/ui-review-employee-profile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Start offboarding' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Offboarding notes').fill('Browser acceptance test');
  await dialog.getByRole('button', { name: 'Create offboarding checklist' }).click();
  await expect(page).toHaveURL(/\/offboarding\//);
  await expect(page.getByRole('button', { name: 'Complete offboarding' })).toBeDisabled();
  await expect(page.getByText('1 outstanding asset')).toBeVisible();
  await page.screenshot({
    animations: 'disabled',
    path: '.local/ui-review-offboarding-detail.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Return', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Return asset', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete offboarding' })).toBeEnabled();
  await page.getByRole('button', { name: 'Complete offboarding' }).click();
  await expect(page.getByText('Completed', { exact: true }).first()).toBeVisible();
  await page.goto(assetUrl);
  await expect(page.getByRole('heading', { name: 'No current holder' })).toBeVisible();
  await page.goto('/assets');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
});

test('all administrative screens load real API data without application errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  for (const route of [
    '/assets',
    '/employees',
    '/assignments',
    '/transfers',
    '/returns',
    '/movements',
    '/repairs',
    '/maintenance',
    '/requests',
    '/offboarding',
    '/categories',
    '/departments',
    '/locations',
    '/reports',
    '/audit-logs',
    '/users',
    '/settings',
    '/notifications',
    '/profile',
  ]) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('.skeleton-stack')).toHaveCount(0);
    await expect(page.locator('.error-state')).toHaveCount(0);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('new users can complete their required password change and retain a session', async ({
  page,
  request,
}) => {
  const loginResult = await request.post('/api/auth/login', {
    data: { identifier: 'admin@example.com', password: 'Admin@12345!' },
  });
  expect(loginResult.ok()).toBeTruthy();
  const accessToken = (await loginResult.json()).data.accessToken;
  const headers = { Authorization: `Bearer ${accessToken}` };
  const email = `onboarding.${suffix}@example.test`;
  const employeeResult = await request.post('/api/employees', {
    headers,
    data: { employeeId: `WEB-ONBOARD-${suffix}`, name: 'Browser Onboarding User', email, status: 'ACTIVE' },
  });
  expect(employeeResult.ok()).toBeTruthy();
  const employeeId = (await employeeResult.json()).data.id;
  const userResult = await request.post('/api/users', {
    headers,
    data: {
      name: 'Browser Onboarding User',
      email,
      role: 'EMPLOYEE',
      employeeId,
      password: 'Temporary@12345!',
    },
  });
  expect(userResult.ok()).toBeTruthy();
  await page.goto('/login');
  await page.getByLabel('Email or employee ID').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Temporary@12345!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.getByLabel('Current password', { exact: true }).fill('Temporary@12345!');
  await page.getByLabel('New password', { exact: true }).fill('UpdatedBrowser@12345!');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('employee interface is scoped and prevents administrator navigation', async ({ page }) => {
  await login(page, 'employee');
  await expect(page.locator('nav').getByRole('link', { name: 'User management', exact: true })).toHaveCount(
    0,
  );
  await page.goto('/assets');
  await expect(page.getByRole('heading', { name: 'My assets', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Register asset', exact: true })).toHaveCount(0);
  await page.goto('/users');
  await expect(page.getByRole('heading', { name: 'User management', exact: true })).toHaveCount(0);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Currently assigned assets' })).toBeVisible();
});

test('desktop and mobile dashboards render without viewport overflow', async ({ page }) => {
  await login(page);
  await expect(page.locator('.skeleton-stack')).toHaveCount(0);
  await page.screenshot({ animations: 'disabled', path: '.local/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ animations: 'disabled', path: '.local/dashboard-mobile.png', fullPage: true });
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport + 1);
  await page.goto('/assets');
  await expect(page.getByRole('heading', { name: 'All assets', exact: true })).toBeVisible();
  await page.screenshot({ animations: 'disabled', path: '.local/assets-mobile.png', fullPage: true });
});
