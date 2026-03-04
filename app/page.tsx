import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getCmsData } from '@/app/actions';
import { PublicEatsPage } from '@/app/components/public-eats-page';
import { ADMIN_SESSION_COOKIE, verifyAdminJwt } from '@/lib/auth';
import { doesSessionMatchTenant } from '@/lib/admin-session';
import { buildAreaSuggestionsByCity } from '@/lib/area-suggestions';
import { getDb } from '@/lib/db';
import { decodeFlashMessage, flashCookieNames } from '@/lib/flash-cookies';
import { resolveRequestHost, resolveTenantFromHost, type ResolvedTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

type RootPageProps = {
  searchParams?: {
    openCreateDialog?: string;
    openEditRestaurant?: string;
  };
};

export default async function RootPage({ searchParams }: RootPageProps) {
  const host = resolveRequestHost(headers().get('host'), headers().get('x-forwarded-host'));
  let tenant: ResolvedTenant;
  try {
    tenant = await resolveTenantFromHost(getDb(), host);
  } catch {
    notFound();
  }
  const data = await getCmsData(tenant.id);
  const areaSuggestionsByCity = buildAreaSuggestionsByCity(data.restaurants);
  const cookieStore = cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? '';
  const rootCreateErrorMessage = decodeFlashMessage(cookieStore.get(flashCookieNames.rootCreateError)?.value);
  const rootCreateSuccessMessage = decodeFlashMessage(cookieStore.get(flashCookieNames.rootCreateSuccess)?.value);
  const rootEditErrorMessage = decodeFlashMessage(cookieStore.get(flashCookieNames.rootEditError)?.value);
  const rootEditSuccessMessage = decodeFlashMessage(cookieStore.get(flashCookieNames.rootEditSuccess)?.value);
  const rootDeleteErrorMessage = decodeFlashMessage(cookieStore.get(flashCookieNames.rootDeleteError)?.value);
  const session = token ? await verifyAdminJwt(token) : null;
  const hasAdminSession = doesSessionMatchTenant(session, tenant);
  const title = `${tenant.displayName}'s Favourite Eats`;

  return (
    <PublicEatsPage
      restaurants={data.restaurants}
      title={title}
      primaryColor={tenant.primaryColor}
      secondaryColor={tenant.secondaryColor}
      defaultCityName={data.defaultCityName}
      showAdminButton={hasAdminSession}
      adminTools={hasAdminSession ? { cities: data.cities, types: data.types, areaSuggestionsByCity } : undefined}
      createTools={hasAdminSession ? { cities: data.cities, types: data.types } : undefined}
      rootCreateErrorMessage={rootCreateErrorMessage}
      rootCreateSuccessMessage={rootCreateSuccessMessage}
      openCreateDialogByDefault={searchParams?.openCreateDialog === '1' || Boolean(rootCreateErrorMessage)}
      rootEditErrorMessage={rootEditErrorMessage}
      rootEditSuccessMessage={rootEditSuccessMessage}
      rootDeleteErrorMessage={rootDeleteErrorMessage}
      openEditRestaurantId={searchParams?.openEditRestaurant}
    />
  );
}
