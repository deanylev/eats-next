import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { loginAdmin } from '@/app/actions';
import { ADMIN_SESSION_COOKIE, verifyAdminJwt } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { normalizeHost, resolveTenantFromHost } from '@/lib/tenant';

import styles from './style.module.scss';

export const dynamic = 'force-dynamic';

type LoginPageProps = {
  searchParams?: {
    error?: string;
  };
};

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const host = normalizeHost(headers().get('host') || '');
  let tenant: Awaited<ReturnType<typeof resolveTenantFromHost>>;
  try {
    tenant = await resolveTenantFromHost(getDb(), host);
  } catch {
    notFound();
  }
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value ?? '';
  const session = token ? await verifyAdminJwt(token) : null;
  const hasSession = Boolean(
    session &&
      session.tenantId === tenant.id &&
      session.isRoot === tenant.isRoot &&
      session.tenantKey === (tenant.isRoot ? 'root' : tenant.subdomain ?? '')
  );
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

  return (
    <div className={styles.root}>
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
