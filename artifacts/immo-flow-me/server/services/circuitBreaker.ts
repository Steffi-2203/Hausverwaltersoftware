type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

const defaults: CircuitBreakerOptions = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxAttempts: 2,
};

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private readonly opts: CircuitBreakerOptions;
  readonly name: string;

  constructor(name: string, opts?: Partial<CircuitBreakerOptions>) {
    this.name = name;
    this.opts = { ...defaults, ...opts };
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.opts.resetTimeoutMs) {
        this.state = 'half-open';
        this.halfOpenAttempts = 0;
      }
    }
    return this.state;
  }

  isAvailable(): boolean {
    const current = this.getState();
    if (current === 'closed') return true;
    if (current === 'half-open') return this.halfOpenAttempts < this.opts.halfOpenMaxAttempts;
    return false;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.isAvailable()) {
      const waitSec = Math.ceil((this.opts.resetTimeoutMs - (Date.now() - this.lastFailureTime)) / 1000);
      throw new CircuitOpenError(
        `Service "${this.name}" ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in ${waitSec}s erneut.`,
        waitSec
      );
    }

    try {
      if (this.state === 'half-open') this.halfOpenAttempts++;
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
    this.halfOpenAttempts = 0;
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.opts.failureThreshold) {
      this.state = 'open';
      console.warn(`[CircuitBreaker] "${this.name}" OPEN after ${this.failures} failures. Reset in ${this.opts.resetTimeoutMs / 1000}s`);
    }
  }

  getStats() {
    return {
      name: this.name,
      state: this.getState(),
      failures: this.failures,
      lastFailureTime: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
    };
  }
}

export class CircuitOpenError extends Error {
  retryAfterSec: number;
  constructor(message: string, retryAfterSec: number) {
    super(message);
    this.name = 'CircuitOpenError';
    this.retryAfterSec = retryAfterSec;
  }
}

export const ocrCircuitBreaker = new CircuitBreaker('OpenAI-Vision-OCR', {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 1,
});
