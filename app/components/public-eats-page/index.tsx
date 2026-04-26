'use client';

import Fuse from 'fuse.js';
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRestaurantFromRoot, updateRestaurant, updateRestaurantFromRoot } from '@/app/actions';
import { buildCitySelectGroups, CitySelect } from '@/app/components/city-select';
import { DeleteRestaurantForm } from '@/app/components/delete-restaurant-form';
import { RestaurantFormFields } from '@/app/components/restaurant-form-fields';
import {
  byAlpha,
  categoryFilterSet,
  confettiPieceIndexes,
  defaultRestaurantStatuses,
  getFeelingLuckyCandidateIds,
  getPreservedIncludedHeadings,
  getMonthHeadingKey,
  getMonthHeadingLabel,
  isUrl,
  mealLabel,
  readUrlState,
  reconcileExcludedAfterStatusChange,
  showFeelingLuckyForStatuses,
  type CategoryFilter,
  type RestaurantStatusFilter
} from '@/app/components/public-eats-page/utils';
import { buildAreaSuggestionsByCity } from '@/lib/area-suggestions';
import { clearFlashCookieClient, flashCookieNames } from '@/lib/flash-cookies';
import { buildThemeCssVariables, DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '@/lib/theme';

import styles from './style.module.scss';

const restaurantStatusChoices: RestaurantStatusFilter[] = ['untried', 'liked', 'disliked'];
const allCitiesUrlValue = 'all';
const compactCardsStorageKey = 'publicEatsCompactCards';

const readStoredCompactCards = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(compactCardsStorageKey) === 'true';
  } catch {
    return false;
  }
};

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
  createdAt: string | Date;
  status: 'untried' | 'liked' | 'disliked';
  dislikedReason: string | null;
  areas: string[];
  mealTypes: string[];
  types: RestaurantType[];
};

const getRestaurantDetailText = (restaurant: PublicRestaurant): string => {
  if (restaurant.status === 'disliked') {
    return restaurant.dislikedReason?.trim() ?? '';
  }

  return restaurant.notes.trim();
};

