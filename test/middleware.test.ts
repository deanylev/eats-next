import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { createAdminJwt, ADMIN_SESSION_COOKIE } from '../lib/auth';
import { middleware } from '../middleware';

test('middleware redirects unauthenticated admin requests to an absolute login URL', async () => {
  const request = new NextRequest('https://eats.example.com/admin');

  const response = await middleware(request);

  assert.equal(response.status, 307);
  assert.equal(response.headers.get('location'), 'https://eats.example.com/admin/login');
});

test('middleware allows unauthenticated requests to the login page', async () => {
  const request = new NextRequest('https://eats.example.com/admin/login');

  const response = await middleware(request);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('location'), null);
});

test('middleware allows login page requests even when a session cookie is present', async () => {
  const previousSecret = process.env.ADMIN_JWT_SECRET;
  process.env.ADMIN_JWT_SECRET = '12345678901234567890123456789012';

  try {
    const token = await createAdminJwt('admin', {
      tenantId: 'tenant-id',
      tenantKey: 'eats-test',
      isRoot: false
    });
    const request = new NextRequest('https://eats-test.example.com/admin/login', {
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE}=${token}`
      }
    });

    const response = await middleware(request);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('location'), null);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.ADMIN_JWT_SECRET;
    } else {
      process.env.ADMIN_JWT_SECRET = previousSecret;
    }
  }
});
