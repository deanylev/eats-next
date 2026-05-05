'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './style.module.scss';

type CleanupRestaurant = {
  id: string;
  name: string;
  cityName: string;
  countryName: string;
  areas: string[];
  url: string;
  locations: Array<{
    id: string;
    label: string | null;
    address: string | null;
    googlePlaceId: string | null;
  }>;
};

type SingleAreaUrlCleanupToolProps = {
  restaurants: CleanupRestaurant[];
};

type BulkSummary = {
  updated: number;
  skipped: number;
  failed: number;
};

const getErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {}

  return 'Something went wrong. Please try again.';
};

export function SingleAreaUrlCleanupTool({ restaurants }: SingleAreaUrlCleanupToolProps): JSX.Element {
  const router = useRouter();
  const [urlByRestaurantId, setUrlByRestaurantId] = useState<Record<string, string>>({});
  const [busyRestaurantId, setBusyRestaurantId] = useState<string | null>(null);
  const [errorByRestaurantId, setErrorByRestaurantId] = useState<Record<string, string>>({});
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [bulkCheckedCount, setBulkCheckedCount] = useState(0);
  const [bulkTotalCount, setBulkTotalCount] = useState(0);
  const [bulkCurrentName, setBulkCurrentName] = useState<string | null>(null);
  const [bulkSummary, setBulkSummary] = useState<BulkSummary | null>(null);

  const patchRestaurantUrl = async (restaurantId: string, url: string): Promise<void> => {
    const response = await fetch('/api/admin/restaurant-url', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        restaurantId,
        url
      })
    });
    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }
  };

  const getGoogleWebsiteUrl = async (placeId: string): Promise<string | null> => {
    const response = await fetch('/api/google-maps-place-details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ placeId })
    });
    if (!response.ok) {
      throw new Error(await getErrorMessage(response));
    }

    const payload = (await response.json()) as { websiteUrl?: string | null };
    return payload.websiteUrl ?? null;
  };

  const saveRestaurantUrl = async (restaurant: CleanupRestaurant, url: string): Promise<void> => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setErrorByRestaurantId((current) => ({ ...current, [restaurant.id]: 'Enter the replacement URL.' }));
      return;
    }

    setBusyRestaurantId(restaurant.id);
    setErrorByRestaurantId((current) => {
      const next = { ...current };
      delete next[restaurant.id];
      return next;
    });

    try {
      await patchRestaurantUrl(restaurant.id, trimmedUrl);

      setUrlByRestaurantId((current) => {
        const next = { ...current };
        delete next[restaurant.id];
        return next;
      });
      router.refresh();
    } catch (error) {
      setErrorByRestaurantId((current) => ({
        ...current,
        [restaurant.id]: error instanceof Error ? error.message : 'Something went wrong. Please try again.'
      }));
    } finally {
      setBusyRestaurantId(null);
    }
  };

  const updateRestaurantUrl = async (restaurant: CleanupRestaurant): Promise<void> => {
    await saveRestaurantUrl(restaurant, urlByRestaurantId[restaurant.id] ?? '');
  };

  const useGoogleWebsiteUrls = async (): Promise<void> => {
    const nextSummary: BulkSummary = {
      updated: 0,
      skipped: 0,
      failed: 0
    };

    setIsBulkRunning(true);
    setBulkCheckedCount(0);
    setBulkTotalCount(restaurants.length);
    setBulkCurrentName(null);
    setBulkSummary({ ...nextSummary });
    setBusyRestaurantId(null);
    setErrorByRestaurantId({});

    try {
      for (const [index, restaurant] of restaurants.entries()) {
        setBulkCurrentName(restaurant.name);
        setBusyRestaurantId(restaurant.id);

        const location = restaurant.locations.find((entry) => entry.googlePlaceId);
        if (!location?.googlePlaceId) {
          nextSummary.skipped += 1;
          setErrorByRestaurantId((current) => ({
            ...current,
            [restaurant.id]: 'No saved Google place id is available for this restaurant.'
          }));
          setBulkSummary({ ...nextSummary });
          setBulkCheckedCount(index + 1);
          continue;
        }

        try {
          const websiteUrl = await getGoogleWebsiteUrl(location.googlePlaceId);
          if (!websiteUrl) {
            nextSummary.skipped += 1;
            setErrorByRestaurantId((current) => ({
              ...current,
              [restaurant.id]: 'Google Maps did not return a website for that listing.'
            }));
          } else {
            await patchRestaurantUrl(restaurant.id, websiteUrl);
            nextSummary.updated += 1;
            setUrlByRestaurantId((current) => {
              const next = { ...current };
              delete next[restaurant.id];
              return next;
            });
          }
        } catch (error) {
          nextSummary.failed += 1;
          setErrorByRestaurantId((current) => ({
            ...current,
            [restaurant.id]: error instanceof Error ? error.message : 'Something went wrong. Please try again.'
          }));
        }

        setBulkSummary({ ...nextSummary });
        setBulkCheckedCount(index + 1);
      }

      setBulkCurrentName(null);
      router.refresh();
    } finally {
      setBusyRestaurantId(null);
      setIsBulkRunning(false);
    }
  };

  if (restaurants.length === 0) {
    return <p className={styles.importHint}>No single-area places are using a Google Maps restaurant URL.</p>;
  }

  const progressPercent = bulkTotalCount > 0 ? Math.round((bulkCheckedCount / bulkTotalCount) * 100) : 0;

  return (
    <div className={styles.manageList}>
      <div className={styles.locationBackfillProgress}>
        <button type="button" onClick={() => void useGoogleWebsiteUrls()} disabled={isBulkRunning}>
          {isBulkRunning ? 'Using Google websites...' : 'Use Google websites'}
        </button>
        {isBulkRunning || bulkSummary ? (
          <div className={styles.locationBackfillStatus} aria-live="polite">
            {bulkTotalCount > 0 ? (
              <div className={styles.locationBackfillProgressBar} aria-hidden="true">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            ) : null}
            <div>
              {bulkCheckedCount} / {bulkTotalCount} checked{bulkCurrentName ? ` - ${bulkCurrentName}` : ''}
            </div>
            {bulkSummary ? (
              <div>
                Updated {bulkSummary.updated}, skipped {bulkSummary.skipped}, failed {bulkSummary.failed}.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {restaurants.map((restaurant) => {
        const isBusy = busyRestaurantId === restaurant.id;
        const isManualSaveDisabled = isBulkRunning || isBusy;

        return (
          <div className={styles.manageItem} key={restaurant.id}>
            <strong>{restaurant.name}</strong>
            <div>
              {restaurant.cityName}, {restaurant.countryName}
              {restaurant.areas.length > 0 ? ` · ${restaurant.areas.join(', ')}` : ''}
            </div>
            <p className={styles.importHint}>
              {restaurant.locations.length} map {restaurant.locations.length === 1 ? 'location' : 'locations'} saved. Current URL is Google Maps.
            </p>
            <a href={restaurant.url} target="_blank" rel="noreferrer">
              Open current Google Maps URL
            </a>
            <div className={styles.quickLocationSearch}>
              <input
                type="url"
                disabled={isBulkRunning}
                value={urlByRestaurantId[restaurant.id] ?? ''}
                placeholder="https://restaurant.example.com/"
                onChange={(event) => {
                  setUrlByRestaurantId((current) => ({ ...current, [restaurant.id]: event.target.value }));
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || isBulkRunning) {
                    return;
                  }

                  event.preventDefault();
                  void updateRestaurantUrl(restaurant);
                }}
              />
              <button type="button" disabled={isManualSaveDisabled} onClick={() => void updateRestaurantUrl(restaurant)}>
                {isBusy ? 'Saving...' : 'Save URL'}
              </button>
            </div>
            {errorByRestaurantId[restaurant.id] ? (
              <div className={styles.locationBackfillError}>{errorByRestaurantId[restaurant.id]}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
