import { test, expect } from '@playwright/test';

async function dismissCookieBanner(page: import('@playwright/test').Page) {
  const banner = page.getByTestId('cookie-consent-banner');
  if (await banner.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.getByTestId('button-cookie-accept-all').click();
    await banner.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  }
}

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await dismissCookieBanner(page);
  });

  test('renders login form with all fields', async ({ page }) => {
    await expect(page.getByTestId('input-email')).toBeVisible();
    await expect(page.getByTestId('input-password')).toBeVisible();
    await expect(page.getByTestId('button-login')).toBeVisible();
  });

  test('login button is clickable and form does not navigate on empty submit', async ({ page }) => {
    const loginBtn = page.getByTestId('button-login');
    await expect(loginBtn).toBeEnabled();
    await loginBtn.click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/login');
  });

  test('submitting invalid credentials does not navigate away', async ({ page }) => {
    await page.getByTestId('input-email').fill('invalid@test.example');
    await page.getByTestId('input-password').fill('WrongPassword123!');
    await page.getByTestId('button-login').click();
    await page.waitForTimeout(3000);
    expect(page.url()).toContain('/login');
  });

  test('password field masks input', async ({ page }) => {
    const passwordInput = page.getByTestId('input-password');
    await expect(passwordInput).toHaveAttribute('type', 'password');
  });
});

test.describe('Tenant Login Page', () => {
  test('renders tenant login form', async ({ page }) => {
    await page.goto('/mieter-login');
    await dismissCookieBanner(page);
    await expect(page.getByTestId('text-tenant-login-title')).toBeVisible();
    await expect(page.getByTestId('input-tenant-email')).toBeVisible();
    await expect(page.getByTestId('input-tenant-password')).toBeVisible();
    await expect(page.getByTestId('button-tenant-login')).toBeVisible();
  });

  test('has link back to home', async ({ page }) => {
    await page.goto('/mieter-login');
    await dismissCookieBanner(page);
    await expect(page.getByTestId('link-back-home')).toBeVisible();
  });
});

test.describe('Owner Login Page', () => {
  test('renders owner login form', async ({ page }) => {
    await page.goto('/eigentuemer-login');
    await dismissCookieBanner(page);
    await expect(page.getByTestId('text-owner-login-title')).toBeVisible();
    await expect(page.getByTestId('input-owner-email')).toBeVisible();
    await expect(page.getByTestId('input-owner-password')).toBeVisible();
    await expect(page.getByTestId('button-owner-login')).toBeVisible();
  });
});
