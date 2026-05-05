'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './style.module.scss';

type GoogleMapsSuggestion = {
  fullText: string;
  placeId: string;
  primaryText: string;
  secondaryText: string;
};

type LocationRow = {
  id: string;
  label: string | null;
  address: string | null;
  googlePlaceId: string | null;
};

type AuditRestaurant = {
  id: string;
  name: string;
  cityName: string;
  countryName: string;
  areas: string[];
  locations: LocationRow[];
};

type MultiAreaLocationToolProps = {
  restaurants: AuditRestaurant[];
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

export function MultiAreaLocationTool({ restaurants }: MultiAreaLocationToolProps): JSX.Element {
  const router = useRouter();
  const [searchByRestaurantId, setSearchByRestaurantId] = useState<Record<string, string>>({});
  const [suggestionsByRestaurantId, setSuggestionsByRestaurantId] = useState<Record<string, GoogleMapsSuggestion[]>>({});
  const [selectedSuggestionIdsByRestaurantId, setSelectedSuggestionIdsByRestaurantId] = useState<Record<string, string[]>>({});
  const [errorByRestaurantId, setErrorByRestaurantId] = useState<Record<string, string>>({});
  const [busyRestaurantId, setBusyRestaurantId] = useState<string | null>(null);
  const [sessionTokenByRestaurantId, setSessionTokenByRestaurantId] = useState<Record<string, string>>({});

  const setRestaurantError = (restaurantId: string, message: string): void => {
    setErrorByRestaurantId((current) => ({ ...current, [restaurantId]: message }));
  };

  const clearRestaurantError = (restaurantId: string): void => {
    setErrorByRestaurantId((current) => {
      const next = { ...current };
      delete next[restaurantId];
      return next;
    });
  };

  const getSessionToken = (restaurantId: string): string => {
    const existing = sessionTokenByRestaurantId[restaurantId];
    if (existing) {
      return existing;
    }

    const nextToken = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}`;
    setSessionTokenByRestaurantId((current) => ({ ...current, [restaurantId]: nextToken }));
    return nextToken;
  };

  const getSearchInput = (restaurant: AuditRestaurant): string =>
    searchByRestaurantId[restaurant.id] ?? restaurant.name;

  const searchGoogleMaps = async (restaurant: AuditRestaurant): Promise<void> => {
    const input = getSearchInput(restaurant).trim();
    if (input.length < 2) {
      setRestaurantError(restaurant.id, 'Enter at least two characters.');
      return;
    }

    setBusyRestaurantId(restaurant.id);
    clearRestaurantError(restaurant.id);

    try {
      const response = await fetch('/api/google-maps-autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cityName: restaurant.cityName,
          countryName: restaurant.countryName,
          input,
          sessionToken: getSessionToken(restaurant.id)
        })
      });
      if (!response.ok) {
        throw new Error(await getErrorMessage(response));
      }

      const payload = (await response.json()) as { suggestions?: GoogleMapsSuggestion[] };
      setSuggestionsByRestaurantId((current) => ({ ...current, [restaurant.id]: payload.suggestions ?? [] }));
      setSelectedSuggestionIdsByRestaurantId((current) => ({ ...current, [restaurant.id]: [] }));
    } catch (error) {
      setRestaurantError(restaurant.id, error instanceof Error ? error.message : 'Something went wrong. Please try again.');
      setSuggestionsByRestaurantId((current) => ({ ...current, [restaurant.id]: [] }));
      setSelectedSuggestionIdsByRestaurantId((current) => ({ ...current, [restaurant.id]: [] }));
    } finally {
      setBusyRestaurantId(null);
    }
  };

  const toggleSuggestionSelection = (restaurantId: string, placeId: string, checked: boolean): void => {
    setSelectedSuggestionIdsByRestaurantId((current) => {
      const selected = current[restaurantId] ?? [];
      if (checked) {
        return selected.includes(placeId) ? current : { ...current, [restaurantId]: [...selected, placeId] };
      }

      return { ...current, [restaurantId]: selected.filter((selectedPlaceId) => selectedPlaceId !== placeId) };
    });
  };

  const addSelectedLocations = async (restaurant: AuditRestaurant, selectedSuggestions: GoogleMapsSuggestion[]): Promise<void> => {
    const savedGooglePlaceIds = new Set(
      restaurant.locations
        .map((location) => location.googlePlaceId)
        .filter((googlePlaceId): googlePlaceId is string => Boolean(googlePlaceId))
    );
    const unsavedSuggestions = selectedSuggestions.filter((suggestion) => !savedGooglePlaceIds.has(suggestion.placeId));

    if (unsavedSuggestions.length === 0) {
      setRestaurantError(restaurant.id, 'Choose at least one map result.');
      return;
    }

    setBusyRestaurantId(restaurant.id);
    clearRestaurantError(restaurant.id);

    try {
      for (const suggestion of unsavedSuggestions) {
        const detailsResponse = await fetch('/api/google-maps-place-details', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            placeId: suggestion.placeId,
            sessionToken: sessionTokenByRestaurantId[restaurant.id] || undefined
          })
        });
        if (!detailsResponse.ok) {
          throw new Error(await getErrorMessage(detailsResponse));
        }

        const details = (await detailsResponse.json()) as {
          address?: string | null;
          label?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          placeId?: string | null;
          url?: string | null;
        };
        if (!details.url || typeof details.latitude !== 'number' || typeof details.longitude !== 'number') {
          throw new Error(`Google Maps did not return coordinates for ${suggestion.primaryText}.`);
        }

        const createResponse = await fetch('/api/admin/restaurant-locations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            restaurantId: restaurant.id,
            label: details.label || suggestion.primaryText,
            address: details.address ?? null,
            googlePlaceId: details.placeId || suggestion.placeId,
            googleMapsUrl: details.url,
            latitude: details.latitude,
            longitude: details.longitude
          })
        });
        if (!createResponse.ok) {
          throw new Error(await getErrorMessage(createResponse));
        }
      }

      setSearchByRestaurantId((current) => ({ ...current, [restaurant.id]: '' }));
      setSuggestionsByRestaurantId((current) => ({ ...current, [restaurant.id]: [] }));
      setSelectedSuggestionIdsByRestaurantId((current) => ({ ...current, [restaurant.id]: [] }));
      setSessionTokenByRestaurantId((current) => {
        const next = { ...current };
        delete next[restaurant.id];
        return next;
      });
      router.refresh();
    } catch (error) {
      setRestaurantError(restaurant.id, error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setBusyRestaurantId(null);
    }
  };

  const getAddButtonLabel = (count: number, all = false): string => {
    if (all && count === 1) {
      return 'Add location';
    }

    const prefix = all ? 'Add all' : 'Add';
    if (count === 1) {
      return `${prefix} 1 ${all ? 'location' : 'selected location'}`;
    }

    return `${prefix} ${count} ${all ? 'locations' : 'selected locations'}`;
  };

  if (restaurants.length === 0) {
    return <p className={styles.importHint}>No multi-area places need extra map locations.</p>;
  }

  return (
    <div className={styles.manageList}>
      {restaurants.map((restaurant) => {
        const savedGooglePlaceIds = new Set(
          restaurant.locations
            .map((location) => location.googlePlaceId)
            .filter((googlePlaceId): googlePlaceId is string => Boolean(googlePlaceId))
        );
        const suggestions = (suggestionsByRestaurantId[restaurant.id] ?? []).filter(
          (suggestion) => !savedGooglePlaceIds.has(suggestion.placeId)
        );
        const selectedSuggestionIds = selectedSuggestionIdsByRestaurantId[restaurant.id] ?? [];
        const selectedSuggestions = suggestions.filter((suggestion) => selectedSuggestionIds.includes(suggestion.placeId));
        const isBusy = busyRestaurantId === restaurant.id;

        return (
          <div className={styles.manageItem} key={restaurant.id}>
            <strong>{restaurant.name}</strong>
            <div>
              {restaurant.cityName}, {restaurant.countryName} · {restaurant.areas.join(', ')}
            </div>
            <p className={styles.importHint}>
              {restaurant.locations.length === 1
                ? `1 map location: ${restaurant.locations[0]?.label ?? restaurant.locations[0]?.address ?? 'Saved location'}`
                : 'No map locations yet.'}
            </p>
            <div className={styles.quickLocationSearch}>
              <input
                type="text"
                value={getSearchInput(restaurant)}
                onChange={(event) => {
                  setSearchByRestaurantId((current) => ({ ...current, [restaurant.id]: event.target.value }));
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') {
                    return;
                  }

                  event.preventDefault();
                  void searchGoogleMaps(restaurant);
                }}
              />
              <button type="button" disabled={isBusy} onClick={() => void searchGoogleMaps(restaurant)}>
                {isBusy ? 'Working...' : 'Search Maps'}
              </button>
            </div>
            {errorByRestaurantId[restaurant.id] ? (
              <div className={styles.locationBackfillError}>{errorByRestaurantId[restaurant.id]}</div>
            ) : null}
            {suggestions.length > 0 ? (
              <div className={styles.quickLocationSuggestions}>
                {suggestions.map((suggestion) => (
                  <label
                    key={suggestion.placeId}
                    className={styles.quickLocationSuggestion}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSuggestionIds.includes(suggestion.placeId)}
                      disabled={isBusy}
                      onChange={(event) => {
                        toggleSuggestionSelection(restaurant.id, suggestion.placeId, event.target.checked);
                      }}
                    />
                    <span className={styles.quickLocationSuggestionCopy}>
                      <span>{suggestion.primaryText}</span>
                      {suggestion.secondaryText ? <small>{suggestion.secondaryText}</small> : null}
                    </span>
                  </label>
                ))}
                <div className={styles.quickLocationSubmitRow}>
                  <button
                    type="button"
                    disabled={isBusy || suggestions.length === 0}
                    onClick={() => void addSelectedLocations(restaurant, suggestions)}
                  >
                    {isBusy ? 'Adding...' : getAddButtonLabel(suggestions.length, true)}
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || selectedSuggestions.length === 0}
                    onClick={() => void addSelectedLocations(restaurant, selectedSuggestions)}
                  >
                    {isBusy ? 'Adding...' : getAddButtonLabel(selectedSuggestions.length)}
                  </button>
                  <span>
                    {selectedSuggestions.length === 0
                      ? 'Select the branches to add.'
                      : `${selectedSuggestions.length} selected`}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
