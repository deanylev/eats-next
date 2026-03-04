import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import { loginAdmin } from '@/app/actions';
import { ADMIN_SESSION_COOKIE, verifyAdminJwt } from '@/lib/auth';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { getDb } from '@/lib/db';
import { buildThemeCssVariables } from '@/lib/theme';
import { resolveRequestHost, resolveTenantFromHost, type ResolvedTenant } from '@/lib/tenant';

import styles from './style.module.scss';

export const dynamic = 'force-dynamic';

type LoginPageProps = {
  searchParams?: {
    error?: string;
  };
};

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const host = resolveRequestHost(headers().get('host'), headers().get('x-forwarded-host'));
  let tenant: ResolvedTenant;
  try {
    tenant = await resolveTenantFromHost(getDb(), host);
  } catch {
    notFound();
  }
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value ?? '';
  const session = token ? await verifyAdminJwt(token) : null;
  const hasSession = doesSessionMatchTenant(session, tenant);
  if (hasSession) {
    redirect('/admin');
  }

  const error = searchParams?.error ?? '';
  const errorMessage =
    error === 'rate'
      ? 'Too many login attempts. Please wait and try again.'
      : error === 'misconfigured'
        ? 'Admin auth is not configured correctly.'
        : error
          ? 'Invalid username or password.'
          : null;
  const rootStyle = buildThemeCssVariables(tenant.primaryColor, tenant.secondaryColor, 'tenant') as CSSProperties;

  return (
    <div className={styles.root} style={rootStyle}>
      <main className={styles.card}>
        <h1>{tenant.displayName} Admin Login</h1>
        {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
        <form action={loginAdmin}>
          <label>
            Username
            <input name="username" required autoComplete="username" />
          </label>
          <label>
            Password
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
          <button type="submit">Log In</button>
        </form>
      </main>
    </div>
  );
}
