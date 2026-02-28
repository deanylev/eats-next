import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginAdmin } from '@/app/actions';
import { ADMIN_SESSION_COOKIE, verifyAdminJwt } from '@/lib/auth';

import styles from './style.module.scss';

export const dynamic = 'force-dynamic';

type LoginPageProps = {
  searchParams?: {
    error?: string;
  };
};

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value ?? '';
  const hasSession = token ? Boolean(await verifyAdminJwt(token)) : false;
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
}
