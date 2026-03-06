import { notFound } from 'next/navigation';
import { getCmsData } from '@/app/actions';
import { PublicEatsPage } from '@/app/components/public-eats-page';
import { buildAreaSuggestionsByCity } from '@/lib/area-suggestions';
import { flashCookieNames } from '@/lib/flash-cookies';
import { getAdminSessionForTenant, readFlashMessages, resolveRequestTenant } from '@/lib/request-context';

export const dynamic = 'force-dynamic';

type RootPageProps = {
  searchParams?: {
    openCreateDialog?: string;
    openEditRestaurant?: string;
  };
};

export default async function RootPage({ searchParams }: RootPageProps) {
  try {
    const tenant = await resolveRequestTenant();
    const { hasSession } = await getAdminSessionForTenant(tenant);
    const flashMessages = readFlashMessages([
      flashCookieNames.rootCreateError,
      flashCookieNames.rootCreateSuccess,
      flashCookieNames.rootEditError,
      flashCookieNames.rootEditSuccess,
      flashCookieNames.rootDeleteError
    ] as const);
    const data = await getCmsData(tenant.id);
    const areaSuggestionsByCity = buildAreaSuggestionsByCity(data.restaurants);
    const title = `${tenant.displayName}'s Favourite Eats`;

    return (
      <PublicEatsPage
        restaurants={data.restaurants}
        title={title}
        primaryColor={tenant.primaryColor}
        secondaryColor={tenant.secondaryColor}
        defaultCityName={data.defaultCityName}
        showAdminButton={hasSession}
        adminTools={hasSession ? { cities: data.cities, types: data.types, areaSuggestionsByCity } : undefined}
        createTools={hasSession ? { cities: data.cities, types: data.types } : undefined}
        rootCreateErrorMessage={flashMessages[flashCookieNames.rootCreateError]}
        rootCreateSuccessMessage={flashMessages[flashCookieNames.rootCreateSuccess]}
        openCreateDialogByDefault={
          searchParams?.openCreateDialog === '1' || Boolean(flashMessages[flashCookieNames.rootCreateError])
        }
        rootEditErrorMessage={flashMessages[flashCookieNames.rootEditError]}
        rootEditSuccessMessage={flashMessages[flashCookieNames.rootEditSuccess]}
        rootDeleteErrorMessage={flashMessages[flashCookieNames.rootDeleteError]}
        openEditRestaurantId={searchParams?.openEditRestaurant}
      />
    );
  } catch {
    notFound();
  }
}
