'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { updateRestaurant } from '@/app/actions';
import { DeleteRestaurantForm } from '@/app/components/delete-restaurant-form';
import { RestaurantFormFields } from '@/app/components/restaurant-form-fields';

import styles from './style.module.scss';

type RestaurantType = {
  id: string;
  name: string;
  emoji: string;
};

type PublicRestaurant = {
  id: string;
  cityId: string;
  cityName: string;
  countryName: string;
  name: string;
  notes: string;
  referredBy: string;
  url: string;
  status: 'untried' | 'liked' | 'disliked';
  dislikedReason: string | null;
  areas: string[];
  mealTypes: string[];
  types: RestaurantType[];
};

type Props = {
  restaurants: PublicRestaurant[];
  title?: string | null;
  embedded?: boolean;
  adminTools?: {
    cities: Array<{ id: string; name: string; countryName: string }>;
    types: Array<{ id: string; name: string; emoji: string }>;
  };
};

type StatusFilter = 'untriedLiked' | 'liked' | 'wanted' | 'disliked';
type CategoryFilter = 'area' | 'type' | 'mealType';

const mealLabel = (meal: string): string => {
  if (meal === 'snack') {
    return 'Snack';
  }

  if (meal === 'breakfast') {
    return 'Breakfast';
  }

  if (meal === 'lunch') {
    return 'Lunch';
  }

  if (meal === 'dinner') {
    return 'Dinner';
  }

  return meal;
};

const byAlpha = (a: string, b: string): number => a.localeCompare(b);

const isUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export function PublicEatsPage({ restaurants, title = `Dean's Favourite Eats`, embedded = false, adminTools }: Props) {
  const triedCount = restaurants.filter((restaurant) => restaurant.status === 'liked').length;
  const wantedCount = restaurants.filter((restaurant) => restaurant.status === 'untried').length;

  const [status, setStatus] = useState<StatusFilter>('untriedLiked');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedMealType, setSelectedMealType] = useState<string>('Any');
  const [category, setCategory] = useState<CategoryFilter>('area');
  const [excluded, setExcluded] = useState<string[]>([]);

  const statusFilteredRestaurants = useMemo(() => {
    if (status === 'liked') {
      return restaurants.filter((restaurant) => restaurant.status === 'liked');
    }

    if (status === 'wanted') {
      return restaurants.filter((restaurant) => restaurant.status === 'untried');
    }

    if (status === 'disliked') {
      return restaurants.filter((restaurant) => restaurant.status === 'disliked');
    }

    return restaurants.filter((restaurant) => restaurant.status !== 'disliked');
  }, [restaurants, status]);

  const citiesByCountry = useMemo(() => {
    const map = new Map<string, Map<string, number>>();

    for (const restaurant of statusFilteredRestaurants) {
      const countryMap = map.get(restaurant.countryName) ?? new Map<string, number>();
      countryMap.set(restaurant.cityName, (countryMap.get(restaurant.cityName) ?? 0) + 1);
      map.set(restaurant.countryName, countryMap);
    }

    return new Map(
      [...map.entries()]
        .sort(([countryA], [countryB]) => byAlpha(countryA, countryB))
        .map(([country, cityMap]) => [country, new Map([...cityMap.entries()].sort(([a], [b]) => byAlpha(a, b)))])
    );
  }, [statusFilteredRestaurants]);

  useEffect(() => {
    if (!selectedCity) {
      const melbourneExists = [...citiesByCountry.values()].some((cityMap) => cityMap.has('Melbourne'));
      if (melbourneExists) {
        setSelectedCity('Melbourne');
        return;
      }

      const firstCity = [...citiesByCountry.values()][0]?.keys().next().value;
      if (firstCity) {
        setSelectedCity(firstCity);
      }
      return;
    }

    const cityStillExists = [...citiesByCountry.values()].some((cityMap) => cityMap.has(selectedCity));
    if (!cityStillExists) {
      const firstCity = [...citiesByCountry.values()][0]?.keys().next().value ?? '';
      setSelectedCity(firstCity);
    }
  }, [citiesByCountry, selectedCity]);

  const cityRestaurants = useMemo(
    () => statusFilteredRestaurants.filter((restaurant) => restaurant.cityName === selectedCity),
    [selectedCity, statusFilteredRestaurants]
  );

  const mealTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const restaurant of cityRestaurants) {
      for (const meal of restaurant.mealTypes) {
        counts.set(meal, (counts.get(meal) ?? 0) + 1);
      }
    }

    return new Map([...counts.entries()].sort(([a], [b]) => byAlpha(mealLabel(a), mealLabel(b))));
  }, [cityRestaurants]);

  useEffect(() => {
    if (selectedMealType === 'Any') {
      return;
    }

    if (!mealTypeCounts.has(selectedMealType)) {
      setSelectedMealType('Any');
    }
  }, [mealTypeCounts, selectedMealType]);

  const mealFilteredRestaurants = useMemo(() => {
    if (selectedMealType === 'Any') {
      return cityRestaurants;
    }

    return cityRestaurants.filter((restaurant) => restaurant.mealTypes.includes(selectedMealType));
  }, [cityRestaurants, selectedMealType]);

  const headings = useMemo(() => {
    const values = new Set<string>();

    for (const restaurant of mealFilteredRestaurants) {
      if (category === 'area') {
        if (restaurant.areas.length === 0) {
          values.add(selectedCity);
        } else {
          for (const area of restaurant.areas) {
            values.add(area);
          }
        }
      }

      if (category === 'type') {
        for (const type of restaurant.types) {
          values.add(type.name);
        }
      }

      if (category === 'mealType') {
        for (const mealType of restaurant.mealTypes) {
          values.add(mealType);
        }
      }
    }

    return [...values].sort((a, b) =>
      byAlpha(category === 'mealType' ? mealLabel(a) : a, category === 'mealType' ? mealLabel(b) : b)
    );
  }, [category, mealFilteredRestaurants, selectedCity]);

  useEffect(() => {
    setExcluded((current) => current.filter((entry) => headings.includes(entry)));
  }, [headings]);

  useEffect(() => {
    setExcluded([]);
  }, [status, selectedCity, selectedMealType, category]);

  const grouped = useMemo(() => {
    const map = new Map<string, PublicRestaurant[]>();

    for (const restaurant of mealFilteredRestaurants) {
      const headingValues: string[] = [];
      if (category === 'area') {
        headingValues.push(...(restaurant.areas.length > 0 ? restaurant.areas : [selectedCity]));
      }

      if (category === 'type') {
        headingValues.push(...restaurant.types.map((type) => type.name));
      }

      if (category === 'mealType') {
        headingValues.push(...restaurant.mealTypes);
      }

      for (const heading of headingValues) {
        if (excluded.includes(heading)) {
          continue;
        }

        const current = map.get(heading) ?? [];
        current.push(restaurant);
        map.set(heading, current);
      }
    }

    return new Map(
      [...map.entries()].sort(([headingA], [headingB]) =>
        byAlpha(category === 'mealType' ? mealLabel(headingA) : headingA, category === 'mealType' ? mealLabel(headingB) : headingB)
      )
    );
  }, [category, excluded, mealFilteredRestaurants, selectedCity]);

  const statusCount = (filter: StatusFilter): number => {
    if (!selectedCity) {
      return 0;
    }

    return restaurants.filter((restaurant) => {
      if (restaurant.cityName !== selectedCity) {
        return false;
      }

      if (filter === 'wanted') {
        return restaurant.status === 'untried';
      }

      if (filter === 'liked') {
        return restaurant.status === 'liked';
      }

      if (filter === 'disliked') {
        return restaurant.status === 'disliked';
      }

      return restaurant.status !== 'disliked';
    }).length;
  };

  return (
    <div className={embedded ? styles.embeddedRoot : styles.eatsRoot}>
      {title ? <div className={styles.title}>{title}</div> : null}
      <div className={styles.countSummary}>
        <span id="numPlacesTried">{triedCount}</span> places tried, <span id="numPlacesWanted">{wantedCount}</span>{' '}
        wanting to try, and counting!
      </div>
      <div className={styles.body}>
        <div className={styles.sorting}>
          <div>
            <label htmlFor="city">City:</label>
            <select id="city" value={selectedCity} onChange={(event) => setSelectedCity(event.target.value)}>
              {[...citiesByCountry.entries()].map(([country, cityMap]) => (
                <optgroup key={country} label={country}>
                  {[...cityMap.entries()].map(([city, count]) => (
                    <option key={`${country}-${city}`} value={city}>
                      {city} ({count})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="mealType">Meal Type:</label>
            <select
              id="mealType"
              value={selectedMealType}
              onChange={(event) => setSelectedMealType(event.target.value)}
              disabled={category === 'mealType'}
            >
              <option value="Any">Any</option>
              {[...mealTypeCounts.keys()].map((meal) => (
                <option key={meal} value={meal}>
                  {mealLabel(meal)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="category">Categorise By:</label>
            <select
              id="category"
              value={category}
              onChange={(event) => setCategory(event.target.value as CategoryFilter)}
            >
              <option value="area">Area</option>
              <option value="type">Type of Food</option>
              <option value="mealType" disabled={selectedMealType !== 'Any'}>
                Type of Meal
              </option>
            </select>
          </div>
          <div>
            <label htmlFor="status">Status:</label>
            <select
              id="status"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
            >
              <option value="untriedLiked" disabled={statusCount('untriedLiked') === 0}>
                Want to Try / Liked ({statusCount('untriedLiked')})
              </option>
              <option value="liked" disabled={statusCount('liked') === 0}>
                Liked ({statusCount('liked')})
              </option>
              <option value="wanted" disabled={statusCount('wanted') === 0}>
                Want to Try ({statusCount('wanted')})
              </option>
              <option value="disliked" disabled={statusCount('disliked') === 0}>
                Disliked ({statusCount('disliked')})
              </option>
            </select>
          </div>
          <div className={styles.filtersContainer}>
            {headings.length > 1 && (category === 'area' || category === 'type')
              ? headings.map((heading) => (
                  <label key={heading}>
                    <input
                      type="checkbox"
                      checked={!excluded.includes(heading)}
                      onChange={(event) => {
                        setExcluded((current) => {
                          if (event.target.checked) {
                            return current.filter((entry) => entry !== heading);
                          }

                          if (current.includes(heading)) {
                            return current;
                          }

                          return [...current, heading];
                        });
                      }}
                    />
                    <span>
                      {category === 'type'
                        ? `${mealFilteredRestaurants
                            .flatMap((restaurant) => restaurant.types)
                            .find((type) => type.name === heading)?.emoji ?? ''} ${heading}`
                        : heading}
                    </span>
                  </label>
                ))
              : null}
          </div>
          <div className={styles.filterControls}>
            <button type="button" onClick={() => setExcluded(headings)}>
              Clear All
            </button>
            <button type="button" onClick={() => setExcluded([])}>
              Select All
            </button>
          </div>
        </div>
        <div className={styles.placesContainer}>
          {[...grouped.entries()].map(([heading, places]) => (
            <Fragment key={heading}>
              <span className={styles.heading}>
                {category === 'type' ? `${places[0]?.types.find((type) => type.name === heading)?.emoji ?? ''} ` : ''}
                {category === 'mealType' ? mealLabel(heading) : heading}
              </span>
              <div>
                {places
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((place) => (
                    <div className={styles.placeCard} key={`${heading}-${place.id}`}>
                      <span>
                        {category !== 'type' ? (
                          <span className={styles.emojis}>{place.types.map((type) => type.emoji).join('')}</span>
                        ) : null}
                        <a className={styles.subHeading} href={place.url} target="_blank" rel="noreferrer">
                          {place.name}
                        </a>
                        {status === 'untriedLiked' && place.status === 'untried' ? (
                          <span className={styles.notTried}> (NOT TRIED)</span>
                        ) : null}
                      </span>

                      {place.referredBy.trim().length > 0 ? (
                        isUrl(place.referredBy) ? (
                          <a className={styles.referrer} href={place.referredBy} target="_blank" rel="noreferrer">
                            Where I Found It
                          </a>
                        ) : (
                          <button
                            className={styles.referrer}
                            type="button"
                            onClick={() => {
                              window.confirm(place.referredBy);
                            }}
                          >
                            Where I Found It
                          </button>
                        )
                      ) : null}

                      <span className={styles.areaOrType}>
                        {category === 'type'
                          ? place.areas.join(', ')
                          : place.types.map((type) => `${type.emoji} ${type.name}`).join(', ')}
                        {category === 'mealType'
                          ? place.areas.length > 0
                            ? ` (${place.areas.join(', ')})`
                            : ''
                          : selectedMealType === 'Any'
                            ? ` (${place.mealTypes.map((meal) => mealLabel(meal)).join(', ')})`
                            : ''}
                      </span>

                      <div>{place.notes}</div>
                      {status === 'disliked' && place.dislikedReason ? (
                        <div className={styles.dislikedReason}>Reason: {place.dislikedReason}</div>
                      ) : null}

                      {adminTools ? (
                        <div className={styles.cardActions}>
                          <details className={styles.editDetails}>
                            <summary>Edit restaurant</summary>
                            <form
                              action={updateRestaurant}
                              onSubmit={(event) => {
                                const confirmed = window.confirm(`Save changes to "${place.name}"?`);
                                if (!confirmed) {
                                  event.preventDefault();
                                  return;
                                }

                                const detailsElement = event.currentTarget.closest('details');
                                const cardElement = event.currentTarget.closest(`.${styles.placeCard}`);
                                if (detailsElement instanceof HTMLDetailsElement) {
                                  detailsElement.open = false;
                                }
                                if (cardElement instanceof HTMLElement) {
                                  requestAnimationFrame(() => {
                                    cardElement.scrollIntoView({
                                      behavior: 'smooth',
                                      block: 'start'
                                    });
                                  });
                                }
                              }}
                            >
                              <input type="hidden" name="restaurantId" value={place.id} />
                              <RestaurantFormFields
                                cities={adminTools.cities}
                                types={adminTools.types}
                                keyPrefix={`edit-restaurant-${place.id}`}
                                submitLabel="Save changes"
                                defaults={{
                                  cityId: place.cityId,
                                  areas: place.areas,
                                  mealTypes: place.mealTypes,
                                  name: place.name,
                                  notes: place.notes,
                                  referredBy: place.referredBy,
                                  typeIds: place.types.map((type) => type.id),
                                  url: place.url,
                                  status: place.status,
                                  dislikedReason: place.dislikedReason
                                }}
                              />
                            </form>
                          </details>
                          <DeleteRestaurantForm
                            restaurantId={place.id}
                            restaurantName={place.name}
                            className={styles.deleteForm}
                            buttonClassName={styles.deleteButton}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
