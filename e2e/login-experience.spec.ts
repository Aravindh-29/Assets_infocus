import { test, expect } from '@playwright/test';

test('the asset orbit supports dragging, keyboard rotation, and pausing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  const experience = page.locator('.login-experience');
  const orbit = page.getByRole('region', { name: 'Interactive asset orbit' });
  await expect(experience).toHaveAttribute('data-motion', 'playing');
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await expect(experience).toHaveAttribute('data-motion', 'paused');

  await orbit.focus();
  await page.keyboard.press('Home');
  const [initialX, initialY] = await orbit.evaluate(async (element) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return [element.getAttribute('data-rotation-x'), element.getAttribute('data-rotation-y')];
  });
  const bounds = await orbit.boundingBox();
  expect(bounds).not.toBeNull();
  const x = bounds!.x + bounds!.width * 0.5;
  const y = bounds!.y + bounds!.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  try {
    await expect(orbit).toHaveAttribute('data-dragging', 'true');
    await page.mouse.move(x + 100, y + 60, { steps: 8 });
    await expect(orbit).not.toHaveAttribute('data-rotation-y', initialY!);
    await expect(orbit).not.toHaveAttribute('data-rotation-x', initialX!);
  } finally {
    await page.mouse.up();
  }
  await expect(orbit).toHaveAttribute('data-dragging', 'false');

  await orbit.focus();
  await page.keyboard.press('Home');
  await expect(orbit).toHaveAttribute('data-rotation-x', initialX!);
  await expect(orbit).toHaveAttribute('data-rotation-y', initialY!);
  await page.keyboard.press('ArrowRight');
  await expect(orbit).not.toHaveAttribute('data-rotation-y', initialY!);
  await page.keyboard.press('ArrowUp');
  await expect(orbit).not.toHaveAttribute('data-rotation-x', initialX!);
  await page.keyboard.press('Home');
  await expect(orbit).toHaveAttribute('data-rotation-x', initialX!);
  await expect(orbit).toHaveAttribute('data-rotation-y', initialY!);

  await page.getByRole('button', { name: 'Play animation', exact: true }).click();
  await expect(experience).toHaveAttribute('data-motion', 'playing');
  await expect(orbit).not.toHaveAttribute('data-rotation-y', initialY!);
  await expect(page.locator('.login-typewriter')).toHaveText('People, in sync.', { timeout: 9000 });
  await page.getByRole('button', { name: 'Pause animation', exact: true }).click();
  await page.reload();
  await expect(experience).toHaveAttribute('data-motion', 'paused');
  await expect(page.getByRole('button', { name: 'Play animation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset orbit', exact: true }).click();
  await expect(orbit).toHaveAttribute('data-rotation-x', initialX!);
  await expect(orbit).toHaveAttribute('data-rotation-y', initialY!);
  await page.getByLabel('Email or employee ID').focus();
  await page.mouse.move(1300, 900);
  await page.screenshot({ path: '.local/login-desktop.png', fullPage: true, animations: 'disabled' });
});

test('reduced motion starts still while manual controls and the form remain usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.locator('.login-experience')).toHaveAttribute('data-motion', 'paused');
  const orbit = page.getByRole('region', { name: 'Interactive asset orbit' });
  await expect(orbit).toBeVisible();
  const motion = await orbit.evaluate(async (element) => {
    const rotation = () => [element.getAttribute('data-rotation-x'), element.getAttribute('data-rotation-y')];
    const before = rotation();
    for (let frame = 0; frame < 10; frame++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return {
      before,
      after: rotation(),
      runningLoops: document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity,
        ).length,
    };
  });
  expect(motion.after).toEqual(motion.before);
  expect(motion.runningLoops).toBe(0);
  await orbit.focus();
  await page.keyboard.press('ArrowRight');
  await expect(orbit).not.toHaveAttribute('data-rotation-y', motion.before[1]!);
  await page.getByLabel('Email or employee ID').fill('admin@example.com');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.getByLabel('Password', { exact: true }).fill('Admin@12345!');
  await expect(page.getByRole('button', { name: 'Sign in to workspace' })).toBeEnabled();
});

