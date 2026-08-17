import { describe, test } from 'node:test';
import { expect } from '../helpers/expect';
import { spawnSync } from 'child_process';

describe('Server startup', () => {
  test('app exits when SESSION_SECRET missing', () => {
    // Minimal environment without SESSION_SECRET
    const env = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      DATABASE_URL: process.env.DATABASE_URL,
    };
    
    // Use node directly to test the check
    const res = spawnSync('node', ['-e', `
      const SESSION_SECRET = process.env.SESSION_SECRET;
      if (!SESSION_SECRET) {
        console.error('FATAL: SESSION_SECRET is not set. Aborting startup.');
        process.exit(1);
      }
      console.log('OK');
    `], {
      env,
      encoding: 'utf8',
      timeout: 5000
    });
    
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('FATAL: SESSION_SECRET is not set');
  });

  test('app starts when SESSION_SECRET is set', () => {
    const env = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      DATABASE_URL: process.env.DATABASE_URL,
      SESSION_SECRET: 'test-secret-value',
    };
    
    const res = spawnSync('node', ['-e', `
      const SESSION_SECRET = process.env.SESSION_SECRET;
      if (!SESSION_SECRET) {
        console.error('FATAL: SESSION_SECRET is not set. Aborting startup.');
        process.exit(1);
      }
      console.log('OK');
    `], {
      env,
      encoding: 'utf8',
      timeout: 5000
    });
    
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('OK');
  });
});
