import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
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
