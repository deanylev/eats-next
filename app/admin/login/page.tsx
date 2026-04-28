import { notFound, redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import { loginAdmin } from '@/app/actions';
import { getAdminSessionForTenant, resolveRequestTenant } from '@/lib/request-context';
import { isTenantResolutionError } from '@/lib/tenant';
import { buildThemeCssVariables } from '@/lib/theme';

import styles from './style.module.scss';

export const dynamic = 'force-dynamic';

type LoginPageProps = {
  searchParams?: {
    error?: string;
  };
};

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  try {
    const tenant = await resolveRequestTenant();
    const { hasSession } = await getAdminSessionForTenant(tenant);
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
          <h1>Admin Login</h1>
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
  } catch (error) {
    if (isTenantResolutionError(error)) {
      notFound();
    }

    throw error;
  }
}
