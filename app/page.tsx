import { cookies } from 'next/headers';
import { getCmsData } from '@/app/actions';
import { PublicEatsPage } from '@/app/components/public-eats-page';
import { ADMIN_SESSION_COOKIE, verifyAdminJwt } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const data = await getCmsData();
  const token = cookies().get(ADMIN_SESSION_COOKIE)?.value ?? '';
  const hasAdminSession = token ? Boolean(await verifyAdminJwt(token)) : false;

  return (
    <PublicEatsPage
      restaurants={data.restaurants}
      defaultCityName={data.defaultCityName}
      showAdminButton={hasAdminSession}
    />
  );
}
