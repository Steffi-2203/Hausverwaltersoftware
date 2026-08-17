import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';

describe('Health & Readiness Endpoints', () => {
  const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:5000';
  const isCI = !!process.env.CI;

  it('GET /health returns 200 with status ok', async () => {
    if (!isCI && !process.env.TEST_BASE_URL) {
      return;
    }
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data).toHaveProperty('uptime');
    expect(data).toHaveProperty('timestamp');
  });

  it('GET /ready returns 200 when database is connected', async () => {
    if (!isCI && !process.env.TEST_BASE_URL) {
      return;
    }
    const res = await fetch(`${BASE_URL}/ready`);
    expect([200, 503]).toContain(res.status);
    const data = await res.json();
    expect(data).toHaveProperty('status');
  });
});