test('login preserves error feedback, password visibility, and remembered sessions', async ({
  page,
  context,
}) => {
  let attempts = 0;
  const credentials: Array<{ identifier: string; remember: boolean }> = [];
  await page.route('**/api/auth/login', async (route) => {
    const { identifier, remember } = route.request().postDataJSON();
    credentials.push({ identifier, remember });
    attempts++;
    if (attempts === 1) {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: 'Incorrect email, employee ID, or password.' }),
      });
    } else {
      await route.continue();
    }
  });
  await page.goto('/login');
  const identifier = page.getByLabel('Email or employee ID');
  const password = page.getByLabel('Password', { exact: true });
  await identifier.fill('admin@example.com');
  await password.fill('Incorrect-password');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByLabel('Remember me', { exact: true }).check();
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect email, employee ID, or password.');
  await expect(identifier).toHaveValue('admin@example.com');
  await expect(page.getByLabel('Remember me', { exact: true })).toBeChecked();
  await password.fill('Admin@12345!');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('main h1')).toBeVisible();
  expect(credentials).toEqual([
    { identifier: 'admin@example.com', remember: true },
    { identifier: 'admin@example.com', remember: true },
  ]);
  const refreshCookie = (await context.cookies()).find((cookie) => cookie.name === 'asset_refresh');
  expect(refreshCookie?.httpOnly).toBe(true);
  expect(refreshCookie?.expires).toBeGreaterThan(Date.now() / 1000);
  await page.reload();
  await expect(page.locator('main h1')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('the mobile login and recovery form fit the viewport and retain usable controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByLabel('Email or employee ID')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('#workspace-sign-in')).toBeFocused();
  await expect(page.getByLabel('Email or employee ID')).toBeInViewport();
  const submit = page.getByRole('button', { name: 'Sign in to workspace' });
  await expect(submit).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  expect(await page.locator('.login-panel').evaluate((panel) => panel.scrollHeight <= panel.clientHeight)).toBe(true);
  await page.screenshot({ path: '.local/login-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
  await expect(page.getByLabel('Work email')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  expect(await page.locator('.login-panel').evaluate((panel) => panel.scrollHeight <= panel.clientHeight)).toBe(true);
  await page.getByRole('link', { name: /Back to sign in/ }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in to workspace' })).toBeVisible();
});

test.describe('touch interaction', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });

  test('touch gestures rotate and release the orbit while the sign-in form stays in the viewport', async ({
    page,
    context,
  }) => {
    await page.goto('/login');
    const orbit = page.getByRole('region', { name: 'Interactive asset orbit' });
    await orbit.scrollIntoViewIfNeeded();
    await expect(orbit).toBeInViewport();
    const initialRotation = await orbit.getAttribute('data-rotation-y');
    const session = await context.newCDPSession(page);
    const bounds = (await orbit.boundingBox())!;
    const x = bounds.x + bounds.width * 0.25;
    const y = bounds.y + bounds.height * 0.5;
    const point = (touchX: number, touchY: number) => ({
      x: touchX,
      y: touchY,
      id: 1,
      radiusX: 8,
      radiusY: 8,
      force: 1,
    });
    let touchStarted = false;
    try {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(x, y)] });
      touchStarted = true;
      await expect(orbit).toHaveAttribute('data-dragging', 'true');
      for (let step = 1; step <= 8; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [point(x + step * 12, y)],
        });
      }
      await expect(orbit).not.toHaveAttribute('data-rotation-y', initialRotation!);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      touchStarted = false;
      await expect(orbit).toHaveAttribute('data-dragging', 'false');

      const currentBounds = (await orbit.boundingBox())!;
      const swipeX = currentBounds.x + currentBounds.width * 0.55;
      const swipeY = Math.min(currentBounds.y + currentBounds.height * 0.75, 780);
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point(swipeX, swipeY)],
      });
      touchStarted = true;
      for (let step = 1; step <= 10; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [point(swipeX, swipeY - step * 14)],
        });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      touchStarted = false;
      await expect(orbit).toHaveAttribute('data-dragging', 'false');
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
      await expect(page.getByRole('button', { name: 'Sign in to workspace' })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    } finally {
      // Cleanup is best effort so a lost CDP session cannot hide an assertion failure.
      if (touchStarted)
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {});
      await session.detach().catch(() => {});
    }
  });
});
