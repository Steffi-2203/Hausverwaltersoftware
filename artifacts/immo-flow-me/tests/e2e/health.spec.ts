import { test, expect } from '@playwright/test';

test.describe('Health & Readiness', () => {
  test('GET /api/health returns 200 or rate-limited response', async ({ request }) => {
    const response = await request.get('/api/health');
    const status = response.status();
    if (status === 200) {
      const body = await response.json();
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('database');
      expect(body.database).toBe('connected');
    } else {
      expect(status).toBe(429);
    }
  });

  test('serves the frontend on /', async ({ page }) => {
    const response = await page.goto('/');
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);
  });

  test('unknown API routes are handled gracefully', async ({ request }) => {
    const response = await request.get('/api/nonexistent-endpoint-xyz');
    expect([200, 429]).toContain(response.status());
  });
});
