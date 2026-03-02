import { cookies } from 'next/headers';
import { getCmsData } from '@/app/actions';
import { PublicEatsPage } from '@/app/components/public-eats-page';
import { ADMIN_SESSION_COOKIE, verifyAdminJwt } from '@/lib/auth';

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
  const data = await getCmsData();
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
  const hasAdminSession = token ? Boolean(await verifyAdminJwt(token)) : false;

  return (
    <PublicEatsPage
      restaurants={data.restaurants}
      defaultCityName={data.defaultCityName}
      showAdminButton={hasAdminSession}
      adminTools={hasAdminSession ? { cities: data.cities, types: data.types } : undefined}
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
