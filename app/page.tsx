import { cookies } from 'next/headers';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getCmsData } from '@/app/actions';
import { PublicEatsPage } from '@/app/components/public-eats-page';
import { ADMIN_SESSION_COOKIE, verifyAdminJwt } from '@/lib/auth';
import { buildAreaSuggestionsByCity } from '@/lib/area-suggestions';
import { getDb } from '@/lib/db';
import { normalizeHost, resolveTenantFromHost } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
const ROOT_CREATE_ERROR_COOKIE = 'root_create_error_message';
const ROOT_CREATE_SUCCESS_COOKIE = 'root_create_success_message';
const ROOT_EDIT_ERROR_COOKIE = 'root_edit_error_message';
const ROOT_EDIT_SUCCESS_COOKIE = 'root_edit_success_message';
const ROOT_DELETE_ERROR_COOKIE = 'root_delete_error_message';

type RootPageProps = {
  searchParams?: {
    openCreateDialog?: string;
    openEditRestaurant?: string;
  };
};

export default async function RootPage({ searchParams }: RootPageProps) {
  const host = normalizeHost(headers().get('host') || '');
  let tenant: Awaited<ReturnType<typeof resolveTenantFromHost>>;
  try {
    tenant = await resolveTenantFromHost(getDb(), host);
  } catch {
    notFound();
  }
  const data = await getCmsData(tenant.id);
  const areaSuggestionsByCity = buildAreaSuggestionsByCity(data.restaurants);
  const cookieStore = cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? '';
  const encodedRootCreateError = cookieStore.get(ROOT_CREATE_ERROR_COOKIE)?.value ?? null;
  const rootCreateErrorMessage = encodedRootCreateError ? decodeURIComponent(encodedRootCreateError) : null;
  const encodedRootCreateSuccess = cookieStore.get(ROOT_CREATE_SUCCESS_COOKIE)?.value ?? null;
  const rootCreateSuccessMessage = encodedRootCreateSuccess ? decodeURIComponent(encodedRootCreateSuccess) : null;
  const encodedRootEditError = cookieStore.get(ROOT_EDIT_ERROR_COOKIE)?.value ?? null;
  const rootEditErrorMessage = encodedRootEditError ? decodeURIComponent(encodedRootEditError) : null;
  const encodedRootEditSuccess = cookieStore.get(ROOT_EDIT_SUCCESS_COOKIE)?.value ?? null;
  const rootEditSuccessMessage = encodedRootEditSuccess ? decodeURIComponent(encodedRootEditSuccess) : null;
  const encodedRootDeleteError = cookieStore.get(ROOT_DELETE_ERROR_COOKIE)?.value ?? null;
  const rootDeleteErrorMessage = encodedRootDeleteError ? decodeURIComponent(encodedRootDeleteError) : null;
  const session = token ? await verifyAdminJwt(token) : null;
  const hasAdminSession = Boolean(
    session &&
      session.tenantId === tenant.id &&
      session.isRoot === tenant.isRoot &&
      session.tenantKey === (tenant.isRoot ? 'root' : tenant.subdomain ?? '')
  );
  const title = `${tenant.displayName}'s Favourite Eats`;

  return (
    <PublicEatsPage
      restaurants={data.restaurants}
      title={title}
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
