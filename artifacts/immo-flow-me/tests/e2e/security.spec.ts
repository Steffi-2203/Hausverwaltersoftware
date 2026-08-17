import { test, expect } from '@playwright/test';

test.describe('Security Headers', () => {
  test('API responses include security headers', async ({ request }) => {
    const response = await request.get('/api/health');
    const headers = response.headers();
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBeTruthy();
  });

  test('CSRF token endpoint responds', async ({ request }) => {
    const response = await request.get('/api/csrf-token');
    const status = response.status();
    expect([200, 204, 403, 429]).toContain(status);
  });
});

test.describe('Rate Limiting', () => {
  test('rate limit headers are present on API responses', async ({ request }) => {
    const response = await request.get('/api/health');
    const headers = response.headers();
    const hasRateLimitHeader =
      headers['ratelimit-limit'] !== undefined ||
      headers['x-ratelimit-limit'] !== undefined ||
      headers['ratelimit-remaining'] !== undefined ||
      headers['x-ratelimit-remaining'] !== undefined;
    expect(hasRateLimitHeader).toBeTruthy();
  });
});

test.describe('CSRF Protection', () => {
  test('POST without CSRF token is rejected', async ({ request }) => {
    const response = await request.post('/api/properties', {
      data: { name: 'CSRF-Test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403, 429]).toContain(response.status());
  });
});

test.describe('Input Validation', () => {
  test('rejects malformed JSON on POST', async ({ request }) => {
    const response = await request.post('/api/properties', {
      headers: { 'Content-Type': 'application/json' },
      data: 'this-is-not-json{{{',
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});
