import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email or employee ID').fill('admin@example.com');
  await page.getByLabel('Password', { exact: true }).fill('Admin@12345!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('main h1')).toBeVisible();
});

test('navigation collapse persists and command search opens actual records with keyboard', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Collapse navigation', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand navigation', exact: true })).toBeVisible();
  const assets = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'All assets', exact: true });
  await assets.hover();
  await expect(page.getByRole('tooltip')).toHaveText('All assets');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search assets and employees' });
  await expect(search).toBeFocused();
  await search.fill('LAP');
  const option = page.getByRole('option').filter({ hasText: 'LAP' }).first();
  await expect(option).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  const target = await page.locator('[role="option"][aria-selected="true"]').getAttribute('href');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`${target}$`));
  await expect(page.locator('main h1')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(search).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(search).toHaveAttribute('aria-expanded', 'false');
});

test('header menus, help focus trap, and sign out work with keyboard', async ({ page }) => {
  await page.getByRole('button', { name: 'Workspace help', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Workspace help' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Got it' }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Workspace help', exact: true })).toBeFocused();
  await page.getByRole('button', { name: /^Notifications/ }).click();
  await expect(page.locator('#notification-popover')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#notification-popover')).not.toBeVisible();
  await page.getByRole('button', { name: 'Open profile menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'My profile' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login$/);
});

test('mobile drawer traps focus and asset cards fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Sign out', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(drawer.getByRole('link', { name: 'INFOCUS Asset Management home' })).toBeFocused();
  await drawer.getByRole('link', { name: 'All assets', exact: true }).click();
  await expect(drawer).not.toBeVisible();
  await expect(page.locator('main h1')).toHaveText('All assets');
  await expect(page.locator('.skeleton-stack')).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBeTruthy();
});

test('major console pages render and save desktop review screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [name, path] of [
    ['dashboard', '/'],
    ['assets', '/assets'],
    ['employees', '/employees'],
    ['assignments', '/assignments'],
    ['repairs', '/repairs'],
    ['requests', '/requests'],
    ['reports', '/reports'],
    ['offboarding', '/offboarding'],
    ['notifications', '/notifications'],
    ['audit', '/audit-logs'],
    ['users', '/users'],
    ['settings', '/settings'],
  ] as const) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('.skeleton-stack')).toHaveCount(0);
    await expect(page.locator('.error-state')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({ animations: 'disabled', path: `.local/ui-review-${name}.png`, fullPage: true });
  }
});

test('a saving form cannot be dismissed or submitted again while its request is pending', async ({
  page,
}) => {
  await page.goto('/categories');
  await page.getByRole('button', { name: 'Add category', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Category name').fill(`UI save guard ${Date.now()}`);
  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const observed = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/categories', async (route) => {
    if (route.request().method() === 'POST') {
      started();
      await pending;
    }
    await route.continue();
  });
  try {
    await dialog.getByRole('button', { name: 'Save category', exact: true }).click();
    await observed;
    await expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally {
    release();
  }
  await expect(dialog).not.toBeVisible();
});
