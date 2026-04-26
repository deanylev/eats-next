'use client';

import Fuse from 'fuse.js';
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createRestaurantFromRoot, updateRestaurantFromRoot } from '@/app/actions';
import { buildCitySelectGroups, CitySelect } from '@/app/components/city-select';
import { DeleteRestaurantForm } from '@/app/components/delete-restaurant-form';
import { RestaurantFormFields } from '@/app/components/restaurant-form-fields';
import {
  byAlpha,
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
const controlsWalkthroughStorageKey = 'publicEatsControlsWalkthroughSeen';
const savedFilterGroupsStorageKey = 'publicEatsSavedFilterGroups';
const minimumUpwardFilterPopoverListHeight = 160;
const filterPopoverOffset = 20;

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

const hasSeenControlsWalkthrough = (): boolean => {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    return window.localStorage.getItem(controlsWalkthroughStorageKey) === 'true';
  } catch {
    return true;
  }
};

const markControlsWalkthroughSeen = (): void => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(controlsWalkthroughStorageKey, 'true');
  } catch {
    // Ignore storage failures; the walkthrough can still be dismissed for this session.
  }
};

type SavedFilterGroupCategory = Extract<CategoryFilter, 'area' | 'type'>;

type SavedFilterGroup = {
  id: string;
  name: string;
  category: SavedFilterGroupCategory;
  city: string | null;
  headings: string[];
};

const isSavedFilterGroupCategory = (value: string): value is SavedFilterGroupCategory =>
  value === 'area' || value === 'type';

const getSavedFilterGroupSignature = (headings: string[]): string =>
  [...new Set(headings.map((heading) => heading.trim()).filter(Boolean))]
    .sort((headingA, headingB) => byAlpha(headingA, headingB))
    .join('\n');

