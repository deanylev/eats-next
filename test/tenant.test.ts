import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHost, parseHostForTenant, resolveRequestHost } from '../lib/tenant';

test('normalizeHost lowercases and strips ports', () => {
  assert.equal(normalizeHost('EATS-Test.LocalHost:3000'), 'eats-test.localhost');
});

test('resolveRequestHost prefers forwarded host when behind an internal proxy', () => {
  assert.equal(resolveRequestHost('127.0.0.1:3000', 'eats-test.localhost:3000'), 'eats-test.localhost');
});

test('resolveRequestHost ignores forwarded host when host is already public', () => {
  assert.equal(resolveRequestHost('eats-test.example.com', 'malicious.example.com'), 'eats-test.example.com');
});

test('parseHostForTenant treats localhost as root', () => {
  assert.deepEqual(parseHostForTenant('localhost:3000'), {
    isRootHost: true,
    subdomain: null
  });
});

test('parseHostForTenant extracts localhost tenant subdomains', () => {
  assert.deepEqual(parseHostForTenant('eats-test.localhost:3000'), {
    isRootHost: false,
    subdomain: 'eats-test'
  });
});

test('parseHostForTenant extracts production tenant subdomains', () => {
  const previousRootDomain = process.env.ROOT_DOMAIN;
  process.env.ROOT_DOMAIN = 'eats.deanlevinson.com.au';

  try {
    assert.deepEqual(parseHostForTenant('eats-test.deanlevinson.com.au'), {
      isRootHost: false,
      subdomain: 'eats-test'
    });
    assert.deepEqual(parseHostForTenant('eats.deanlevinson.com.au'), {
      isRootHost: true,
      subdomain: null
    });
  } finally {
    if (previousRootDomain === undefined) {
      delete process.env.ROOT_DOMAIN;
    } else {
      process.env.ROOT_DOMAIN = previousRootDomain;
    }
  }
});
