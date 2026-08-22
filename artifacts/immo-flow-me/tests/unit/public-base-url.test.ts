import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPublicBaseUrl,
  PUBLIC_PRODUCTION_BASE_URL,
} from '../../server/lib/publicBaseUrl';

test('öffentliche Basis-URL verwendet in Produktion immer die kanonische Domain', () => {
  assert.equal(
    getPublicBaseUrl({
      NODE_ENV: 'production',
      APP_BASE_URL: 'https://immoflowme.app',
      REPLIT_DEV_DOMAIN: 'preview.replit.app',
    }),
    PUBLIC_PRODUCTION_BASE_URL,
  );
});

test('öffentliche Basis-URL unterstützt eine explizite Entwicklungs- oder Staging-URL', () => {
  assert.equal(
    getPublicBaseUrl({
      NODE_ENV: 'development',
      APP_BASE_URL: 'https://staging.immoflowme.at/',
      REPLIT_DEV_DOMAIN: 'preview.replit.dev',
    }),
    'https://staging.immoflowme.at',
  );
});

test('öffentliche Basis-URL verwendet in der Replit-Entwicklung die Dev-Domain', () => {
  assert.equal(
    getPublicBaseUrl({
      NODE_ENV: 'development',
      REPLIT_DEV_DOMAIN: 'preview.replit.dev',
    }),
    'https://preview.replit.dev',
  );
});

test('öffentliche Basis-URL fällt lokal sicher auf localhost zurück', () => {
  assert.equal(
    getPublicBaseUrl({ NODE_ENV: 'development', APP_BASE_URL: 'not a URL' }),
    'http://localhost:5000',
  );
});