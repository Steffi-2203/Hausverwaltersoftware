import { describe, it, beforeEach } from 'node:test';
import { expect, vi } from '../helpers/expect';
import { CircuitBreaker, CircuitOpenError } from '../../server/services/circuitBreaker';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker('test-service', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      halfOpenMaxAttempts: 1,
    });
  });

  it('starts in closed state', () => {
    expect(cb.getState()).toBe('closed');
    expect(cb.isAvailable()).toBe(true);
  });

  it('remains closed after successful calls', async () => {
    await cb.execute(() => Promise.resolve('ok'));
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getState()).toBe('closed');
    expect(cb.getStats().failures).toBe(0);
  });

  it('tracks failures but stays closed below threshold', async () => {
    for (let i = 0; i < 2; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.getState()).toBe('closed');
    expect(cb.getStats().failures).toBe(2);
  });

  it('opens after reaching failure threshold', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.getState()).toBe('open');
    expect(cb.isAvailable()).toBe(false);
  });

  it('throws CircuitOpenError when open', async () => {
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    try {
      await cb.execute(() => Promise.resolve('ok'));
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      expect((err as CircuitOpenError).retryAfterSec).toBeGreaterThan(0);
    }
  });

  it('transitions to half-open after reset timeout', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    expect(cb.getState()).toBe('open');

    vi.advanceTimersByTime(1100);
    expect(cb.getState()).toBe('half-open');
    expect(cb.isAvailable()).toBe(true);
    vi.useRealTimers();
  });

  it('closes after successful half-open call', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    vi.advanceTimersByTime(1100);
    expect(cb.getState()).toBe('half-open');

    await cb.execute(() => Promise.resolve('recovered'));
    expect(cb.getState()).toBe('closed');
    expect(cb.getStats().failures).toBe(0);
    vi.useRealTimers();
  });

  it('re-opens after failed half-open call', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    vi.advanceTimersByTime(1100);
    expect(cb.getState()).toBe('half-open');

    await cb.execute(() => Promise.reject(new Error('still broken'))).catch(() => {});
    expect(cb.getState()).toBe('open');
    vi.useRealTimers();
  });

  it('returns correct stats', async () => {
    const stats = cb.getStats();
    expect(stats).toHaveProperty('name', 'test-service');
    expect(stats).toHaveProperty('state', 'closed');
    expect(stats).toHaveProperty('failures', 0);
    expect(stats).toHaveProperty('lastFailureTime', null);
  });

  it('success resets failure count', async () => {
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(cb.getStats().failures).toBe(2);

    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.getStats().failures).toBe(0);
  });

  it('limits half-open attempts', async () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) {
      await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    }
    vi.advanceTimersByTime(1100);
    expect(cb.isAvailable()).toBe(true);

    await cb.execute(() => Promise.reject(new Error('fail'))).catch(() => {});
    expect(cb.isAvailable()).toBe(false);
    vi.useRealTimers();
  });
});
