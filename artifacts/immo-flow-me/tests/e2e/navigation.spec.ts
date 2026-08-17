import { test, expect } from '@playwright/test';

test.describe('Unauthenticated Navigation', () => {
  test('redirects to login when accessing protected routes', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForTimeout(2000);
    const url = page.url();
    const isLoginOrRedirected = url.includes('/login') || url.includes('/') && !url.includes('/dashboard');
    expect(isLoginOrRedirected).toBeTruthy();
  });

  test('login page is accessible without auth', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
  });

  test('tenant login page is accessible without auth', async ({ page }) => {
    const response = await page.goto('/mieter-login');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
  });

  test('owner login page is accessible without auth', async ({ page }) => {
    const response = await page.goto('/eigentuemer-login');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
  });
});

test.describe('API Auth Guards', () => {
  test('GET /api/properties rejects unauthenticated requests', async ({ request }) => {
    const response = await request.get('/api/properties');
    expect([401, 403, 429]).toContain(response.status());
  });

  test('GET /api/tenants rejects unauthenticated requests', async ({ request }) => {
    const response = await request.get('/api/tenants');
    expect([401, 403, 429]).toContain(response.status());
  });

  test('GET /api/units rejects unauthenticated requests', async ({ request }) => {
    const response = await request.get('/api/units');
    expect([401, 403, 429]).toContain(response.status());
  });

  test('GET /api/invoices rejects unauthenticated requests', async ({ request }) => {
    const response = await request.get('/api/invoices');
    expect([401, 403, 429]).toContain(response.status());
  });

  test('POST /api/properties rejects unauthenticated requests', async ({ request }) => {
    const response = await request.post('/api/properties', {
      data: { name: 'Test', address: 'Test St 1', city: 'Wien', zip: '1010' }
    });
    expect([401, 403, 429]).toContain(response.status());
  });
});