const readStoredFilterGroups = (): SavedFilterGroup[] => {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(savedFilterGroupsStorageKey);
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry): SavedFilterGroup[] => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        typeof entry.id !== 'string' ||
        typeof entry.name !== 'string' ||
        typeof entry.category !== 'string' ||
        !isSavedFilterGroupCategory(entry.category) ||
        (entry.city !== null && typeof entry.city !== 'string') ||
        !Array.isArray(entry.headings) ||
        !entry.headings.every((heading: unknown) => typeof heading === 'string')
      ) {
        return [];
      }

      return [
        {
          id: entry.id,
          name: entry.name,
          category: entry.category,
          city: entry.city,
          headings: getSavedFilterGroupSignature(entry.headings).split('\n').filter(Boolean)
        }
      ];
    });
  } catch {
    return [];
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

type WalkthroughTargetId = 'city' | 'status' | 'filters' | 'compact' | 'search';

type WalkthroughStep = {
  id: WalkthroughTargetId;
  title: string;
  description: string;
};

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type WalkthroughCardPosition = {
  top: number;
  left: number;
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
  const [savedFilterGroups, setSavedFilterGroups] = useState<SavedFilterGroup[]>(readStoredFilterGroups);
  const [expandedCompactCardIds, setExpandedCompactCardIds] = useState<Set<string>>(new Set());
  const [isControlsWalkthroughOpen, setIsControlsWalkthroughOpen] = useState(false);
  const [controlsWalkthroughStepIndex, setControlsWalkthroughStepIndex] = useState(0);
  const [controlsWalkthroughSpotlightRect, setControlsWalkthroughSpotlightRect] = useState<SpotlightRect | null>(null);
  const [controlsWalkthroughCardPosition, setControlsWalkthroughCardPosition] = useState<WalkthroughCardPosition | null>(null);
  const [luckyRestaurantId, setLuckyRestaurantId] = useState<string | null>(null);
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
  const [filterPopoverDirection, setFilterPopoverDirection] = useState<'up' | 'down'>('up');
  const [filterPopoverMaxHeight, setFilterPopoverMaxHeight] = useState<number | null>(null);
  const [filterPopoverListMaxHeight, setFilterPopoverListMaxHeight] = useState<number | null>(null);
  const [isSearchPopoverOpen, setIsSearchPopoverOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(openCreateDialogByDefault);
  const [createDialogHasUnsavedChanges, setCreateDialogHasUnsavedChanges] = useState(false);
  const [editingRestaurantId, setEditingRestaurantId] = useState<string | null>(openEditRestaurantId ?? null);
  const [editDialogHasUnsavedChanges, setEditDialogHasUnsavedChanges] = useState(false);
  const [isSavingEditRestaurant, setIsSavingEditRestaurant] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const restaurantCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const luckyCardHasEnteredViewport = useRef<boolean>(false);
  const cityFieldRef = useRef<HTMLDivElement | null>(null);
  const compactFieldRef = useRef<HTMLDivElement | null>(null);
  const statusFieldRef = useRef<HTMLDivElement | null>(null);
  const filterControlsRef = useRef<HTMLDivElement | null>(null);
  const searchFabButtonRef = useRef<HTMLButtonElement | null>(null);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  const filterPopoverPanelRef = useRef<HTMLDivElement | null>(null);
  const filterPopoverHeaderRef = useRef<HTMLDivElement | null>(null);
  const savedFilterGroupsSectionRef = useRef<HTMLDivElement | null>(null);
  const filterPopoverListRef = useRef<HTMLDivElement | null>(null);
  const walkthroughLayoutFrameRef = useRef<number | null>(null);
  const filterPopoverId = useId();
  const searchPopoverRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchPopoverId = useId();
  const filtersReady = hasInitializedFilters;

  const getWalkthroughTargetElement = useCallback((targetId: WalkthroughTargetId): HTMLElement | null => {
    switch (targetId) {
      case 'city':
        return cityFieldRef.current;
      case 'status':
        return statusFieldRef.current;
      case 'filters':
        return filterControlsRef.current;
      case 'compact':
        return compactFieldRef.current;
      case 'search':
        return searchFabButtonRef.current;
      default:
        return null;
    }
  }, []);

  const closeControlsWalkthrough = useCallback((markSeen: boolean): void => {
    if (markSeen) {
      markControlsWalkthroughSeen();
    }

    setIsControlsWalkthroughOpen(false);
    setControlsWalkthroughStepIndex(0);
    setControlsWalkthroughSpotlightRect(null);
    setControlsWalkthroughCardPosition(null);
  }, []);

  const openControlsWalkthrough = useCallback((): void => {
    setIsFilterPopoverOpen(false);
    setIsSearchPopoverOpen(false);
    setControlsWalkthroughStepIndex(0);
    setIsControlsWalkthroughOpen(true);
  }, []);

  useEffect(() => {
    setCompactCards(readStoredCompactCards());

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
  }, []);

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
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(savedFilterGroupsStorageKey, JSON.stringify(savedFilterGroups));
    } catch {
      // Ignore storage failures; saved filter groups just will not persist.
    }
  }, [savedFilterGroups]);

  useEffect(() => {
    if (!compactCards) {
      setExpandedCompactCardIds(new Set());
    }
  }, [compactCards]);

  const toggleCompactCardExpansion = useCallback((restaurantId: string): void => {
    setExpandedCompactCardIds((current) => {
      const next = new Set(current);

      if (next.has(restaurantId)) {
        next.delete(restaurantId);
      } else {
        next.add(restaurantId);
      }

      return next;
    });
  }, []);

  const shouldIgnoreCompactCardToggle = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) {
      return false;
    }

    return target.closest('a, button, input, select, textarea, form, label') !== null;
  }, []);

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
  const countryNames = useMemo(() => [...citiesByCountry.keys()], [citiesByCountry]);
  const onlyCountryName = countryNames[0] ?? null;
  const hasMultipleCountries = countryNames.length > 1;
  const hasMultipleCities = useMemo(() => {
    let cityCount = 0;

    for (const cityMap of citiesByCountry.values()) {
      cityCount += cityMap.size;

      if (cityCount > 1) {
        return true;
      }
    }

    return false;
  }, [citiesByCountry]);

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

  const controlsWalkthroughSteps = useMemo((): WalkthroughStep[] => {
    const steps: WalkthroughStep[] = [];

    if (hasMultipleCities) {
      const cityStepDescription =
        defaultCityName && defaultCityName.trim().length > 0
          ? hasMultipleCountries
            ? `I have places listed from cities all around the world - not just ${defaultCityName.trim()}!`
            : `I have places listed from cities all around ${onlyCountryName ?? 'the country'} - not just ${defaultCityName.trim()}!`
          : hasMultipleCountries
            ? 'I have places listed from cities all around the world.'
            : `I have places listed from cities all around ${onlyCountryName ?? 'the country'}.`;

      steps.push({
        id: 'city',
        title: 'Pick a city first',
        description: cityStepDescription
      });
    }

    steps.push({
      id: 'status',
      title: 'Filter by status',
      description: 'Use these to show places I want to try, places I recommend, or places I would skip.'
    });

    if (category !== 'recentlyAdded' && headings.length > 1) {
      steps.push({
        id: 'filters',
        title: 'Narrow it down',
        description: 'Filter by area or cuisine here. You can also save a combination if you want to reuse it.'
      });
    }

    steps.push({
      id: 'compact',
      title: 'Choose your view',
      description: 'Compact cards shows more places at once. Full cards show the notes and details without extra taps.'
    });

    steps.push({
      id: 'search',
      title: 'Search by name',
      description: 'If you already have a place in mind, use search to jump straight to it.'
    });

    return steps;
  }, [category, defaultCityName, hasMultipleCities, hasMultipleCountries, headings.length, isSearchActive, onlyCountryName]);

  const activeControlsWalkthroughStep = controlsWalkthroughSteps[controlsWalkthroughStepIndex] ?? null;

  useEffect(() => {
    if (!filtersReady || isControlsWalkthroughOpen || hasSeenControlsWalkthrough()) {
      return;
    }

    const openTimer = window.setTimeout(() => {
      openControlsWalkthrough();
    }, 500);

    return () => {
      window.clearTimeout(openTimer);
    };
  }, [filtersReady, isControlsWalkthroughOpen, openControlsWalkthrough]);

  useEffect(() => {
    if (!isControlsWalkthroughOpen || typeof document === 'undefined') {
      return;
    }

    const { documentElement, body } = document;
    const previousHtmlOverflow = documentElement.style.overflow;
    const previousHtmlOverscrollBehavior = documentElement.style.overscrollBehavior;
    const previousBodyOverflow = body.style.overflow;
    const previousBodyOverscrollBehavior = body.style.overscrollBehavior;

    documentElement.style.overflow = 'hidden';
    documentElement.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';

    return () => {
      documentElement.style.overflow = previousHtmlOverflow;
      documentElement.style.overscrollBehavior = previousHtmlOverscrollBehavior;
      body.style.overflow = previousBodyOverflow;
      body.style.overscrollBehavior = previousBodyOverscrollBehavior;
    };
  }, [isControlsWalkthroughOpen]);

  useEffect(() => {
    if (!isControlsWalkthroughOpen) {
      return;
    }

    if (controlsWalkthroughSteps.length === 0) {
      closeControlsWalkthrough(false);
      return;
    }

    if (controlsWalkthroughStepIndex >= controlsWalkthroughSteps.length) {
      setControlsWalkthroughStepIndex(controlsWalkthroughSteps.length - 1);
      return;
    }

    const currentStep = controlsWalkthroughSteps[controlsWalkthroughStepIndex];
    if (!currentStep) {
      return;
    }

    if (!getWalkthroughTargetElement(currentStep.id)) {
      const fallbackIndex = controlsWalkthroughSteps.findIndex((step) => getWalkthroughTargetElement(step.id));

      if (fallbackIndex === -1) {
        closeControlsWalkthrough(false);
      } else if (fallbackIndex !== controlsWalkthroughStepIndex) {
        setControlsWalkthroughStepIndex(fallbackIndex);
      }
    }
  }, [
    closeControlsWalkthrough,
    controlsWalkthroughStepIndex,
    controlsWalkthroughSteps,
    getWalkthroughTargetElement,
    isControlsWalkthroughOpen
  ]);

  useLayoutEffect(() => {
    if (!isControlsWalkthroughOpen || !activeControlsWalkthroughStep || typeof window === 'undefined') {
      return;
    }

    const target = getWalkthroughTargetElement(activeControlsWalkthroughStep.id);
    if (!target) {
      return;
    }

    const updateWalkthroughLayout = (): void => {
      const rect = target.getBoundingClientRect();
      const padding = 10;
      const spotlightRect = {
        top: Math.max(8, rect.top - padding),
        left: Math.max(8, rect.left - padding),
        width: Math.min(window.innerWidth - 16, rect.width + padding * 2),
        height: rect.height + padding * 2
      };
      const cardWidth = Math.min(320, window.innerWidth - 32);
      const preferredLeft = rect.left + rect.width / 2 - cardWidth / 2;
      const left = Math.min(Math.max(16, preferredLeft), Math.max(16, window.innerWidth - cardWidth - 16));
      const spacing = 18;
      const estimatedCardHeight = 190;
      const shouldPlaceBelow = rect.bottom + spacing + estimatedCardHeight <= window.innerHeight - 16 || rect.top < 180;
      const top = shouldPlaceBelow
        ? Math.min(window.innerHeight - estimatedCardHeight - 16, rect.bottom + spacing)
        : Math.max(16, rect.top - estimatedCardHeight - spacing);

      setControlsWalkthroughSpotlightRect(spotlightRect);
      setControlsWalkthroughCardPosition({ top, left });
    };

    const scheduleWalkthroughLayoutUpdate = (): void => {
      if (walkthroughLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(walkthroughLayoutFrameRef.current);
      }

      walkthroughLayoutFrameRef.current = window.requestAnimationFrame(() => {
        walkthroughLayoutFrameRef.current = null;
        updateWalkthroughLayout();
      });
    };

    const rect = target.getBoundingClientRect();
    const scrollViewportTop = Math.max(88, window.innerHeight * 0.18);
    const scrollViewportBottom = window.innerHeight - 24;
    const shouldResetToTop = activeControlsWalkthroughStep.id === 'search';
    const needsScroll =
      shouldResetToTop || rect.top < scrollViewportTop || rect.bottom > scrollViewportBottom;

    setControlsWalkthroughSpotlightRect(null);
    setControlsWalkthroughCardPosition(null);

    if (needsScroll) {
      const targetTop = shouldResetToTop ? 0 : window.scrollY + rect.top - scrollViewportTop;
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'auto'
      });
    }

    scheduleWalkthroughLayoutUpdate();
    window.addEventListener('resize', scheduleWalkthroughLayoutUpdate);
    window.addEventListener('scroll', scheduleWalkthroughLayoutUpdate, { passive: true });

    return () => {
      if (walkthroughLayoutFrameRef.current !== null) {
        window.cancelAnimationFrame(walkthroughLayoutFrameRef.current);
        walkthroughLayoutFrameRef.current = null;
      }

      window.removeEventListener('resize', scheduleWalkthroughLayoutUpdate);
      window.removeEventListener('scroll', scheduleWalkthroughLayoutUpdate);
    };
  }, [activeControlsWalkthroughStep, getWalkthroughTargetElement, isControlsWalkthroughOpen]);

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
      const header = filterPopoverHeaderRef.current;
      const savedGroupsSection = savedFilterGroupsSectionRef.current;
      const list = filterPopoverListRef.current;
      if (!trigger || !panel || !header || !list) {
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const margin = 16;
      const spaceBelow = viewportHeight - triggerRect.bottom - margin - filterPopoverOffset;
      const spaceAbove = triggerRect.top - margin - filterPopoverOffset;
      const panelStyles = window.getComputedStyle(panel);
      const savedGroupsSectionStyles = savedGroupsSection ? window.getComputedStyle(savedGroupsSection) : null;
      const panelVerticalPadding =
        Number.parseFloat(panelStyles.paddingTop) + Number.parseFloat(panelStyles.paddingBottom);
      const headerHeight = header.offsetHeight;
      const savedGroupsSectionHeight = savedGroupsSection
        ? (
            savedGroupsSection.offsetHeight +
            Number.parseFloat(savedGroupsSectionStyles?.marginTop ?? '0')
          )
        : 0;
      const staticPanelHeight = panelVerticalPadding + headerHeight + savedGroupsSectionHeight;
      const minimumUpwardPanelHeight = staticPanelHeight + minimumUpwardFilterPopoverListHeight;
      const shouldOpenUp = spaceAbove >= minimumUpwardPanelHeight && spaceAbove > spaceBelow;
      const preferredSpace = shouldOpenUp ? spaceAbove : spaceBelow;
      const fallbackSpace = shouldOpenUp ? spaceBelow : spaceAbove;
      const availablePanelHeight = Math.max(0, preferredSpace > 0 ? preferredSpace : fallbackSpace);
      const availableListHeight = Math.max(0, availablePanelHeight - staticPanelHeight - 24);

      setFilterPopoverDirection(shouldOpenUp ? 'up' : 'down');
      setFilterPopoverMaxHeight(availablePanelHeight);
      setFilterPopoverListMaxHeight(Math.max(0, availableListHeight));
    };

    updateFilterPopoverDirection();
    window.addEventListener('resize', updateFilterPopoverDirection);

    return () => {
      window.removeEventListener('resize', updateFilterPopoverDirection);
    };
  }, [category, headings.length, isFilterPopoverOpen, savedFilterGroups.length, selectedCity]);

  useEffect(() => {
    if (typeof window === 'undefined' || !hasInitializedFilters) {
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
  }, [category, excluded, hasInitializedFilters, isAllCitiesSelected, searchQuery, selectedCity, selectedMealType, selectedStatuses]);

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
  const activeFilterGroupCategory = category === 'area' || category === 'type' ? category : null;
  const currentIncludedHeadings = useMemo(
    () => headings.filter((heading) => !excluded.includes(heading)),
    [excluded, headings]
  );
  const visibleSavedFilterGroups = useMemo(() => {
    if (!activeFilterGroupCategory) {
      return [];
    }

    return savedFilterGroups
      .filter(
        (group) =>
          group.category === activeFilterGroupCategory &&
          group.city === selectedCity
      )
      .sort((groupA, groupB) => byAlpha(groupA.name, groupB.name));
  }, [activeFilterGroupCategory, savedFilterGroups, selectedCity]);
  const currentFilterGroupSignature = useMemo(
    () => getSavedFilterGroupSignature(currentIncludedHeadings),
    [currentIncludedHeadings]
  );
  const matchingSavedFilterGroup = useMemo(
    () =>
      visibleSavedFilterGroups.find(
        (group) => getSavedFilterGroupSignature(group.headings) === currentFilterGroupSignature
      ) ?? null,
    [currentFilterGroupSignature, visibleSavedFilterGroups]
  );
  const filterButtonStateLabel = useMemo(() => {
    if (headings.length === 0 || includedHeadingsCount === headings.length) {
      return 'All';
    }

    return `${includedHeadingsCount} / ${headings.length}`;
  }, [headings.length, includedHeadingsCount]);
  const canSaveCurrentFilterGroup = activeFilterGroupCategory !== null
    && headings.length > 0
    && currentIncludedHeadings.length > 1
    && currentIncludedHeadings.length < headings.length
    && matchingSavedFilterGroup === null;
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
    if (typeof window === 'undefined') {
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
  }, []);

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

  useEffect(() => {
    if (!isFilterPopoverOpen) {
      setFilterPopoverMaxHeight(null);
      setFilterPopoverListMaxHeight(null);
    }
  }, [isFilterPopoverOpen]);

  useEffect(() => {
    setFilterPopoverMaxHeight(null);
    setFilterPopoverListMaxHeight(null);
  }, [category, selectedCity]);

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
  const applySavedFilterGroup = useCallback((group: SavedFilterGroup): void => {
    const availableIncludedHeadings = headings.filter((heading) => group.headings.includes(heading));
    preservedIncludedHeadings.current = availableIncludedHeadings;
    setExcluded(headings.filter((heading) => !availableIncludedHeadings.includes(heading)));
  }, [headings]);
  const saveCurrentFilterGroup = useCallback((): void => {
    if (!canSaveCurrentFilterGroup || !activeFilterGroupCategory) {
      return;
    }

    const name = window.prompt(
      `Save this ${activeFilterGroupCategory === 'area' ? 'area' : 'category'} group as:`
    )?.trim();

    if (!name) {
      return;
    }

    setSavedFilterGroups((current) => {
      const duplicateCombination = current.find(
        (group) =>
          group.category === activeFilterGroupCategory &&
          group.city === selectedCity &&
          getSavedFilterGroupSignature(group.headings) === currentFilterGroupSignature
      );

      if (duplicateCombination) {
        window.confirm(`This selection already matches the saved group "${duplicateCombination.name}".`);
        return current;
      }

      const existingGroup = current.find(
        (group) =>
          group.category === activeFilterGroupCategory &&
          group.city === selectedCity &&
          group.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0
      );

      if (existingGroup && !window.confirm(`Replace the saved group "${existingGroup.name}"?`)) {
        return current;
      }

      const nextGroup: SavedFilterGroup = {
        id: existingGroup?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        category: activeFilterGroupCategory,
        city: selectedCity,
        headings: currentFilterGroupSignature.split('\n').filter(Boolean)
      };

      if (!existingGroup) {
        return [...current, nextGroup];
      }

      return current.map((group) => (group.id === existingGroup.id ? nextGroup : group));
    });
  }, [activeFilterGroupCategory, canSaveCurrentFilterGroup, currentFilterGroupSignature, selectedCity]);
  const deleteSavedFilterGroup = useCallback((group: SavedFilterGroup): void => {
    if (!window.confirm(`Delete the saved group "${group.name}"?`)) {
      return;
    }

    setSavedFilterGroups((current) => current.filter((entry) => entry.id !== group.id));
  }, []);
  const editingRestaurant = useMemo(() => {
    if (!editingRestaurantId) {
      return null;
    }

    return restaurants.find((restaurant) => restaurant.id === editingRestaurantId) ?? null;
  }, [editingRestaurantId, restaurants]);
  const canEditRestaurants = Boolean(adminTools) && allowRestaurantEditing;
  const canDeleteRestaurants = Boolean(adminTools);
  const showWalkthroughDebugTrigger = process.env.NODE_ENV !== 'production';
  const resolvedPrimaryColor = primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const resolvedSecondaryColor = secondaryColor ?? DEFAULT_SECONDARY_COLOR;
  const rootStyle = buildThemeCssVariables(resolvedPrimaryColor, resolvedSecondaryColor, 'theme') as CSSProperties;

  return (
    <div className={styles.eatsRoot} style={rootStyle}>
      <div className={styles.headerCard}>
        {title || showAdminButton ? (
          <div className={styles.titleRow}>
            {title ? <div className={styles.title}>{title}</div> : null}
            {showAdminButton ? (
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
            <div className={`${styles.sorting} ${isSearchActive ? styles.searchSorting : ''}`}>
              {!isSearchActive ? (
                <>
                  {hasMultipleCities ? (
                    <div className={`${styles.sortingField} ${styles.cityField}`} ref={cityFieldRef}>
                      <label htmlFor="city">City:</label>
                      <CitySelect
                        id="city"
                        groups={filterCityGroups}
                        value={selectedCity ?? ''}
                        onChange={handleCityChange}
                        leadingOptions={[{ label: `All Cities (${restaurants.length})`, value: '' }]}
                      />
                    </div>
                  ) : null}
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
                </>
              ) : null}
              <div className={`${styles.sortingField} ${styles.viewModeGroup}`} ref={compactFieldRef}>
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
              <div className={`${styles.sortingField} ${styles.statusFilterGroup}`} ref={statusFieldRef}>
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
              {!isSearchActive ? (
                <div className={styles.filterControls} ref={filterControlsRef}>
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
                          style={
                            filterPopoverMaxHeight !== null
                              ? ({ '--filter-popover-max-height': `${filterPopoverMaxHeight}px` } as CSSProperties)
                              : undefined
                          }
                        >
                          <div className={styles.filterPopoverHeader} ref={filterPopoverHeaderRef}>
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
                              <button
                                type="button"
                                className={styles.saveGroupButton}
                                disabled={!canSaveCurrentFilterGroup}
                                onClick={saveCurrentFilterGroup}
                              >
                                Save Group
                              </button>
                            </div>
                          </div>
                          {visibleSavedFilterGroups.length > 0 ? (
                            <div className={styles.savedFilterGroupsSection} ref={savedFilterGroupsSectionRef}>
                              <span className={styles.savedFilterGroupsLabel}>Saved groups</span>
                              <div className={styles.savedFilterGroupsList}>
                                {visibleSavedFilterGroups.map((group) => (
                                  <div key={group.id} className={styles.savedFilterGroupRow}>
                                    <button
                                      type="button"
                                      className={styles.savedFilterGroupButton}
                                      disabled={matchingSavedFilterGroup?.id === group.id}
                                      onClick={() => applySavedFilterGroup(group)}
                                    >
                                      {group.name}
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.savedFilterGroupDelete}
                                      aria-label={`Delete saved group ${group.name}`}
                                      onClick={() => deleteSavedFilterGroup(group)}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          <div
                            className={`${styles.filtersContainer} ${styles.filterPopoverList}`}
                            ref={filterPopoverListRef}
                            style={
                              filterPopoverListMaxHeight !== null
                                ? ({ '--filter-popover-list-max-height': `${filterPopoverListMaxHeight}px` } as CSSProperties)
                                : undefined
                            }
                          >
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
                  <button
                    type="button"
                    onClick={handleFeelingLucky}
                    disabled={disableFeelingLuckyButton}
                  >
                    I'm Feeling Lucky
                  </button>
                  {showWalkthroughDebugTrigger ? (
                    <button
                      type="button"
                      className={styles.walkthroughTrigger}
                      onClick={openControlsWalkthrough}
                    >
                      [DEV] Show Controls
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
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
                          const showCompactCardActions = canEditRestaurants || canDeleteRestaurants;
                          const canExpandCompactCard = compactCards && (compactDetailText.length > 0 || showCompactCardActions);

                          return (
                            <div
                              className={`${styles.placeCard} ${compactCards ? styles.compactPlaceCard : ''} ${
                                canExpandCompactCard ? styles.compactPlaceCardInteractive : ''
                              } ${isCompactDetailExpanded ? styles.compactPlaceCardExpanded : ''} ${
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
                              onClick={
                                canExpandCompactCard
                                  ? (event) => {
                                      if (shouldIgnoreCompactCardToggle(event.target)) {
                                        return;
                                      }

                                      toggleCompactCardExpansion(place.id);
                                    }
                                  : undefined
                              }
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
                        {canExpandCompactCard ? (
                          <button
                            type="button"
                            className={`${styles.compactDetailsToggle} ${
                              isCompactDetailExpanded ? styles.compactDetailsToggleExpanded : ''
                            }`}
                            aria-label={isCompactDetailExpanded ? `Hide details for ${place.name}` : `Show details for ${place.name}`}
                            aria-expanded={isCompactDetailExpanded}
                            aria-controls={compactDetailId}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleCompactCardExpansion(place.id);
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

                        {compactCards && isCompactDetailExpanded ? (
                          <div className={styles.compactExpandedContent} id={compactDetailId}>
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
                            {compactDetailText.length > 0 ? (
                              <div
                                className={
                                  place.status === 'disliked'
                                    ? `${styles.compactDetails} ${styles.compactDislikedDetails}`
                                    : styles.compactDetails
                                }
                              >
                                {place.status === 'disliked' ? `Reason: ${compactDetailText}` : compactDetailText}
                              </div>
                            ) : null}
                            {showCompactCardActions ? (
                              <div className={`${styles.cardActions} ${styles.compactCardActions}`}>
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
            } ${isSearchActive ? styles.searchFabHasQuery : ''} ${
              isSearchPopoverOpen ? styles.searchFabOpen : ''
            }`}
            ref={searchFabButtonRef}
            aria-label={isSearchActive ? `Search restaurants. Active query: ${searchQuery.trim()}` : 'Search restaurants'}
            title={isSearchActive ? `Search active: ${searchQuery.trim()}` : 'Search restaurants'}
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
      {isControlsWalkthroughOpen && activeControlsWalkthroughStep && controlsWalkthroughSpotlightRect && controlsWalkthroughCardPosition ? (
        <div
          className={styles.controlsWalkthroughOverlay}
          role="dialog"
          aria-modal="true"
          aria-label="Controls walkthrough"
        >
          <div
            className={styles.controlsWalkthroughSpotlight}
            style={
              {
                top: `${controlsWalkthroughSpotlightRect.top}px`,
                left: `${controlsWalkthroughSpotlightRect.left}px`,
                width: `${controlsWalkthroughSpotlightRect.width}px`,
                height: `${controlsWalkthroughSpotlightRect.height}px`
              } as CSSProperties
            }
          />
          <section
            className={styles.controlsWalkthroughCard}
            style={
              {
                top: `${controlsWalkthroughCardPosition.top}px`,
                left: `${controlsWalkthroughCardPosition.left}px`
              } as CSSProperties
            }
          >
            <div className={styles.controlsWalkthroughStepLabel}>
              Step {controlsWalkthroughStepIndex + 1} of {controlsWalkthroughSteps.length}
            </div>
            <h2>{activeControlsWalkthroughStep.title}</h2>
            <p>{activeControlsWalkthroughStep.description}</p>
            <div className={styles.controlsWalkthroughActions}>
              <button
                type="button"
                className={styles.controlsWalkthroughGhostButton}
                onClick={() => closeControlsWalkthrough(true)}
              >
                Skip
              </button>
              <button
                type="button"
                className={styles.controlsWalkthroughGhostButton}
                disabled={controlsWalkthroughStepIndex === 0}
                onClick={() => setControlsWalkthroughStepIndex((current) => Math.max(0, current - 1))}
              >
                Back
              </button>
              <button
                type="button"
                className={styles.controlsWalkthroughPrimaryButton}
                onClick={() => {
                  if (controlsWalkthroughStepIndex >= controlsWalkthroughSteps.length - 1) {
                    closeControlsWalkthrough(true);
                    return;
                  }

                  setControlsWalkthroughStepIndex((current) => current + 1);
                }}
              >
                {controlsWalkthroughStepIndex >= controlsWalkthroughSteps.length - 1 ? 'Done' : 'Next'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {createTools ? (
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
      {showBackToTop ? (
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
              action={updateRestaurantFromRoot}
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
