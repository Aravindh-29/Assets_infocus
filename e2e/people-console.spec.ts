import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

async function adminHeaders(api: APIRequestContext) {
  const login = await api.post('/api/auth/login', {
    data: { identifier: 'admin@example.com', password: 'Admin@12345!' },
  });
  expect(login.ok()).toBeTruthy();
  return { Authorization: `Bearer ${(await login.json()).data.accessToken}` };
}

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email or employee ID').fill('admin@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Admin@12345!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('employee directory cards and filters keep live custody counts and work on mobile', async ({
  page,
  request,
}) => {
  const headers = await adminHeaders(request);
  const response = await request.get('/api/employees?status=ACTIVE&pageSize=100', { headers });
  expect(response.ok()).toBeTruthy();
  const employee = (await response.json()).data.find((record: any) => record.departmentId);
  expect(employee).toBeTruthy();

  await signIn(page);
  await page.goto('/employees');
  await expect(page.getByRole('heading', { name: 'Employees', exact: true })).toBeVisible();
  await page.getByLabel('Search name, employee ID or email…').fill(employee.employeeId);
  await page.getByLabel('Filter employment status').selectOption('ACTIVE');
  await page.getByLabel('Filter employee department').selectOption(employee.departmentId);
  const cardsButton = page.getByRole('button', { name: 'Employee cards view' });
  await cardsButton.focus();
  await page.keyboard.press('Enter');
  await expect(cardsButton).toHaveAttribute('aria-pressed', 'true');
  const card = page.getByRole('article', { name: employee.name, exact: true });
  await expect(card).toBeVisible();
  await expect(page.locator('.po-employee-card')).toHaveCount(1);
  await expect(card).toContainText(employee.employeeId);
  await expect(card).toContainText(employee.department.name);
  await expect(card.locator('.po-count-link')).toContainText(`${employee._count.assignments} assets`);

  const quickView = card.getByRole('button', { name: `Quick view ${employee.name}`, exact: true });
  await quickView.focus();
  await page.keyboard.press('Enter');
  const preview = page.getByRole('dialog', { name: 'Employee quick view', exact: true });
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('heading', { name: employee.name, exact: true })).toBeVisible();
  await expect(preview.getByRole('region', { name: 'Employee details', exact: true })).toContainText(
    employee.email,
  );
  await expect(preview.getByRole('link', { name: 'Open full record', exact: true })).toHaveAttribute(
    'href',
    `/employees/${employee.id}`,
  );
  await expect(preview.getByRole('button', { name: 'Close dialog', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(preview).toHaveCount(0);
  await expect(quickView).toBeFocused();
  await expect(page).toHaveURL(/\/employees$/);

  await card.getByRole('link', { name: `View ${employee.name}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/employees/${employee.id}$`));
  await expect(page.getByRole('navigation', { name: 'Employee profile sections' })).toBeVisible();
  await expect(page.locator('#employee-current-assets .po-custody-card')).toHaveCount(
    employee._count.assignments,
  );
  await page
    .getByRole('navigation', { name: 'Employee profile sections' })
    .getByRole('link', { name: 'Assignment history' })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#employee-previous-assets$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/employees');
  await expect(page.getByRole('button', { name: 'Employee cards view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.po-employee-card').first()).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: innerWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport + 1);
});

test('offboarding progress prevents completion and hides invalid transfer actions', async ({
  page,
  request,
}) => {
  // One small API fixture supplements the full UI lifecycle test without repeating it.
  const headers = await adminHeaders(request);
  const lookupsResponse = await request.get('/api/lookups', { headers });
  expect(lookupsResponse.ok()).toBeTruthy();
  const lookups = (await lookupsResponse.json()).data;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const employeeResponse = await request.post('/api/employees', {
    headers,
    data: {
      employeeId: `PO-${suffix}`,
      name: `Console Offboarding ${suffix}`,
      email: `po-${suffix}@example.test`,
      departmentId: lookups.departments[0].id,
      locationId: lookups.locations[0].id,
      status: 'ACTIVE',
    },
  });
  expect(employeeResponse.ok()).toBeTruthy();
  const employee = (await employeeResponse.json()).data;
  const assetResponse = await request.post('/api/assets', {
    headers,
    data: {
      assetTag: `PO-ASSET-${suffix}`,
      assetType: 'Laptop',
      categoryId: lookups.categories[0].id,
      manufacturer: 'Test Equipment',
      model: 'Offboarding guard fixture',
      condition: 'GOOD',
      locationId: lookups.locations[0].id,
    },
  });
  expect(assetResponse.ok()).toBeTruthy();
  const asset = (await assetResponse.json()).data;
  expect(
    (
      await request.post(`/api/assets/${asset.id}/assign`, { headers, data: { employeeId: employee.id } })
    ).ok(),
  ).toBeTruthy();
  const checklistResponse = await request.post('/api/offboarding', {
    headers,
    data: { employeeId: employee.id, notes: 'Console progress and action eligibility regression.' },
  });
  expect(checklistResponse.ok()).toBeTruthy();
  const checklist = (await checklistResponse.json()).data;

  await signIn(page);
  await page.goto(`/offboarding/${checklist.id}`);
  const completeButton = page.getByRole('button', { name: 'Complete offboarding', exact: true });
  await expect(completeButton).toBeDisabled();
  await expect(completeButton).toHaveAttribute('aria-describedby', 'po-offboarding-pending');
  await expect(page.getByRole('progressbar', { name: 'Asset return progress', exact: true })).toHaveAttribute(
    'value',
    '0',
  );
  await expect(page.getByText('0 of 1 assets accounted for', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Transfer', exact: true })).toBeVisible();

  expect(
    (
      await request.patch(`/api/assets/${asset.id}/status`, {
        headers,
        data: { status: 'DAMAGED', notes: 'A damaged asset must be returned or repaired before transfer.' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await expect(completeButton).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Transfer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Return', exact: true })).toBeEnabled();

  expect(
    (
      await request.post(`/api/assets/${asset.id}/return`, {
        headers,
        data: { condition: 'DAMAGED', notes: 'Returned to inventory for repair.' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('progressbar', { name: 'Asset return progress', exact: true })).toHaveAttribute(
    'value',
    '1',
  );
  await expect(page.getByText('1 of 1 assets accounted for', { exact: true })).toBeVisible();
  await expect(completeButton).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Return', exact: true })).toHaveCount(0);
  // Keep historical test records while leaving no pending departure behind.
  expect((await request.post(`/api/offboarding/${checklist.id}/complete`, { headers })).ok()).toBeTruthy();
});
