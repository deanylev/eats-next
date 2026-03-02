'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createRestaurantFromRoot, updateRestaurant, updateRestaurantFromRoot } from '@/app/actions';
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
  defaultCityName?: string | null;
  showAdminButton?: boolean;
  title?: string | null;
  embedded?: boolean;
  allowRestaurantEditing?: boolean;
  adminTools?: {
    cities: Array<{ id: string; name: string; countryName: string }>;
    types: Array<{ id: string; name: string; emoji: string }>;
    areaSuggestionsByCity?: Record<string, string[]>;
  };
  createTools?: {
    cities: Array<{ id: string; name: string; countryName: string }>;
    types: Array<{ id: string; name: string; emoji: string }>;
  };
  rootCreateErrorMessage?: string | null;
  rootCreateSuccessMessage?: string | null;
  openCreateDialogByDefault?: boolean;
  rootEditErrorMessage?: string | null;
  rootEditSuccessMessage?: string | null;
  rootDeleteErrorMessage?: string | null;
  openEditRestaurantId?: string;
};

type StatusFilter = 'untriedLiked' | 'liked' | 'untried' | 'disliked';
type CategoryFilter = 'area' | 'type' | 'mealType';
type UrlState = {
  city: string;
  hasCityQuery: boolean;
  mealType: string;
  category: CategoryFilter;
  status: StatusFilter;
  excluded: string[];
};

const statusFilterSet = new Set<StatusFilter>(['untriedLiked', 'liked', 'untried', 'disliked']);
const categoryFilterSet = new Set<CategoryFilter>(['area', 'type', 'mealType']);
const confettiPieceIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

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

const readUrlState = (): UrlState => {
  if (typeof window === 'undefined') {
    return {
      city: '',
      hasCityQuery: false,
      mealType: 'Any',
      category: 'area',
      status: 'untriedLiked',
      excluded: []
    };
  }

  const params = new URLSearchParams(window.location.search);
  const statusFromUrl = params.get('status');
  const categoryFromUrl = params.get('category');
  const mealTypeFromUrl = params.get('mealType');
  const cityFromUrl = params.get('city');
  const hasCityQuery = params.has('city');
  const excludedFromUrl = params.getAll('exclude');

  return {
    city: cityFromUrl?.trim() ?? '',
    hasCityQuery,
    mealType: mealTypeFromUrl?.trim() || 'Any',
    category: categoryFromUrl && categoryFilterSet.has(categoryFromUrl as CategoryFilter)
      ? (categoryFromUrl as CategoryFilter)
      : 'area',
    status: statusFromUrl && statusFilterSet.has(statusFromUrl as StatusFilter)
      ? (statusFromUrl as StatusFilter)
      : 'untriedLiked',
    excluded: excludedFromUrl.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  };
};

const isUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export function PublicEatsPage({
  restaurants,
  defaultCityName = null,
  showAdminButton = false,
  title = `Dean's Favourite Eats`,
  embedded = false,
  allowRestaurantEditing = true,
  adminTools,
  createTools,
  rootCreateErrorMessage = null,
  rootCreateSuccessMessage = null,
  openCreateDialogByDefault = false,
  rootEditErrorMessage = null,
  rootEditSuccessMessage = null,
  rootDeleteErrorMessage = null,
  openEditRestaurantId
}: Props) {
  const triedCount = restaurants.filter((restaurant) => restaurant.status === 'liked').length;
  const untriedCount = restaurants.filter((restaurant) => restaurant.status === 'untried').length;
  const [hasInitializedFilters, setHasInitializedFilters] = useState(false);
  const skipNextExcludeReset = useRef(false);
  const skipNextExcludePrune = useRef(false);
  const hasExplicitCityQuery = useRef(false);

  const [status, setStatus] = useState<StatusFilter>('untriedLiked');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedMealType, setSelectedMealType] = useState<string>('Any');
  const [category, setCategory] = useState<CategoryFilter>('area');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [luckyRestaurantId, setLuckyRestaurantId] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(openCreateDialogByDefault);
  const [editingRestaurantId, setEditingRestaurantId] = useState<string | null>(openEditRestaurantId ?? null);
  const restaurantCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const luckyCardHasEnteredViewport = useRef<boolean>(false);

  useEffect(() => {
    if (embedded) {
      setHasInitializedFilters(true);
      return;
    }

    const urlState = readUrlState();
    hasExplicitCityQuery.current = urlState.hasCityQuery;
    skipNextExcludeReset.current = urlState.excluded.length > 0;
    skipNextExcludePrune.current = urlState.excluded.length > 0;
    setStatus(urlState.status);
    setSelectedCity(urlState.city);
    setSelectedMealType(urlState.mealType);
    setCategory(urlState.category);
    setExcluded(urlState.excluded);
    setHasInitializedFilters(true);
  }, [embedded]);

  const statusFilteredRestaurants = useMemo(() => {
    if (status === 'liked') {
      return restaurants.filter((restaurant) => restaurant.status === 'liked');
    }

    if (status === 'untried') {
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
    if (!hasInitializedFilters) {
      return;
    }

    const preferredDefaultCity = defaultCityName?.trim() || 'Melbourne';
    const defaultCityExists = [...citiesByCountry.values()].some((cityMap) => cityMap.has(preferredDefaultCity));

    if (!selectedCity) {
      if (!hasExplicitCityQuery.current && defaultCityExists) {
        setSelectedCity(preferredDefaultCity);
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
  }, [citiesByCountry, defaultCityName, hasInitializedFilters, selectedCity]);

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
    if (!hasInitializedFilters || !selectedCity) {
      return;
    }

    if (skipNextExcludePrune.current) {
      skipNextExcludePrune.current = false;
      return;
    }

    setExcluded((current) => current.filter((entry) => headings.includes(entry)));
  }, [hasInitializedFilters, headings, selectedCity]);

  useEffect(() => {
    if (!hasInitializedFilters) {
      return;
    }

    if (skipNextExcludeReset.current) {
      skipNextExcludeReset.current = false;
      return;
    }

    setExcluded([]);
  }, [category, hasInitializedFilters, selectedCity, selectedMealType, status]);

  useEffect(() => {
    if (embedded || typeof window === 'undefined' || !hasInitializedFilters) {
      return;
    }

    const params = new URLSearchParams(window.location.search);

    if (selectedCity) {
      params.set('city', selectedCity);
    } else {
      params.delete('city');
    }

    if (selectedMealType !== 'Any') {
      params.set('mealType', selectedMealType);
    } else {
      params.delete('mealType');
    }

    if (category !== 'area') {
      params.set('category', category);
    } else {
      params.delete('category');
    }

    if (status !== 'untriedLiked') {
      params.set('status', status);
    } else {
      params.delete('status');
    }

    params.delete('exclude');
    for (const entry of excluded) {
      params.append('exclude', entry);
    }

    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', nextUrl);
  }, [category, embedded, excluded, hasInitializedFilters, selectedCity, selectedMealType, status]);

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
  const visibleRestaurantIds = useMemo(() => {
    const ids = new Set<string>();

    for (const places of grouped.values()) {
      for (const place of places) {
        ids.add(place.id);
      }
    }

    return [...ids];
  }, [grouped]);
  const createAreaSuggestionsByCity = useMemo(() => {
    const suggestions = new Map<string, Set<string>>();

    for (const restaurant of restaurants) {
      const areas = suggestions.get(restaurant.cityId) ?? new Set<string>();
      for (const area of restaurant.areas) {
        const normalized = area.trim();
        if (normalized.length > 0) {
          areas.add(normalized);
        }
      }
      suggestions.set(restaurant.cityId, areas);
    }

    return Object.fromEntries(
      [...suggestions.entries()].map(([cityId, areas]) => [cityId, [...areas].sort((a, b) => a.localeCompare(b))])
    ) as Record<string, string[]>;
  }, [restaurants]);

  useEffect(() => {
    if (!luckyRestaurantId || typeof window === 'undefined') {
      return;
    }

    luckyCardHasEnteredViewport.current = false;

    const onScroll = (): void => {
      const luckyCard = restaurantCardRefs.current[luckyRestaurantId];
      if (!luckyCard) {
        setLuckyRestaurantId(null);
        luckyCardHasEnteredViewport.current = false;
        return;
      }

      const rect = luckyCard.getBoundingClientRect();
      const inViewport = rect.bottom > 0 && rect.top < window.innerHeight;
      if (inViewport) {
        luckyCardHasEnteredViewport.current = true;
      } else if (luckyCardHasEnteredViewport.current) {
        setLuckyRestaurantId(null);
        luckyCardHasEnteredViewport.current = false;
      }
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [luckyRestaurantId]);

  useEffect(() => {
    if (!rootCreateErrorMessage) {
      return;
    }

    window.confirm(rootCreateErrorMessage);
    document.cookie = 'root_create_error_message=; Max-Age=0; path=/; SameSite=Lax';
    setIsCreateDialogOpen(true);
  }, [rootCreateErrorMessage]);

  useEffect(() => {
    if (!rootCreateSuccessMessage) {
      return;
    }

    document.cookie = 'root_create_success_message=; Max-Age=0; path=/; SameSite=Lax';
    setIsCreateDialogOpen(false);
  }, [rootCreateSuccessMessage]);

  useEffect(() => {
    if (!rootEditErrorMessage) {
      return;
    }

    window.confirm(rootEditErrorMessage);
    document.cookie = 'root_edit_error_message=; Max-Age=0; path=/; SameSite=Lax';
    if (openEditRestaurantId) {
      setEditingRestaurantId(openEditRestaurantId);
    }
  }, [openEditRestaurantId, rootEditErrorMessage]);

  useEffect(() => {
    if (!rootEditSuccessMessage) {
      return;
    }

    document.cookie = 'root_edit_success_message=; Max-Age=0; path=/; SameSite=Lax';
    setEditingRestaurantId(null);
  }, [rootEditSuccessMessage]);

  useEffect(() => {
    if (!rootDeleteErrorMessage) {
      return;
    }

    window.confirm(rootDeleteErrorMessage);
    document.cookie = 'root_delete_error_message=; Max-Age=0; path=/; SameSite=Lax';
  }, [rootDeleteErrorMessage]);

  const statusCount = (filter: StatusFilter): number => {
    if (!selectedCity) {
      return 0;
    }

    return restaurants.filter((restaurant) => {
      if (restaurant.cityName !== selectedCity) {
        return false;
      }

      if (filter === 'untried') {
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
  const createDefaultCityId = useMemo(() => {
    if (!createTools || !selectedCity) {
      return undefined;
    }

    return createTools.cities.find((city) => city.name === selectedCity)?.id;
  }, [createTools, selectedCity]);
  const createDefaultMealTypes = useMemo(() => {
    if (selectedMealType === 'Any') {
      return undefined;
    }

    return [selectedMealType];
  }, [selectedMealType]);
  const createDefaultStatus = useMemo(() => {
    if (status === 'liked' || status === 'untried' || status === 'disliked') {
      return status;
    }

    return undefined;
  }, [status]);
  const editingRestaurant = useMemo(() => {
    if (!editingRestaurantId) {
      return null;
    }

    return restaurants.find((restaurant) => restaurant.id === editingRestaurantId) ?? null;
  }, [editingRestaurantId, restaurants]);
  const canEditRestaurants = Boolean(adminTools) && allowRestaurantEditing;
  const canDeleteRestaurants = Boolean(adminTools) && !embedded;

  return (
    <div className={embedded ? styles.embeddedRoot : styles.eatsRoot}>
      {title || (showAdminButton && !embedded) ? (
        <div className={styles.titleRow}>
          {title ? <div className={styles.title}>{title}</div> : null}
          {showAdminButton && !embedded ? (
            <a className={styles.adminLink} href="/admin">
              Admin
            </a>
          ) : null}
        </div>
      ) : null}
      <div className={styles.countSummary}>
        <span className={styles.countNumber}>{triedCount}</span> places liked, <span className={styles.countNumber}>{untriedCount}</span>{' '}
        wanting to try, and counting!
      </div>
      <div className={styles.body}>
        <div className={styles.sorting}>
          <div>
            <label htmlFor="city">City:</label>
            <select value={selectedCity} onChange={(event) => setSelectedCity(event.target.value)}>
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
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
            >
              <option value="untriedLiked" disabled={statusCount('untriedLiked') === 0}>
                Want to Try / Liked ({statusCount('untriedLiked')})
              </option>
              <option value="liked" disabled={statusCount('liked') === 0}>
                Liked ({statusCount('liked')})
              </option>
              <option value="untried" disabled={statusCount('untried') === 0}>
                Want to Try ({statusCount('untried')})
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
            {!embedded ? (
              <button
                type="button"
                onClick={() => {
                  if (visibleRestaurantIds.length === 0) {
                    return;
                  }

                  const luckyId = visibleRestaurantIds[Math.floor(Math.random() * visibleRestaurantIds.length)];
                  const luckyCard = restaurantCardRefs.current[luckyId];
                  if (!luckyCard) {
                    return;
                  }

                  luckyCardHasEnteredViewport.current = false;
                  setLuckyRestaurantId(luckyId);

                  luckyCard.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                  });
                }}
                disabled={visibleRestaurantIds.length === 0}
              >
                I'm Feeling Lucky
              </button>
            ) : null}
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
                    <div
                      className={`${styles.placeCard} ${luckyRestaurantId === place.id ? styles.luckyCard : ''}`}
                      key={`${heading}-${place.id}`}
                      ref={(element) => {
                        restaurantCardRefs.current[place.id] = element;
                      }}
                    >
                      {luckyRestaurantId === place.id ? (
                        <div className={styles.confettiLayer} aria-hidden="true">
                          {confettiPieceIndexes.map((index) => (
                            <span className={styles.confettiPiece} key={`${place.id}-confetti-${index}`} />
                          ))}
                        </div>
                      ) : null}
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

                      {canEditRestaurants || canDeleteRestaurants ? (
                        <div className={styles.cardActions}>
                          {canEditRestaurants ? (
                            <button
                              type="button"
                              className={styles.editButton}
                              onClick={() => setEditingRestaurantId(place.id)}
                            >
                              Edit
                            </button>
                          ) : null}
                          {canDeleteRestaurants ? (
                            <DeleteRestaurantForm
                              restaurantId={place.id}
                              restaurantName={place.name}
                              className={styles.deleteForm}
                              buttonClassName={styles.deleteButton}
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
              </div>
            </Fragment>
          ))}
        </div>
      </div>
      {createTools && !embedded ? (
        <>
          <button
            type="button"
            className={styles.addFab}
            aria-label="Add restaurant"
            title="Add restaurant"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            +
          </button>
          {isCreateDialogOpen ? (
            <div className={styles.createDialogOverlay} onClick={() => setIsCreateDialogOpen(false)}>
              <section
                className={styles.createDialog}
                role="dialog"
                aria-modal="true"
                aria-label="Add Restaurant"
                onClick={(event) => event.stopPropagation()}
              >
                <div className={styles.createDialogHeader}>
                  <h2>Add Restaurant</h2>
                  <button
                    type="button"
                    className={styles.createDialogClose}
                    aria-label="Close add restaurant dialog"
                    onClick={() => setIsCreateDialogOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <form
                  action={createRestaurantFromRoot}
                >
                  <RestaurantFormFields
                    cities={createTools.cities}
                    types={createTools.types}
                    areaSuggestionsByCity={createAreaSuggestionsByCity}
                    disableAreasUntilCitySelected
                    keyPrefix="root-create-restaurant"
                    submitLabel="Create restaurant"
                    disableSubmit={createTools.cities.length === 0 || createTools.types.length === 0}
                    defaults={{
                      cityId: createDefaultCityId,
                      mealTypes: createDefaultMealTypes,
                      status: createDefaultStatus
                    }}
                  />
                </form>
              </section>
            </div>
          ) : null}
        </>
      ) : null}
      {canEditRestaurants && adminTools && editingRestaurant ? (
        <div className={styles.createDialogOverlay} onClick={() => setEditingRestaurantId(null)}>
          <section
            className={styles.createDialog}
            role="dialog"
            aria-modal="true"
            aria-label={`Edit ${editingRestaurant.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.createDialogHeader}>
              <h2>Edit {editingRestaurant.name}</h2>
              <button
                type="button"
                className={styles.createDialogClose}
                aria-label="Close edit restaurant dialog"
                onClick={() => setEditingRestaurantId(null)}
              >
                ×
              </button>
            </div>
            <form
              action={embedded ? updateRestaurant : updateRestaurantFromRoot}
              onSubmit={(event) => {
                const confirmed = window.confirm(`Save changes to "${editingRestaurant.name}"?`);
                if (!confirmed) {
                  event.preventDefault();
                  return;
                }
              }}
            >
              <input type="hidden" name="restaurantId" value={editingRestaurant.id} />
              <RestaurantFormFields
                cities={adminTools.cities}
                types={adminTools.types}
                areaSuggestionsByCity={adminTools.areaSuggestionsByCity}
                keyPrefix={`edit-restaurant-${editingRestaurant.id}`}
                submitLabel="Save changes"
                defaults={{
                  cityId: editingRestaurant.cityId,
                  areas: editingRestaurant.areas,
                  mealTypes: editingRestaurant.mealTypes,
                  name: editingRestaurant.name,
                  notes: editingRestaurant.notes,
                  referredBy: editingRestaurant.referredBy,
                  typeIds: editingRestaurant.types.map((type) => type.id),
                  url: editingRestaurant.url,
                  status: editingRestaurant.status,
                  dislikedReason: editingRestaurant.dislikedReason
                }}
              />
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
