import { notFound } from 'next/navigation';
import { getCmsData } from '@/app/actions';
import { PublicEatsPage } from '@/app/components/public-eats-page';
import { buildAreaSuggestionsByCity } from '@/lib/area-suggestions';
import { flashCookieNames } from '@/lib/flash-cookies';
import { getAdminSessionForTenant, readFlashMessages, resolveRequestTenant } from '@/lib/request-context';
import { isTenantResolutionError } from '@/lib/tenant';

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
        googleMapsBrowserApiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY ?? ''}
        defaultCityName={data.defaultCityName}
        showAdminButton={hasSession}
        adminTools={
          hasSession ? { countries: data.countries, cities: data.cities, types: data.types, areaSuggestionsByCity } : undefined
        }
        createTools={hasSession ? { countries: data.countries, cities: data.cities, types: data.types } : undefined}
        openCreateDialogByDefault={
          searchParams?.openCreateDialog === '1'
        }
        rootEditErrorMessage={flashMessages[flashCookieNames.rootEditError]}
        rootEditSuccessMessage={flashMessages[flashCookieNames.rootEditSuccess]}
        rootDeleteErrorMessage={flashMessages[flashCookieNames.rootDeleteError]}
        openEditRestaurantId={searchParams?.openEditRestaurant}
      />
    );
  } catch (error) {
    if (isTenantResolutionError(error)) {
      notFound();
    }

    throw error;
  }
}
