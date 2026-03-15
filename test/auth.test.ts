import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMIN_HANDOFF_TTL_SECONDS,
  createAdminHandoffToken,
  createAdminJwt,
  verifyAdminHandoffToken,
  verifyAdminJwt
} from '../lib/auth';

test('admin session tokens round-trip through verification', async () => {
  const previousSecret = process.env.ADMIN_JWT_SECRET;
  process.env.ADMIN_JWT_SECRET = 'test-secret-value-with-at-least-32chars';

  try {
    const token = await createAdminJwt('dean', {
      tenantId: 'tenant-1',
      tenantKey: 'eats-dean',
      isRoot: false
    });
    const payload = await verifyAdminJwt(token);

    assert.equal(payload?.sub, 'admin_tenant');
    assert.equal(payload?.username, 'dean');
    assert.equal(payload?.tenantId, 'tenant-1');
    assert.equal(payload?.tenantKey, 'eats-dean');
    assert.equal(payload?.isRoot, false);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.ADMIN_JWT_SECRET;
    } else {
      process.env.ADMIN_JWT_SECRET = previousSecret;
    }
  }
});

test('admin handoff tokens encode a short-lived root-to-tenant login handoff', async () => {
  const previousSecret = process.env.ADMIN_JWT_SECRET;
  process.env.ADMIN_JWT_SECRET = 'test-secret-value-with-at-least-32chars';

  try {
    const token = await createAdminHandoffToken({
      sourceUsername: 'root-admin',
      sourceTenantId: 'root-tenant',
      sourceTenantKey: 'root',
      targetTenantId: 'tenant-2',
      targetTenantKey: 'eats-target'
    });
    const payload = await verifyAdminHandoffToken(token);

    assert.equal(payload?.sub, 'admin_handoff');
    assert.equal(payload?.sourceUsername, 'root-admin');
    assert.equal(payload?.sourceTenantId, 'root-tenant');
    assert.equal(payload?.sourceTenantKey, 'root');
    assert.equal(payload?.sourceIsRoot, true);
    assert.equal(payload?.targetTenantId, 'tenant-2');
    assert.equal(payload?.targetTenantKey, 'eats-target');
    assert.ok(payload);
    assert.ok(payload.exp - payload.iat <= ADMIN_HANDOFF_TTL_SECONDS + 1);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.ADMIN_JWT_SECRET;
    } else {
      process.env.ADMIN_JWT_SECRET = previousSecret;
    }
  }
});
