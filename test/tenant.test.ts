import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTenantHost,
  normalizeHost,
  parseHostForTenant,
  resolvePublicRequestHostWithPort,
  resolveRequestHost,
  resolveRequestHostWithPort
} from '../lib/tenant';

test('normalizeHost lowercases and strips ports', () => {
  assert.equal(normalizeHost('EATS-Test.LocalHost:3000'), 'eats-test.localhost');
});

test('resolveRequestHost prefers forwarded host when behind an internal proxy', () => {
  assert.equal(resolveRequestHost('127.0.0.1:3000', 'eats-test.localhost:3000'), 'eats-test.localhost');
});

test('resolveRequestHost ignores forwarded host when host is already public', () => {
  assert.equal(resolveRequestHost('eats-test.example.com', 'malicious.example.com'), 'eats-test.example.com');
});

test('resolveRequestHostWithPort preserves ports for forwarded localhost requests', () => {
  assert.equal(resolveRequestHostWithPort('127.0.0.1:3000', 'eats-test.localhost:3000'), 'eats-test.localhost:3000');
  assert.equal(resolveRequestHostWithPort('localhost:3000', null), 'localhost:3000');
});

test('resolvePublicRequestHostWithPort prefers origin, then forwarded host, then raw host', () => {
  assert.equal(
    resolvePublicRequestHostWithPort(
      'eats.deanlevinson.com.au:8085',
      'eats.deanlevinson.com.au',
      'https://eats.deanlevinson.com.au/admin',
      null
    ),
    'eats.deanlevinson.com.au'
  );
  assert.equal(
    resolvePublicRequestHostWithPort('eats.deanlevinson.com.au:8085', 'eats.deanlevinson.com.au', null, null),
    'eats.deanlevinson.com.au'
  );
  assert.equal(resolvePublicRequestHostWithPort('localhost:3000', null, null, null), 'localhost:3000');
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

test('buildTenantHost switches between root and localhost tenant hosts', () => {
  assert.equal(buildTenantHost('localhost:3000', 'eats-test'), 'eats-test.localhost:3000');
  assert.equal(buildTenantHost('eats-test.localhost:3000', null), 'localhost:3000');
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
    assert.equal(buildTenantHost('eats.deanlevinson.com.au', 'eats-test'), 'eats-test.deanlevinson.com.au');
    assert.equal(buildTenantHost('eats-test.deanlevinson.com.au', null), 'eats.deanlevinson.com.au');
  } finally {
    if (previousRootDomain === undefined) {
      delete process.env.ROOT_DOMAIN;
    } else {
      process.env.ROOT_DOMAIN = previousRootDomain;
    }
  }
});

test('buildTenantHost ignores ports embedded in ROOT_DOMAIN', () => {
  const previousRootDomain = process.env.ROOT_DOMAIN;
  process.env.ROOT_DOMAIN = 'eats.deanlevinson.com.au:8085';

  try {
    assert.equal(buildTenantHost('eats.deanlevinson.com.au:8085', 'eats-test'), 'eats-test.deanlevinson.com.au');
    assert.equal(buildTenantHost('eats-test.deanlevinson.com.au:8085', null), 'eats.deanlevinson.com.au');
  } finally {
    if (previousRootDomain === undefined) {
      delete process.env.ROOT_DOMAIN;
    } else {
      process.env.ROOT_DOMAIN = previousRootDomain;
    }
  }
});
