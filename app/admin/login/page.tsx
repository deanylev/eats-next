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

  const hasError = Boolean(searchParams?.error);

  return (
    <div className={styles.root}>
      <main className={styles.card}>
        <h1>Admin Login</h1>
        {hasError ? <p className={styles.error}>Invalid username or password.</p> : null}
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
