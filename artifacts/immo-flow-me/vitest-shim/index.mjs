/**
 * Minimal vitest shim using node:test + node:assert.
 * Covers the subset of vitest API used in this project's unit tests.
 * Required because the real vitest package is blocked by the Replit firewall.
 */
import { describe as nodeDescribe, it as nodeIt, test as nodeTest, before, after, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// test.each / it.each: table-driven tests
function makeEach(runner) {
  return function each(tableOrCases) {
    return function(name, fn) {
      const cases = Array.isArray(tableOrCases) ? tableOrCases : Object.values(tableOrCases);
      for (const args of cases) {
        const argArr = Array.isArray(args) ? [...args] : [args];  // copy for fn call
        const labelArr = [...argArr];                              // separate copy for label
        const label = typeof name === 'string'
          ? name.replace(/%[sdifjoO%]/g, () => String(labelArr.shift() ?? ''))
          : String(name);
        runner(label, () => fn(...argArr));
      }
    };
  };
}

function withEach(runner) {
  const wrapped = (...args) => runner(...args);
  wrapped.each = makeEach(runner);
  wrapped.skip = (...args) => { /* noop */ };
  wrapped.only = runner;
  return wrapped;
}

export const test = withEach(nodeTest);
export const it = withEach(nodeIt);
export const describe = withEach(nodeDescribe);

export { beforeEach, afterEach };
export const beforeAll = before;
export const afterAll = after;

// ── Matchers ───────────────────────────────────────────────────────────────────
function makeMatchers(value, negated = false) {
  const pass = (cond, msg) => {
    if (negated ? cond : !cond) throw new assert.AssertionError({ message: msg });
  };

  const m = {
    toBe(expected) {
      pass(Object.is(value, expected),
        negated
          ? `Expected ${JSON.stringify(value)} not to be ${JSON.stringify(expected)}`
          : `Expected ${JSON.stringify(value)} to be ${JSON.stringify(expected)}`);
    },
    toEqual(expected) {
      try {
        assert.deepStrictEqual(value, expected);
        if (negated) throw new assert.AssertionError({ message: `Expected values not to be deeply equal` });
      } catch (e) {
        if (!negated) throw e;
      }
    },
    toBeNull() {
      pass(value === null,
        negated ? `Expected value not to be null` : `Expected ${JSON.stringify(value)} to be null`);
    },
    toBeUndefined() {
      pass(value === undefined,
        negated ? `Expected value not to be undefined` : `Expected value to be undefined`);
    },
    toBeDefined() {
      pass(value !== undefined,
        negated ? `Expected value to be undefined` : `Expected value to be defined`);
    },
    toBeTruthy() {
      pass(Boolean(value),
        negated ? `Expected ${value} to be falsy` : `Expected ${value} to be truthy`);
    },
    toBeFalsy() {
      pass(!value,
        negated ? `Expected ${value} to be truthy` : `Expected ${value} to be falsy`);
    },
    toBeGreaterThan(n) {
      pass(value > n, `Expected ${value} ${negated ? 'not ' : ''}> ${n}`);
    },
    toBeGreaterThanOrEqual(n) {
      pass(value >= n, `Expected ${value} ${negated ? 'not ' : ''}≥ ${n}`);
    },
    toBeLessThan(n) {
      pass(value < n, `Expected ${value} ${negated ? 'not ' : ''}< ${n}`);
    },
    toBeLessThanOrEqual(n) {
      pass(value <= n, `Expected ${value} ${negated ? 'not ' : ''}≤ ${n}`);
    },
    toBeCloseTo(expected, precision = 2) {
      const delta = Math.pow(10, -precision) / 2;
      pass(Math.abs(value - expected) < delta,
        `Expected ${value} ${negated ? 'not ' : ''}to be close to ${expected} (±${delta})`);
    },
    toContain(item) {
      let has;
      if (typeof value === 'string') has = value.includes(item);
      else has = Array.isArray(value) && value.includes(item);
      pass(has, negated
        ? `Expected not to contain ${JSON.stringify(item)}`
        : `Expected to contain ${JSON.stringify(item)}`);
    },
    toMatch(pattern) {
      const str = typeof value === 'string' ? value : String(value);
      let matches;
      if (typeof pattern === 'string') matches = str.includes(pattern);
      else if (pattern instanceof RegExp) matches = pattern.test(str);
      else matches = false;
      pass(matches, negated
        ? `Expected "${str}" not to match ${pattern}`
        : `Expected "${str}" to match ${pattern}`);
    },
    toHaveLength(len) {
      pass(value.length === len,
        `Expected length ${value.length} ${negated ? 'not ' : ''}to be ${len}`);
    },
    toMatchObject(expected) {
      if (negated) throw new Error('not.toMatchObject not implemented');
      for (const [k, v] of Object.entries(expected)) {
        try {
          assert.deepStrictEqual(value[k], v);
        } catch {
          throw new assert.AssertionError({
            message: `Property "${k}": expected ${JSON.stringify(v)}, got ${JSON.stringify(value[k])}`,
          });
        }
      }
    },
    toHaveProperty(keyPath, expected) {
      const keys = String(keyPath).split('.');
      let obj = value;
      for (const key of keys) {
        if (obj == null || !Object.prototype.hasOwnProperty.call(obj, key)) {
          pass(false, `Expected object to have property "${keyPath}"`);
          return;
        }
        obj = obj[key];
      }
      if (arguments.length > 1) {
        try {
          assert.deepStrictEqual(obj, expected);
          if (negated) throw new assert.AssertionError({ message: `Expected property "${keyPath}" not to equal ${JSON.stringify(expected)}` });
        } catch (e) {
          if (!negated) throw e;
        }
      } else {
        pass(true, `Expected object not to have property "${keyPath}"`);
      }
    },
    toBeInstanceOf(cls) {
      pass(value instanceof cls,
        `Expected value ${negated ? 'not ' : ''}to be instanceof ${cls.name}`);
    },
    toThrow(msgOrRe) {
      if (negated) {
        assert.doesNotThrow(typeof value === 'function' ? value : () => { throw value; });
        return;
      }
      assert.ok(typeof value === 'function', 'toThrow requires a function');
      let threw = false;
      let caught;
      try { value(); } catch (e) { threw = true; caught = e; }
      assert.ok(threw, 'Expected function to throw but it did not');
      if (msgOrRe !== undefined && caught) {
        const msg = caught instanceof Error ? caught.message : String(caught);
        if (typeof msgOrRe === 'string') {
          assert.ok(msg.includes(msgOrRe),
            `Expected error message "${msg}" to include "${msgOrRe}"`);
        } else if (msgOrRe instanceof RegExp) {
          assert.ok(msgOrRe.test(msg),
            `Expected error message "${msg}" to match ${msgOrRe}`);
        }
      }
    },
    // Async rejection support: expect(promise).rejects.toThrow(msg?)
    get rejects() {
      const promise = typeof value === 'function' ? value() : value;
      return {
        async toThrow(msgOrRe) {
          let threw = false;
          let caught;
          try { await promise; } catch (e) { threw = true; caught = e; }
          if (negated) {
            assert.ok(!threw, `Expected promise not to reject but it did`);
            return;
          }
          assert.ok(threw, 'Expected promise to reject but it resolved');
          if (msgOrRe !== undefined && caught) {
            const msg = caught instanceof Error ? caught.message : String(caught);
            if (typeof msgOrRe === 'string') {
              assert.ok(msg.includes(msgOrRe),
                `Expected rejection message "${msg}" to include "${msgOrRe}"`);
            } else if (msgOrRe instanceof RegExp) {
              assert.ok(msgOrRe.test(msg),
                `Expected rejection message "${msg}" to match ${msgOrRe}`);
            }
          }
        },
        async toEqual(expected) {
          let threw = false;
          let caught;
          try { await promise; } catch (e) { threw = true; caught = e; }
          assert.ok(threw, 'Expected promise to reject');
          assert.deepStrictEqual(caught, expected);
        },
      };
    },
  };
  return m;
}

export function expect(value) {
  const m = makeMatchers(value, false);
  m.not = makeMatchers(value, true);
  return m;
}

expect.unreachable = function(msg = 'Should be unreachable') {
  throw new assert.AssertionError({ message: msg });
};

// ── vi (mock helpers) ──────────────────────────────────────────────────────────
const _timerState = { fake: false };

export const vi = {
  fn(impl) {
    let _impl = impl;
    const calls = [];
    const mockFn = function (...args) {
      calls.push(args);
      return _impl ? _impl(...args) : undefined;
    };
    mockFn.mock = { calls };
    mockFn.mockReturnValue   = (val) => { _impl = () => val; return mockFn; };
    mockFn.mockResolvedValue = (val) => { _impl = async () => val; return mockFn; };
    mockFn.mockRejectedValue = (val) => { _impl = async () => { throw val; }; return mockFn; };
    mockFn.mockImplementation = (fn) => { _impl = fn; return mockFn; };
    mockFn.mockReset = () => { calls.length = 0; _impl = undefined; return mockFn; };
    return mockFn;
  },

  useFakeTimers() {
    _timerState.fake = true;
    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  },

  useRealTimers() {
    _timerState.fake = false;
    mock.timers.reset();
  },

  advanceTimersByTime(ms) {
    mock.timers.tick(ms);
  },

  runAllTimers() {
    mock.timers.runAll();
  },

  runAllTimersAsync() {
    mock.timers.runAll();
  },

  mock(path, factory) { if (factory) factory(); },

  spyOn(obj, method) {
    const original = obj[method];
    const calls = [];
    obj[method] = function (...args) { calls.push(args); return original.apply(this, args); };
    return {
      mock: { calls },
      mockRestore: () => { obj[method] = original; },
      mockImplementation(fn) { obj[method] = function(...args) { calls.push(args); return fn(...args); }; return this; },
    };
  },
};