type Props = {
  restaurants: PublicRestaurant[];
  defaultCityName?: string | null;
  showAdminButton?: boolean;
  title?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
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

export function PublicEatsPage({
  restaurants,
  defaultCityName = null,
  showAdminButton = false,
  title = `Dean's Favourite Eats`,
  primaryColor = DEFAULT_PRIMARY_COLOR,
  secondaryColor = DEFAULT_SECONDARY_COLOR,
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
  const preservedIncludedHeadings = useRef<string[] | null>(null);
  const statusFilterSnapshot = useRef<{ preservedIncludedHeadings: string[] | null } | null>(null);

  const [selectedStatuses, setSelectedStatuses] = useState<RestaurantStatusFilter[]>(defaultRestaurantStatuses);
  const [selectedCity, setSelectedCity] = useState<string | null>('');
  const [selectedMealType, setSelectedMealType] = useState<string>('Any');
  const [category, setCategory] = useState<CategoryFilter>('area');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [compactCards, setCompactCards] = useState(false);
  const [expandedCompactCardIds, setExpandedCompactCardIds] = useState<Set<string>>(new Set());
  const [luckyRestaurantId, setLuckyRestaurantId] = useState<string | null>(null);
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
  const [filterPopoverDirection, setFilterPopoverDirection] = useState<'up' | 'down'>('up');
  const [isSearchPopoverOpen, setIsSearchPopoverOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(openCreateDialogByDefault);
  const [createDialogHasUnsavedChanges, setCreateDialogHasUnsavedChanges] = useState(false);
  const [editingRestaurantId, setEditingRestaurantId] = useState<string | null>(openEditRestaurantId ?? null);
  const [editDialogHasUnsavedChanges, setEditDialogHasUnsavedChanges] = useState(false);
  const [isSavingEditRestaurant, setIsSavingEditRestaurant] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const restaurantCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const luckyCardHasEnteredViewport = useRef<boolean>(false);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  const filterPopoverPanelRef = useRef<HTMLDivElement | null>(null);
  const filterPopoverId = useId();
  const searchPopoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchPopoverId = useId();

  useEffect(() => {
    setCompactCards(readStoredCompactCards());

    if (embedded) {
      setHasInitializedFilters(true);
      return;
    }

    const urlState = readUrlState();
    hasExplicitCityQuery.current = urlState.hasCityQuery;
    skipNextExcludeReset.current = urlState.excluded.length > 0;
    skipNextExcludePrune.current = urlState.excluded.length > 0;
    setSelectedStatuses(urlState.statuses);
    setSelectedCity(urlState.city === allCitiesUrlValue ? null : urlState.city);
    setSelectedMealType(urlState.mealType);
    setCategory(urlState.city === allCitiesUrlValue && urlState.category === 'area' ? 'type' : urlState.category);
    setSearchQuery(urlState.search);
    setExcluded(urlState.excluded);
    preservedIncludedHeadings.current = null;
    setHasInitializedFilters(true);
  }, [embedded]);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasInitializedFilters) {
      return;
    }

    try {
      window.localStorage.setItem(compactCardsStorageKey, compactCards ? 'true' : 'false');
    } catch {
      // Ignore storage failures; compact mode still works for the current page session.
    }
  }, [compactCards, hasInitializedFilters]);

  useEffect(() => {
    if (!compactCards) {
      setExpandedCompactCardIds(new Set());
    }
  }, [compactCards]);

  const statusFilteredRestaurants = useMemo(() => {
    const selectedStatusSet = new Set(selectedStatuses);
    return restaurants.filter((restaurant) => selectedStatusSet.has(restaurant.status));
  }, [restaurants, selectedStatuses]);

  const citiesByCountry = useMemo(() => {
    const map = new Map<string, Map<string, number>>();

    for (const restaurant of restaurants) {
      const countryMap = map.get(restaurant.countryName) ?? new Map<string, number>();
      countryMap.set(restaurant.cityName, (countryMap.get(restaurant.cityName) ?? 0) + 1);
      map.set(restaurant.countryName, countryMap);
    }

    return new Map(
      [...map.entries()]
        .sort(([countryA], [countryB]) => byAlpha(countryA, countryB))
        .map(([country, cityMap]) => [country, new Map([...cityMap.entries()].sort(([a], [b]) => byAlpha(a, b)))])
    );
  }, [restaurants]);

  const isAllCitiesSelected = selectedCity === null;

  useEffect(() => {
    if (!hasInitializedFilters) {
      return;
    }

    const preferredDefaultCity = defaultCityName?.trim() || 'Melbourne';
    const defaultCityExists = [...citiesByCountry.values()].some((cityMap) => cityMap.has(preferredDefaultCity));

    if (isAllCitiesSelected) {
      return;
    }

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
  }, [citiesByCountry, defaultCityName, hasInitializedFilters, isAllCitiesSelected, selectedCity]);

  const cityRestaurants = useMemo(
    () =>
      isAllCitiesSelected
        ? statusFilteredRestaurants
        : statusFilteredRestaurants.filter((restaurant) => restaurant.cityName === selectedCity),
    [isAllCitiesSelected, selectedCity, statusFilteredRestaurants]
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
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const isSearchActive = normalizedSearchQuery.length > 0;
  const restaurantSearch = useMemo(
    () =>
      new Fuse(restaurants, {
        threshold: 0.3,
        ignoreLocation: true,
        includeScore: true,
        keys: [{ name: 'name', weight: 1 }]
      }),
    [restaurants]
  );
  const searchedRestaurants = useMemo(() => {
    if (!isSearchActive) {
      return [];
    }

    if (normalizedSearchQuery.length < 2) {
      return restaurants.filter((restaurant) => restaurant.name.toLowerCase().includes(normalizedSearchQuery));
    }

    return restaurantSearch.search(normalizedSearchQuery).map((result) => result.item);
  }, [isSearchActive, normalizedSearchQuery, restaurantSearch, restaurants]);

  const headings = useMemo(() => {
    const values = new Set<string>();

    for (const restaurant of mealFilteredRestaurants) {
      if (category === 'area') {
        if (restaurant.areas.length === 0) {
          values.add(selectedCity ?? restaurant.cityName);
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

      if (category === 'recentlyAdded') {
        values.add(getMonthHeadingKey(restaurant.createdAt));
      }
    }

    const headingList = [...values];
    if (category === 'recentlyAdded') {
      return headingList.sort((a, b) => b.localeCompare(a));
    }

    return headingList.sort((a, b) => byAlpha(a, b));
  }, [category, isAllCitiesSelected, mealFilteredRestaurants, selectedCity]);

  useEffect(() => {
    if (!hasInitializedFilters || !selectedCity) {
      return;
    }

    if (category === 'recentlyAdded') {
      return;
    }

    if (skipNextExcludePrune.current) {
      skipNextExcludePrune.current = false;
      return;
    }

    const snapshot = statusFilterSnapshot.current;
    statusFilterSnapshot.current = null;

    if (snapshot) {
      preservedIncludedHeadings.current = snapshot.preservedIncludedHeadings;
      setExcluded(reconcileExcludedAfterStatusChange(snapshot.preservedIncludedHeadings, headings));
      return;
    }

    setExcluded((current) => current.filter((entry) => headings.includes(entry)));
  }, [category, hasInitializedFilters, headings, selectedCity]);

  useEffect(() => {
    if (!hasInitializedFilters) {
      return;
    }

    if (skipNextExcludeReset.current) {
      skipNextExcludeReset.current = false;
      return;
    }

    preservedIncludedHeadings.current = null;
    setExcluded([]);
  }, [category, hasInitializedFilters, selectedCity]);

  useEffect(() => {
    if (category === 'recentlyAdded') {
      setIsFilterPopoverOpen(false);
      setFilterPopoverDirection('up');
    }
  }, [category]);

  useEffect(() => {
    if (!isSearchPopoverOpen) {
      return;
    }

    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [isSearchPopoverOpen]);

  const closeCreateDialog = useCallback((): void => {
    if (createDialogHasUnsavedChanges && !window.confirm('Discard unsaved changes?')) {
      return;
    }

    setCreateDialogHasUnsavedChanges(false);
    setIsCreateDialogOpen(false);
  }, [createDialogHasUnsavedChanges]);

  const closeEditRestaurantDialog = useCallback((): void => {
    if (editDialogHasUnsavedChanges && !window.confirm('Discard unsaved changes?')) {
      return;
    }

    setEditDialogHasUnsavedChanges(false);
    setIsSavingEditRestaurant(false);
    setEditingRestaurantId(null);
  }, [editDialogHasUnsavedChanges]);

  useEffect(() => {
    if (!isCreateDialogOpen && !editingRestaurantId) {
      return;
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }

      if (editingRestaurantId) {
        closeEditRestaurantDialog();
        return;
      }

      closeCreateDialog();
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeCreateDialog, closeEditRestaurantDialog, editingRestaurantId, isCreateDialogOpen]);

  useEffect(() => {
    if (!isFilterPopoverOpen && !isSearchPopoverOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      if (!filterPopoverRef.current?.contains(event.target as Node)) {
        setIsFilterPopoverOpen(false);
      }

      if (!searchPopoverRef.current?.contains(event.target as Node)) {
        setIsSearchPopoverOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setIsFilterPopoverOpen(false);
        setIsSearchPopoverOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isFilterPopoverOpen, isSearchPopoverOpen]);

  useLayoutEffect(() => {
    if (!isFilterPopoverOpen || typeof window === 'undefined') {
      return;
    }

    const updateFilterPopoverDirection = (): void => {
      const trigger = filterPopoverRef.current;
      const panel = filterPopoverPanelRef.current;
      if (!trigger || !panel) {
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const panelHeight = panel.offsetHeight;
      const viewportHeight = window.innerHeight;
      const margin = 16;
      const spaceBelow = viewportHeight - triggerRect.bottom - margin;
      const spaceAbove = triggerRect.top - margin;

      if (spaceAbove >= panelHeight || spaceAbove >= spaceBelow) {
        setFilterPopoverDirection('up');
        return;
      }

      setFilterPopoverDirection('down');
    };

    updateFilterPopoverDirection();
    window.addEventListener('resize', updateFilterPopoverDirection);

    return () => {
      window.removeEventListener('resize', updateFilterPopoverDirection);
    };
  }, [headings.length, isFilterPopoverOpen]);

  useEffect(() => {
    if (embedded || typeof window === 'undefined' || !hasInitializedFilters) {
      return;
    }

    const params = new URLSearchParams(window.location.search);

    if (isAllCitiesSelected) {
      params.set('city', allCitiesUrlValue);
    } else if (selectedCity) {
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

    params.delete('status');
    if (selectedStatuses.length !== defaultRestaurantStatuses.length || !defaultRestaurantStatuses.every((status) => selectedStatuses.includes(status))) {
      if (selectedStatuses.length === 0) {
        params.append('status', 'none');
      } else {
        for (const status of selectedStatuses) {
          params.append('status', status);
        }
      }
    }

    if (searchQuery.trim().length > 0) {
      params.set('q', searchQuery.trim());
    } else {
      params.delete('q');
    }

    params.delete('exclude');
    for (const entry of excluded) {
      params.append('exclude', entry);
    }

    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash}`;
    window.history.replaceState(null, '', nextUrl);
  }, [category, embedded, excluded, hasInitializedFilters, isAllCitiesSelected, searchQuery, selectedCity, selectedMealType, selectedStatuses]);

  const grouped = useMemo(() => {
    const map = new Map<string, PublicRestaurant[]>();

    if (isSearchActive) {
      for (const restaurant of searchedRestaurants) {
        const heading = `${restaurant.cityName}, ${restaurant.countryName}`;
        const current = map.get(heading) ?? [];
        current.push(restaurant);
        map.set(heading, current);
      }

      return new Map([...map.entries()].sort(([headingA], [headingB]) => byAlpha(headingA, headingB)));
    }

    for (const restaurant of mealFilteredRestaurants) {
      const headingValues: string[] = [];
      if (category === 'area') {
        headingValues.push(...(restaurant.areas.length > 0 ? restaurant.areas : [selectedCity ?? restaurant.cityName]));
      }

      if (category === 'type') {
        headingValues.push(...restaurant.types.map((type) => type.name));
      }

      if (category === 'recentlyAdded') {
        headingValues.push(getMonthHeadingKey(restaurant.createdAt));
      }

      for (const heading of headingValues) {
        if (category !== 'recentlyAdded' && excluded.includes(heading)) {
          continue;
        }

        const current = map.get(heading) ?? [];
        current.push(restaurant);
        map.set(heading, current);
      }
    }

    if (category === 'recentlyAdded') {
      return new Map([...map.entries()].sort(([headingA], [headingB]) => headingB.localeCompare(headingA)));
    }

    return new Map([...map.entries()].sort(([headingA], [headingB]) => byAlpha(headingA, headingB)));
  }, [category, excluded, isAllCitiesSelected, isSearchActive, mealFilteredRestaurants, searchedRestaurants, selectedCity]);
  const visibleRestaurantIds = useMemo(() => {
    const ids = new Set<string>();

    for (const places of grouped.values()) {
      for (const place of places) {
        ids.add(place.id);
      }
    }

    return [...ids];
  }, [grouped]);
  const visibleRestaurantsById = useMemo(
    () => new Map(restaurants.map((restaurant) => [restaurant.id, restaurant])),
    [restaurants]
  );
  const includedHeadingsCount = useMemo(
    () => headings.filter((heading) => !excluded.includes(heading)).length,
    [excluded, headings]
  );
  const filterButtonStateLabel = useMemo(() => {
    if (headings.length === 0 || includedHeadingsCount === headings.length) {
      return 'All';
    }

    return `${includedHeadingsCount} / ${headings.length}`;
  }, [headings.length, includedHeadingsCount]);
  const noResultsMessage = selectedStatuses.length === 0
    ? 'Select at least one status to show restaurants.'
    : 'No restaurants match these filters.';
  const luckyCandidateIds = useMemo(
    () => getFeelingLuckyCandidateIds(visibleRestaurantIds, visibleRestaurantsById, selectedStatuses),
    [selectedStatuses, visibleRestaurantIds, visibleRestaurantsById]
  );
  const disableFeelingLuckyButton =
    !showFeelingLuckyForStatuses(selectedStatuses) || luckyCandidateIds.length === 0;
  const createAreaSuggestionsByCity = useMemo(() => {
    return buildAreaSuggestionsByCity(restaurants);
  }, [restaurants]);
  const areaSuggestionsByCity = adminTools?.areaSuggestionsByCity ?? createAreaSuggestionsByCity;
  const filterCityGroups = useMemo(
    () =>
      buildCitySelectGroups(
        [...citiesByCountry.entries()].flatMap(([countryName, cityMap]) =>
          [...cityMap.entries()].map(([cityName, count]) => ({
            countryName,
            label: `${cityName} (${count})`,
            name: cityName,
            value: cityName
          }))
        )
      ),
    [citiesByCountry]
  );

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
    if (embedded || typeof window === 'undefined') {
      setShowBackToTop(false);
      return;
    }

    const onScroll = (): void => {
      const scrollTop = Math.max(
        window.scrollY,
        window.pageYOffset,
        document.documentElement?.scrollTop ?? 0,
        document.body?.scrollTop ?? 0
      );
      setShowBackToTop(scrollTop > 180);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, [embedded]);

  useEffect(() => {
    if (!rootCreateErrorMessage) {
      return;
    }

    window.confirm(rootCreateErrorMessage);
    clearFlashCookieClient(flashCookieNames.rootCreateError, '/');
    setIsCreateDialogOpen(true);
  }, [rootCreateErrorMessage]);

  useEffect(() => {
    if (!rootCreateSuccessMessage) {
      return;
    }

    clearFlashCookieClient(flashCookieNames.rootCreateSuccess, '/');
    setCreateDialogHasUnsavedChanges(false);
    setIsCreateDialogOpen(false);
  }, [rootCreateSuccessMessage]);

  useEffect(() => {
    if (!rootEditErrorMessage) {
      return;
    }

    setIsSavingEditRestaurant(false);
    window.confirm(rootEditErrorMessage);
    clearFlashCookieClient(flashCookieNames.rootEditError, '/');
    if (openEditRestaurantId) {
      setEditingRestaurantId(openEditRestaurantId);
    }
  }, [openEditRestaurantId, rootEditErrorMessage]);

  useEffect(() => {
    if (!rootEditSuccessMessage) {
      return;
    }

    setIsSavingEditRestaurant(false);
    clearFlashCookieClient(flashCookieNames.rootEditSuccess, '/');
    setEditDialogHasUnsavedChanges(false);
    setEditingRestaurantId(null);
  }, [rootEditSuccessMessage]);

  useEffect(() => {
    if (!isSavingEditRestaurant) {
      return;
    }

    if (rootEditErrorMessage || openEditRestaurantId) {
      return;
    }

    setIsSavingEditRestaurant(false);
    setEditDialogHasUnsavedChanges(false);
    setEditingRestaurantId(null);
  }, [isSavingEditRestaurant, openEditRestaurantId, rootEditErrorMessage]);

  useEffect(() => {
    if (!rootDeleteErrorMessage) {
      return;
    }

    window.confirm(rootDeleteErrorMessage);
    clearFlashCookieClient(flashCookieNames.rootDeleteError, '/');
  }, [rootDeleteErrorMessage]);

  const statusCounts = useMemo(() => {
    const counts = new Map<RestaurantStatusFilter, number>(
      restaurantStatusChoices.map((status) => [status, 0])
    );

    if (!isAllCitiesSelected && !selectedCity) {
      return counts;
    }

    for (const restaurant of restaurants) {
      if (!isAllCitiesSelected && restaurant.cityName !== selectedCity) {
        continue;
      }

      counts.set(restaurant.status, (counts.get(restaurant.status) ?? 0) + 1);
    }

    return counts;
  }, [isAllCitiesSelected, restaurants, selectedCity]);
  const statusCount = useCallback(
    (status: RestaurantStatusFilter): number => statusCounts.get(status) ?? 0,
    [statusCounts]
  );
  const getAvailableStatusesForCity = useCallback(
    (city: string | null): RestaurantStatusFilter[] => {
      const statuses = new Set(
        restaurants
          .filter((restaurant) => city === null || restaurant.cityName === city)
          .map((restaurant) => restaurant.status)
      );

      return restaurantStatusChoices.filter((status) => statuses.has(status));
    },
    [restaurants]
  );
  const getDefaultStatusesForCity = useCallback(
    (city: string | null): RestaurantStatusFilter[] => {
      const availableStatuses = getAvailableStatusesForCity(city);
      const availableDefaults = defaultRestaurantStatuses.filter((status) => availableStatuses.includes(status));
      return availableDefaults.length > 0 ? availableDefaults : availableStatuses;
    },
    [getAvailableStatusesForCity]
  );
  useEffect(() => {
    if (!hasInitializedFilters || !selectedCity) {
      return;
    }

    setSelectedStatuses((current) => current.filter((status) => statusCount(status) > 0));
  }, [hasInitializedFilters, selectedCity, statusCount]);
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
    if (selectedStatuses.length === 1) {
      return selectedStatuses[0];
    }

    return undefined;
  }, [selectedStatuses]);
  const toggleSelectedStatus = (status: RestaurantStatusFilter, checked: boolean): void => {
    statusFilterSnapshot.current =
      category !== 'recentlyAdded'
        ? {
            preservedIncludedHeadings:
              preservedIncludedHeadings.current ?? getPreservedIncludedHeadings(headings, excluded)
          }
        : null;

    setSelectedStatuses((current) => {
      if (checked) {
        if (current.includes(status)) {
          statusFilterSnapshot.current = null;
          return current;
        }

        return [...current, status];
      }

      return current.filter((entry) => entry !== status);
    });
  };
  const handleCityChange = useCallback((city: string): void => {
    const nextCity = city || null;

    setSelectedCity(nextCity);
    if (nextCity === null && category === 'area') {
      setCategory('type');
    }
    setSelectedStatuses(getDefaultStatusesForCity(nextCity));
    statusFilterSnapshot.current = null;
    preservedIncludedHeadings.current = null;
  }, [category, getDefaultStatusesForCity]);
  const handleFeelingLucky = (): void => {
    if (luckyCandidateIds.length === 0) {
      return;
    }

    const luckyId = luckyCandidateIds[Math.floor(Math.random() * luckyCandidateIds.length)];
    const luckyCard = restaurantCardRefs.current[luckyId];
    if (!luckyCard) {
      return;
    }

    luckyCardHasEnteredViewport.current = false;
    setLuckyRestaurantId(luckyId);

    const cardRect = luckyCard.getBoundingClientRect();
    const currentScrollTop = Math.max(
      window.scrollY,
      window.pageYOffset,
      document.documentElement?.scrollTop ?? 0,
      document.body?.scrollTop ?? 0
    );
    const targetTop = Math.max(0, currentScrollTop + cardRect.top - window.innerHeight * 0.22);
    window.scrollTo({
      top: targetTop,
      behavior: 'smooth'
    });
  };
  const editingRestaurant = useMemo(() => {
    if (!editingRestaurantId) {
      return null;
    }

    return restaurants.find((restaurant) => restaurant.id === editingRestaurantId) ?? null;
  }, [editingRestaurantId, restaurants]);
  const canEditRestaurants = Boolean(adminTools) && allowRestaurantEditing;
  const canDeleteRestaurants = Boolean(adminTools) && !embedded;
  const resolvedPrimaryColor = primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const resolvedSecondaryColor = secondaryColor ?? DEFAULT_SECONDARY_COLOR;
  const rootStyle = buildThemeCssVariables(resolvedPrimaryColor, resolvedSecondaryColor, 'theme') as CSSProperties;
  const filtersReady = embedded || hasInitializedFilters;

  return (
    <div className={embedded ? styles.embeddedRoot : styles.eatsRoot} style={rootStyle}>
      <div className={styles.headerCard}>
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
          <span className={styles.countNumber}>{triedCount}</span> recommended, <span className={styles.countNumber}>{untriedCount}</span>{' '}
          wanting to try!
        </div>
      </div>
      {filtersReady ? (
        <>
          <div
            className={`${styles.body} ${
              isSearchActive ? (grouped.size > 0 ? styles.searchResultsBody : styles.searchEmptyBody) : ''
            }`}
          >
            {!isSearchActive ? (
              <div className={styles.sorting}>
                <div className={`${styles.sortingField} ${styles.cityField}`}>
                  <label htmlFor="city">City:</label>
                  <CitySelect
                    id="city"
                    groups={filterCityGroups}
                    value={selectedCity ?? ''}
                    onChange={handleCityChange}
                    leadingOptions={[{ label: `All Cities (${restaurants.length})`, value: '' }]}
                  />
                </div>
                <div className={`${styles.sortingField} ${styles.mealField}`}>
                  <label htmlFor="mealType">Meal Type:</label>
                  <select value={selectedMealType} onChange={(event) => setSelectedMealType(event.target.value)}>
                    <option value="Any">Any</option>
                    {[...mealTypeCounts.keys()].map((meal) => (
                      <option key={meal} value={meal}>
                        {mealLabel(meal)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={`${styles.sortingField} ${styles.categoryField}`}>
                  <label htmlFor="category">Categorise By:</label>
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value as CategoryFilter)}
                  >
                    <option value="area" disabled={isAllCitiesSelected}>
                      Area
                    </option>
                    <option value="type">Type of Food</option>
                    <option value="recentlyAdded">Date Added</option>
                  </select>
                </div>
                <div className={`${styles.sortingField} ${styles.viewModeGroup}`}>
                  <span className={styles.viewModeLabel}>View:</span>
                  <label className={styles.compactToggle}>
                    <input
                      type="checkbox"
                      checked={compactCards}
                      onChange={(event) => setCompactCards(event.target.checked)}
                    />
                    <span>Compact Cards</span>
                  </label>
                </div>
                <div className={`${styles.sortingField} ${styles.statusFilterGroup}`}>
                  <span className={styles.statusFilterLabel}>Status:</span>
                  <div className={styles.filtersContainer}>
                    <label className={`${styles.statusFilterChip} ${styles.untriedStatusFilterChip}`}>
                      <input
                        type="checkbox"
                        checked={selectedStatuses.includes('untried')}
                        disabled={statusCount('untried') === 0}
                        onChange={(event) => toggleSelectedStatus('untried', event.target.checked)}
                      />
                      <span>Want to Try ({statusCount('untried')})</span>
                    </label>
                    <label className={`${styles.statusFilterChip} ${styles.likedStatusFilterChip}`}>
                      <input
                        type="checkbox"
                        checked={selectedStatuses.includes('liked')}
                        disabled={statusCount('liked') === 0}
                        onChange={(event) => toggleSelectedStatus('liked', event.target.checked)}
                      />
                      <span>Recommended ({statusCount('liked')})</span>
                    </label>
                    <label className={`${styles.statusFilterChip} ${styles.dislikedStatusFilterChip}`}>
                      <input
                        type="checkbox"
                        checked={selectedStatuses.includes('disliked')}
                        disabled={statusCount('disliked') === 0}
                        onChange={(event) => toggleSelectedStatus('disliked', event.target.checked)}
                      />
                      <span>Not Recommended ({statusCount('disliked')})</span>
                    </label>
                  </div>
                </div>
                <div className={styles.filterControls}>
                  {category !== 'recentlyAdded' && headings.length > 1 ? (
                    <div className={styles.filterPickerGroup} ref={filterPopoverRef}>
                      <button
                        type="button"
                        className={styles.filterSummaryButton}
                        aria-expanded={isFilterPopoverOpen}
                        aria-controls={filterPopoverId}
                        onClick={() => {
                          setIsSearchPopoverOpen(false);
                          setIsFilterPopoverOpen((current) => !current);
                        }}
                      >
                        {category === 'area' ? 'Filter Areas' : 'Filter Types'} ({filterButtonStateLabel})
                      </button>
                      {isFilterPopoverOpen ? (
                        <div
                          className={`${styles.filterPopover} ${
                            filterPopoverDirection === 'up' ? styles.filterPopoverUp : styles.filterPopoverDown
                          }`}
                          id={filterPopoverId}
                          ref={filterPopoverPanelRef}
                    >
                      <div className={styles.filterPopoverHeader}>
                        <h2>Filter {category === 'area' ? 'Areas' : 'Types'}</h2>
                        <div className={styles.filterPopoverActions}>
                          <button
                            type="button"
                            onClick={() => {
                              preservedIncludedHeadings.current = null;
                              setExcluded([]);
                            }}
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              preservedIncludedHeadings.current = [];
                              setExcluded(headings);
                            }}
                          >
                            Clear All
                          </button>
                        </div>
                      </div>
                      <div className={`${styles.filtersContainer} ${styles.filterPopoverList}`}>
                        {headings.map((heading) => (
                          <label key={heading}>
                            <input
                              type="checkbox"
                              checked={!excluded.includes(heading)}
                              onChange={(event) => {
                                setExcluded((current) => {
                                  let nextExcluded: string[];
                                  if (event.target.checked) {
                                    nextExcluded = current.filter((entry) => entry !== heading);
                                  } else if (current.includes(heading)) {
                                    nextExcluded = current;
                                  } else {
                                    nextExcluded = [...current, heading];
                                  }

                                  preservedIncludedHeadings.current = getPreservedIncludedHeadings(
                                    headings,
                                    nextExcluded
                                  );

                                  return nextExcluded;
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
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {!embedded ? (
                <button
                  type="button"
                  onClick={handleFeelingLucky}
                  disabled={disableFeelingLuckyButton}
                >
                  I'm Feeling Lucky
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className={`${styles.placesContainer} ${isSearchActive ? styles.searchPlacesContainer : ''}`}>
          {grouped.size === 0 ? (
            <div className={styles.noResults}>
              {isSearchActive ? `No restaurants matched "${searchQuery.trim()}".` : noResultsMessage}
            </div>
          ) : (
            [...grouped.entries()].map(([heading, places]) => (
              <Fragment key={heading}>
                <span className={styles.heading}>
                  {category === 'type' ? `${places[0]?.types.find((type) => type.name === heading)?.emoji ?? ''} ` : ''}
                  {category === 'recentlyAdded' ? getMonthHeadingLabel(heading) : heading}
                </span>
                <div>
                  {places
                    .slice()
                    .sort((a, b) => {
                      if (category === 'recentlyAdded') {
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                      }

                      return a.name.localeCompare(b.name);
                    })
                    .map((place) => {
                      const compactDetailText = getRestaurantDetailText(place);
                      const compactDetailId = `compact-detail-${place.id}`;
                      const isCompactDetailExpanded = expandedCompactCardIds.has(place.id);

                      return (
                        <div
                          className={`${styles.placeCard} ${compactCards ? styles.compactPlaceCard : ''} ${
                            luckyRestaurantId === place.id ? styles.luckyCard : ''
                          } ${
                            place.status === 'liked'
                              ? styles.likedPlaceCard
                              : place.status === 'disliked'
                                ? styles.dislikedPlaceCard
                                : styles.untriedPlaceCard
                          }`}
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
                        {compactCards ? (
                          <span className={styles.compactStatusLabel}>
                            {place.status === 'liked'
                              ? 'Recommended'
                              : place.status === 'disliked'
                                ? 'Not Recommended'
                                : 'Want to Try'}
                          </span>
                        ) : null}
                        {compactCards && compactDetailText.length > 0 ? (
                          <button
                            type="button"
                            className={`${styles.compactDetailsToggle} ${
                              isCompactDetailExpanded ? styles.compactDetailsToggleExpanded : ''
                            }`}
                            aria-label={isCompactDetailExpanded ? `Hide notes for ${place.name}` : `Show notes for ${place.name}`}
                            aria-expanded={isCompactDetailExpanded}
                            aria-controls={compactDetailId}
                            onClick={() => {
                              setExpandedCompactCardIds((current) => {
                                const next = new Set(current);

                                if (next.has(place.id)) {
                                  next.delete(place.id);
                                } else {
                                  next.add(place.id);
                                }

                                return next;
                              });
                            }}
                          />
                        ) : null}
                        {!compactCards && place.status === 'untried' ? (
                          <div className={styles.untriedBadgeRow}>
                            <span className={styles.untriedBadge}>Want to Try</span>
                          </div>
                        ) : null}
                        {!compactCards && place.status === 'liked' ? (
                          <div className={styles.untriedBadgeRow}>
                            <span className={styles.likedBadge}>Recommended</span>
                          </div>
                        ) : null}
                        {!compactCards && place.status === 'disliked' ? (
                          <div className={styles.untriedBadgeRow}>
                            <span className={styles.dislikedBadge}>Not Recommended</span>
                          </div>
                        ) : null}
                        <span>
                          <a className={styles.subHeading} href={place.url} target="_blank" rel="noreferrer">
                            {place.name}
                          </a>
                        </span>
                        {isAllCitiesSelected ? (
                          <span className={styles.cardCity}>
                            {place.cityName}, {place.countryName}
                          </span>
                        ) : null}

                        {!compactCards && place.referredBy.trim().length > 0 ? (
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
                          {category === 'type' && !searchQuery
                            ? place.areas.join(', ')
                            : (category === 'recentlyAdded' || searchQuery)
                              ? `${place.types.map((type) => `${type.emoji} ${type.name}`).join(', ')}${
                                place.areas.length > 0 ? ` • ${place.areas.join(', ')}` : ''
                              }`
                              : place.types.map((type) => `${type.emoji} ${type.name}`).join(', ')}
                          {selectedMealType === 'Any' && !compactCards
                            ? ` (${place.mealTypes.map((meal) => mealLabel(meal)).join(', ')})`
                            : ''}
                        </span>

                        {!compactCards ? (
                          place.status === 'disliked' ? (
                            place.dislikedReason ? (
                              <div className={styles.dislikedReason}>Reason: {place.dislikedReason}</div>
                            ) : null
                          ) : (
                            <div className={styles.notes}>{place.notes}</div>
                          )
                        ) : null}

                        {compactCards && compactDetailText.length > 0 ? (
                          <>
                            {isCompactDetailExpanded ? (
                              <div
                                className={
                                  place.status === 'disliked'
                                    ? `${styles.compactDetails} ${styles.compactDislikedDetails}`
                                    : styles.compactDetails
                                }
                                id={compactDetailId}
                              >
                                {place.status === 'disliked' ? `Reason: ${compactDetailText}` : compactDetailText}
                              </div>
                            ) : null}
                          </>
                        ) : null}

                        {!compactCards && (canEditRestaurants || canDeleteRestaurants) ? (
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
                      );
                    })}
                </div>
              </Fragment>
            ))
          )}
        </div>
          </div>
        </>
      ) : null}
      {!embedded ? (
        <div
          className={`${styles.floatingActionStack} ${
            isSearchPopoverOpen ? styles.floatingActionStackRaised : ''
          }`}
        >
          {createTools ? (
          <button
            type="button"
            className={`${styles.addFab} ${styles.stackedFab}`}
            aria-label="Add restaurant"
            title="Add restaurant"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            +
          </button>
          ) : null}
          <div className={styles.floatingPopoverAnchor} ref={searchPopoverRef}>
            <button
              type="button"
              className={`${styles.addFab} ${styles.stackedFab} ${styles.searchFab} ${
                isSearchPopoverOpen ? styles.searchFabActive : ''
              }`}
              aria-label="Search restaurants"
              title="Search restaurants"
              aria-expanded={isSearchPopoverOpen}
              aria-controls={searchPopoverId}
              onClick={() => {
                setIsFilterPopoverOpen(false);
                setIsSearchPopoverOpen((current) => !current);
              }}
            >
              <svg className={styles.searchFabIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16L20 20" />
              </svg>
            </button>
            {isSearchPopoverOpen ? (
              <div
                className={`${styles.filterPopover} ${styles.floatingSearchPopover}`}
                id={searchPopoverId}
              >
                <div className={styles.searchPopoverBody}>
                  <label htmlFor="floating-search">Search restaurants</label>
                  <input
                    id="floating-search"
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search restaurant names"
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {createTools && !embedded ? (
        <>
          {isCreateDialogOpen ? (
            <div className={styles.createDialogOverlay}>
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
                    onClick={closeCreateDialog}
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
                    areaSuggestionsByCity={areaSuggestionsByCity}
                    disableAreasUntilCitySelected
                    keyPrefix="root-create-restaurant"
                    submitLabel="Create restaurant"
                    disableSubmit={createTools.cities.length === 0}
                    defaults={{
                      cityId: createDefaultCityId,
                      mealTypes: createDefaultMealTypes,
                      status: createDefaultStatus
                    }}
                    onDirtyChange={setCreateDialogHasUnsavedChanges}
                    showDevelopmentPopulateButton={process.env.NODE_ENV !== 'production'}
                  />
                </form>
              </section>
            </div>
          ) : null}
        </>
      ) : null}
      {!embedded && showBackToTop ? (
        <button
          type="button"
          className={`${styles.addFab} ${styles.floatingLeft}`}
          aria-label="Back to top"
          title="Back to top"
          onClick={() => {
            window.scrollTo({
              top: 0,
              behavior: 'smooth'
            });
          }}
        >
          <svg className={styles.backToTopIcon} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 20V5" />
            <path d="M5 12L12 5L19 12" />
          </svg>
        </button>
      ) : null}
      {canEditRestaurants && adminTools && editingRestaurant ? (
        <div className={styles.createDialogOverlay}>
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
                onClick={closeEditRestaurantDialog}
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

                setIsSavingEditRestaurant(true);
              }}
            >
              <input type="hidden" name="restaurantId" value={editingRestaurant.id} />
              <RestaurantFormFields
                cities={adminTools.cities}
                types={adminTools.types}
                areaSuggestionsByCity={areaSuggestionsByCity}
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
                onDirtyChange={setEditDialogHasUnsavedChanges}
              />
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
