'use client';

import Fuse from 'fuse.js';
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { createRestaurantFromRoot, moveRestaurantFromRoot, updateRestaurantFromRoot } from '@/app/actions';
import { buildCitySelectGroups, CitySelect } from '@/app/components/city-select';
import { DeleteRestaurantForm } from '@/app/components/delete-restaurant-form';
import { RestaurantFormFields, type RestaurantFormDefaults } from '@/app/components/restaurant-form-fields';
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
const viewModeStorageKey = 'publicEatsViewMode';
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

const readStoredViewMode = (): ViewMode => {
  if (typeof window === 'undefined') {
    return 'list';
  }

  try {
    return window.localStorage.getItem(viewModeStorageKey) === 'kanban' ? 'kanban' : 'list';
  } catch {
    return 'list';
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

const getCityGroupingHeading = (restaurant: Pick<PublicRestaurant, 'cityName' | 'countryName'>): string =>
  `${restaurant.cityName}, ${restaurant.countryName}`;

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

type ViewMode = 'list' | 'kanban';
type BoardCategory = 'city' | 'area' | 'type';
type BoardLane = {
  boardCategory: BoardCategory;
  id: string;
  label: string;
};
type BoardDropTarget = {
  laneId: string;
  status: RestaurantStatusFilter;
};
type DraggedBoardCard = {
  restaurantId: string;
  sourceLaneId: string;
  sourceStatus: RestaurantStatusFilter;
};

const unassignedAreaLaneId = '__unassigned-area__';
const unassignedAreaLaneLabel = 'No Area';
const silentBoardMoveErrorMessages = new Set([
  'A disliked reason is required to move a restaurant to Not Recommended.',
  'Notes are required.'
]);

const getBoardCategory = (category: CategoryFilter, isAllCitiesSelected: boolean): BoardCategory | null => {
  if (category === 'type') {
    return 'type';
  }

  if (category === 'area') {
    return isAllCitiesSelected ? 'city' : 'area';
  }

  return null;
};

const getPrimaryArea = (restaurant: PublicRestaurant): string | null => restaurant.areas[0]?.trim() ?? null;

const getPrimaryType = (restaurant: PublicRestaurant): RestaurantType | null => restaurant.types[0] ?? null;

const getRestaurantTypeSummary = (restaurant: PublicRestaurant): string =>
  restaurant.types.map((type) => `${type.emoji} ${type.name}`).join(', ');

const buildBoardLanes = (
  boardCategory: BoardCategory,
  restaurants: PublicRestaurant[]
): BoardLane[] => {
  if (boardCategory === 'city') {
    const lanes = new Map<string, BoardLane>();

    for (const restaurant of restaurants) {
      lanes.set(restaurant.cityId, {
        boardCategory,
        id: restaurant.cityId,
        label: restaurant.cityName
      });
    }

    return [...lanes.values()].sort((laneA, laneB) => byAlpha(laneA.label, laneB.label));
  }

  if (boardCategory === 'area') {
    const lanes = new Map<string, BoardLane>();
    let hasUnassignedLane = false;

    for (const restaurant of restaurants) {
      const primaryArea = getPrimaryArea(restaurant);
      if (!primaryArea) {
        hasUnassignedLane = true;
        continue;
      }

      lanes.set(primaryArea, {
        boardCategory,
        id: primaryArea,
        label: primaryArea
      });
    }

    const ordered = [...lanes.values()].sort((laneA, laneB) => byAlpha(laneA.label, laneB.label));
    if (hasUnassignedLane) {
      ordered.unshift({
        boardCategory,
        id: unassignedAreaLaneId,
        label: unassignedAreaLaneLabel
      });
    }

    return ordered;
  }

  const lanes = new Map<string, BoardLane>();
  for (const restaurant of restaurants) {
    const primaryType = getPrimaryType(restaurant);
    if (!primaryType) {
      continue;
    }

    lanes.set(primaryType.id, {
      boardCategory,
      id: primaryType.id,
      label: `${primaryType.emoji} ${primaryType.name}`
    });
  }

  return [...lanes.values()].sort((laneA, laneB) => byAlpha(laneA.label, laneB.label));
};

const getRestaurantBoardLaneId = (restaurant: PublicRestaurant, boardCategory: BoardCategory): string => {
  if (boardCategory === 'city') {
    return restaurant.cityId;
  }

  if (boardCategory === 'area') {
    return getPrimaryArea(restaurant) ?? unassignedAreaLaneId;
  }

  return getPrimaryType(restaurant)?.id ?? '';
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

type RestaurantCardRenderOptions = {
  draggable?: boolean;
  extraClassName?: string;
  keyPrefix: string;
  onDragEnd?: () => void;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  showCity: boolean;
  summaryText: string;
};

type BoardMoveResolution = {
  status: 'disliked';
  dislikedReason: string;
  notes?: never;
} | {
  status: 'liked' | 'untried';
  dislikedReason?: never;
  notes: string;
};

type BoardCreatePreset = {
  defaults: RestaurantFormDefaults;
  lockedFields: {
    areas?: boolean;
    city?: boolean;
    status?: boolean;
  };
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
  restaurants: initialRestaurants,
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
  const [restaurants, setRestaurants] = useState(initialRestaurants);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [boardErrorMessage, setBoardErrorMessage] = useState<string | null>(null);
  const [draggedBoardCard, setDraggedBoardCard] = useState<DraggedBoardCard | null>(null);
  const [boardDropTarget, setBoardDropTarget] = useState<BoardDropTarget | null>(null);
  const [isMovingBoardCard, startMovingBoardCardTransition] = useTransition();
  const triedCount = restaurants.filter((restaurant) => restaurant.status === 'liked').length;
  const untriedCount = restaurants.filter((restaurant) => restaurant.status === 'untried').length;
  const [hasInitializedFilters, setHasInitializedFilters] = useState(false);
  const skipNextExcludeReset = useRef(false);
  const skipNextExcludePrune = useRef(false);
  const hasExplicitCityQuery = useRef(false);
  const listStatusSelectionBeforeKanban = useRef<RestaurantStatusFilter[] | null>(null);
  const preservedIncludedHeadings = useRef<string[] | null>(null);
  const statusFilterSnapshot = useRef<{ preservedIncludedHeadings: string[] | null } | null>(null);

  const [selectedStatuses, setSelectedStatuses] = useState<RestaurantStatusFilter[]>(defaultRestaurantStatuses);
  const [selectedCity, setSelectedCity] = useState<string | null>('');
  const [selectedMealType, setSelectedMealType] = useState<string>('Any');
  const [category, setCategory] = useState<CategoryFilter>('area');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [compactCards, setCompactCards] = useState(false);
  const [collapsedKanbanLaneIds, setCollapsedKanbanLaneIds] = useState<Set<string>>(new Set());
  const [boardCreatePreset, setBoardCreatePreset] = useState<BoardCreatePreset | null>(null);
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

  useEffect(() => {
    setRestaurants(initialRestaurants);
  }, [initialRestaurants]);

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
    setViewMode(readStoredViewMode());

    const urlState = readUrlState();
    hasExplicitCityQuery.current = urlState.hasCityQuery;
    skipNextExcludeReset.current = urlState.excluded.length > 0;
    skipNextExcludePrune.current = urlState.excluded.length > 0;
    setSelectedStatuses(urlState.statuses);
    setSelectedCity(urlState.city === allCitiesUrlValue ? null : urlState.city);
    setSelectedMealType(urlState.mealType);
    setCategory(urlState.category);
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
    if (typeof window === 'undefined' || !hasInitializedFilters) {
      return;
    }

    try {
      window.localStorage.setItem(viewModeStorageKey, viewMode);
    } catch {
      // Ignore storage failures; view mode still works for the current page session.
    }
  }, [hasInitializedFilters, viewMode]);

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

  const toggleKanbanLaneCollapse = useCallback((laneId: string): void => {
    setCollapsedKanbanLaneIds((current) => {
      const next = new Set(current);

      if (next.has(laneId)) {
        next.delete(laneId);
      } else {
        next.add(laneId);
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
  const isCityGrouping = category === 'area' && isAllCitiesSelected;
  const categoryOptionAreaLabel = isAllCitiesSelected ? 'City' : 'Area';
  const filterEntityLabelPlural = isCityGrouping ? 'Cities' : 'Areas';
  const savedGroupCategoryLabel = isCityGrouping ? 'city' : 'area';

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
        if (isAllCitiesSelected || restaurant.areas.length === 0) {
          values.add(isAllCitiesSelected ? getCityGroupingHeading(restaurant) : (selectedCity ?? restaurant.cityName));
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
      description: 'Switch between list and kanban here. Compact cards also shows more places at once when you want a denser view.'
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
    setBoardCreatePreset(null);
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
        headingValues.push(
          ...(isAllCitiesSelected || restaurant.areas.length === 0
            ? [isAllCitiesSelected ? getCityGroupingHeading(restaurant) : (selectedCity ?? restaurant.cityName)]
            : restaurant.areas)
        );
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
  const boardCategory = useMemo(() => getBoardCategory(category, isAllCitiesSelected), [category, isAllCitiesSelected]);
  const boardRestaurants = useMemo(() => {
    if (isSearchActive) {
      return searchedRestaurants.filter((restaurant) => selectedStatuses.includes(restaurant.status));
    }

    if (!boardCategory) {
      const visibleIds = new Set<string>();
      for (const places of grouped.values()) {
        for (const place of places) {
          visibleIds.add(place.id);
        }
      }

      return mealFilteredRestaurants.filter((restaurant) => visibleIds.has(restaurant.id));
    }

    return mealFilteredRestaurants.filter((restaurant) => {
      if (boardCategory === 'city') {
        return !excluded.includes(getCityGroupingHeading(restaurant));
      }

      if (boardCategory === 'area') {
        const primaryArea = getPrimaryArea(restaurant);
        return primaryArea === null || !excluded.includes(primaryArea);
      }

      const primaryType = getPrimaryType(restaurant);
      return primaryType !== null && !excluded.includes(primaryType.name);
    });
  }, [boardCategory, excluded, grouped, isSearchActive, mealFilteredRestaurants, searchedRestaurants, selectedStatuses]);
  const boardLanes = useMemo(
    () => (boardCategory ? buildBoardLanes(boardCategory, boardRestaurants) : []),
    [boardCategory, boardRestaurants]
  );
  const visibleBoardStatuses = useMemo(
    () => restaurantStatusChoices.filter((status) => selectedStatuses.includes(status)),
    [selectedStatuses]
  );
  const boardGrouped = useMemo(() => {
    if (!boardCategory) {
      return new Map<string, Map<RestaurantStatusFilter, PublicRestaurant[]>>();
    }

    const map = new Map<string, Map<RestaurantStatusFilter, PublicRestaurant[]>>();
    for (const lane of boardLanes) {
      const laneStatuses = new Map<RestaurantStatusFilter, PublicRestaurant[]>();
      for (const status of restaurantStatusChoices) {
        laneStatuses.set(status, []);
      }
      map.set(lane.id, laneStatuses);
    }

    for (const restaurant of boardRestaurants) {
      const laneId = getRestaurantBoardLaneId(restaurant, boardCategory);
      if (!laneId) {
        continue;
      }

      const lane = map.get(laneId);
      if (!lane) {
        continue;
      }

      const current = lane.get(restaurant.status) ?? [];
      current.push(restaurant);
      lane.set(restaurant.status, current);
    }

    return map;
  }, [boardCategory, boardLanes, boardRestaurants]);
  const effectiveViewMode: ViewMode = viewMode === 'kanban' && boardCategory !== null ? 'kanban' : 'list';
  const kanbanGridStyle = useMemo((): CSSProperties => {
    const columnCount = Math.max(visibleBoardStatuses.length, 1);
    const minColumnWidth = 252;
    const minGridWidth = columnCount * minColumnWidth;

    return {
      gridTemplateColumns: `repeat(${columnCount}, minmax(240px, 1fr))`,
      width: `max(100%, ${minGridWidth}px)`
    };
  }, [visibleBoardStatuses.length]);

  useEffect(() => {
    setCollapsedKanbanLaneIds((current) => {
      const visibleLaneIds = new Set(boardLanes.map((lane) => lane.id));
      let hasChanged = false;
      const next = new Set<string>();

      for (const laneId of current) {
        if (visibleLaneIds.has(laneId)) {
          next.add(laneId);
        } else {
          hasChanged = true;
        }
      }

      return hasChanged ? next : current;
    });
  }, [boardLanes]);

  useEffect(() => {
    const areAllStatusesSelected = restaurantStatusChoices.every((status) => selectedStatuses.includes(status));

    if (effectiveViewMode === 'kanban') {
      if (listStatusSelectionBeforeKanban.current === null) {
        listStatusSelectionBeforeKanban.current = selectedStatuses;
      }

      if (!areAllStatusesSelected) {
        setSelectedStatuses([...restaurantStatusChoices]);
      }
      return;
    }

    if (listStatusSelectionBeforeKanban.current !== null) {
      const previousStatuses = listStatusSelectionBeforeKanban.current;
      listStatusSelectionBeforeKanban.current = null;
      setSelectedStatuses(previousStatuses);
    }
  }, [effectiveViewMode, selectedStatuses]);
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
    setBoardCreatePreset(null);
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
  const openBoardCreateDialog = useCallback(
    (lane: BoardLane, status: RestaurantStatusFilter): void => {
      if (!createTools) {
        return;
      }

      const defaults: RestaurantFormDefaults = {
        mealTypes: createDefaultMealTypes,
        status
      };
      const lockedFields: BoardCreatePreset['lockedFields'] = {
        status: true
      };

      if (boardCategory === 'city') {
        defaults.cityId = lane.id;
        lockedFields.city = true;
      } else if (createDefaultCityId) {
        defaults.cityId = createDefaultCityId;
        lockedFields.city = true;
      }

      if (boardCategory === 'area') {
        defaults.areas = lane.id === unassignedAreaLaneId ? [] : [lane.id];
        lockedFields.areas = true;
      }

      setBoardCreatePreset({
        defaults,
        lockedFields
      });
      setIsCreateDialogOpen(true);
    },
    [boardCategory, createDefaultCityId, createDefaultMealTypes, createTools]
  );
  const toggleSelectedStatus = (status: RestaurantStatusFilter, checked: boolean): void => {
    if (effectiveViewMode === 'kanban') {
      return;
    }

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
    setSelectedStatuses(getDefaultStatusesForCity(nextCity));
    statusFilterSnapshot.current = null;
    preservedIncludedHeadings.current = null;
  }, [getDefaultStatusesForCity]);
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
      `Save this ${activeFilterGroupCategory === 'area' ? savedGroupCategoryLabel : 'category'} group as:`
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
  }, [activeFilterGroupCategory, canSaveCurrentFilterGroup, currentFilterGroupSignature, savedGroupCategoryLabel, selectedCity]);
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
  const canMoveRestaurantsInBoard = canEditRestaurants && boardCategory !== null && !isSearchActive;
  const canDeleteRestaurants = Boolean(adminTools);

  const clearBoardDragState = useCallback((): void => {
    setDraggedBoardCard(null);
    setBoardDropTarget(null);
  }, []);
  const resolveBoardMove = useCallback(
    (restaurant: PublicRestaurant, { status }: BoardDropTarget): BoardMoveResolution => {
      if (status !== 'disliked') {
        const newNotes = window.prompt('New notes:', restaurant.notes)?.trim() ?? '';
        if (newNotes.length === 0) {
          throw new Error('Notes are required.');
        }

        return {
          status,
          notes: newNotes
        };
      }

      const existingReason = restaurant.dislikedReason?.trim() ?? '';
      if (existingReason.length > 0) {
        return {
          status,
          dislikedReason: existingReason
        };
      }

      const promptedReason = window.prompt(`Why is "${restaurant.name}" not recommended?`)?.trim() ?? '';
      if (promptedReason.length === 0) {
        throw new Error('A disliked reason is required to move a restaurant to Not Recommended.');
      }

      return {
        status,
        dislikedReason: promptedReason
      };
    },
    []
  );
  const buildMovedRestaurant = useCallback(
    (restaurant: PublicRestaurant, target: BoardDropTarget, move: BoardMoveResolution): PublicRestaurant => {
      if (!boardCategory) {
        return restaurant;
      }

      if (boardCategory === 'city') {
        const targetCity = adminTools?.cities.find((city) => city.id === target.laneId);
        if (!targetCity) {
          return restaurant;
        }

        return {
          ...restaurant,
          cityId: targetCity.id,
          cityName: targetCity.name,
          ...move.dislikedReason && {
            dislikedReason: move.dislikedReason,
          },
          ...move.notes && {
            notes: move.notes,
          },
          countryName: targetCity.countryName,
          status: target.status
        };
      }

      if (boardCategory === 'area') {
        const nextAreas = target.laneId === unassignedAreaLaneId
          ? restaurant.areas.filter((_, index) => index !== 0)
          : [target.laneId, ...restaurant.areas.filter((area, index) => index !== 0 && area !== target.laneId)];

        return {
          ...restaurant,
          areas: nextAreas,
          ...move.dislikedReason && {
            dislikedReason: move.dislikedReason,
          },
          ...move.notes && {
            notes: move.notes,
          },
          status: target.status
        };
      }

      const targetType = adminTools?.types.find((type) => type.id === target.laneId);
      if (!targetType) {
        return restaurant;
      }

      return {
        ...restaurant,
        ...move.dislikedReason && {
          dislikedReason: move.dislikedReason,
        },
        ...move.notes && {
          notes: move.notes,
        },
        status: target.status,
        types: [targetType, ...restaurant.types.filter((type, index) => index !== 0 && type.id !== targetType.id)]
      };
    },
    [adminTools, boardCategory]
  );
  const persistBoardMove = useCallback(
    async (restaurant: PublicRestaurant, target: BoardDropTarget, move: BoardMoveResolution): Promise<void> => {
      if (!boardCategory) {
        return;
      }

      const formData = new FormData();
      formData.set('restaurantId', restaurant.id);
      formData.set('status', target.status);
      formData.set('boardCategory', boardCategory);
      if (move.dislikedReason?.trim().length) {
        formData.set('dislikedReason', move.dislikedReason.trim());
      }

      if (boardCategory === 'city') {
        formData.set('targetCityId', target.laneId);
      } else if (boardCategory === 'area') {
        formData.set('targetArea', target.laneId === unassignedAreaLaneId ? '' : target.laneId);
      } else {
        formData.set('targetTypeId', target.laneId);
      }

      const result = await moveRestaurantFromRoot(formData);
      if (!result.success) {
        throw new Error(result.errorMessage ?? 'Could not move restaurant.');
      }
    },
    [boardCategory]
  );
  const handleBoardDrop = useCallback(
    (target: BoardDropTarget): void => {
      if (!draggedBoardCard || !canMoveRestaurantsInBoard) {
        return;
      }

      const restaurant = restaurants.find((entry) => entry.id === draggedBoardCard.restaurantId);
      if (!restaurant) {
        clearBoardDragState();
        return;
      }

      if (draggedBoardCard.sourceLaneId === target.laneId && draggedBoardCard.sourceStatus === target.status) {
        clearBoardDragState();
        return;
      }

      const previousRestaurants = restaurants;
      let move: BoardMoveResolution;
      try {
        move = resolveBoardMove(restaurant, target);
      } catch (error) {
        clearBoardDragState();
        if (error instanceof Error && !silentBoardMoveErrorMessages.has(error.message)) {
          setBoardErrorMessage(error.message);
        }
        return;
      }

      const optimisticRestaurant = buildMovedRestaurant(restaurant, target, move);

      setBoardErrorMessage(null);
      setRestaurants((current) =>
        current.map((entry) => (entry.id === restaurant.id ? optimisticRestaurant : entry))
      );
      clearBoardDragState();

      startMovingBoardCardTransition(() => {
        void persistBoardMove(restaurant, target, move).catch((error: unknown) => {
          setRestaurants(previousRestaurants);
          if (error instanceof Error && silentBoardMoveErrorMessages.has(error.message)) {
            return;
          }

          setBoardErrorMessage(error instanceof Error ? error.message : 'Could not move restaurant.');
        });
      });
    },
    [
      buildMovedRestaurant,
      canMoveRestaurantsInBoard,
      clearBoardDragState,
      draggedBoardCard,
      persistBoardMove,
      resolveBoardMove,
      restaurants
    ]
  );
  const showWalkthroughDebugTrigger = process.env.NODE_ENV !== 'production';
  const resolvedPrimaryColor = primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const resolvedSecondaryColor = secondaryColor ?? DEFAULT_SECONDARY_COLOR;
  const rootStyle = buildThemeCssVariables(resolvedPrimaryColor, resolvedSecondaryColor, 'theme') as CSSProperties;
  const renderRestaurantCard = useCallback(
    (place: PublicRestaurant, options: RestaurantCardRenderOptions) => {
      const compactDetailText = getRestaurantDetailText(place);
      const compactDetailId = `compact-detail-${options.keyPrefix}-${place.id}`;
      const isCompactDetailExpanded = expandedCompactCardIds.has(place.id);
      const showCompactCardActions = canEditRestaurants || canDeleteRestaurants;
      const canExpandCompactCard = compactCards && (compactDetailText.length > 0 || showCompactCardActions);

      return (
        <div
          className={`${styles.placeCard} ${compactCards ? styles.compactPlaceCard : ''} ${
            canExpandCompactCard ? styles.compactPlaceCardInteractive : ''
          } ${isCompactDetailExpanded ? styles.compactPlaceCardExpanded : ''} ${
            luckyRestaurantId === place.id ? styles.luckyCard : ''
          } ${options.extraClassName ?? ''} ${
            place.status === 'liked'
              ? styles.likedPlaceCard
              : place.status === 'disliked'
                ? styles.dislikedPlaceCard
                : styles.untriedPlaceCard
          }`}
          draggable={options.draggable}
          key={`${options.keyPrefix}-${place.id}`}
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
          onDragEnd={options.onDragEnd}
          onDragStart={options.onDragStart}
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
          {options.showCity ? (
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

          <span className={styles.areaOrType}>{options.summaryText}</span>

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
            <div className={`${styles.cardActions} ${options.draggable ? styles.boardCardActions : ''}`}>
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
    },
    [
      canDeleteRestaurants,
      canEditRestaurants,
      compactCards,
      expandedCompactCardIds,
      luckyRestaurantId,
      shouldIgnoreCompactCardToggle,
      toggleCompactCardExpansion
    ]
  );

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
                    <label htmlFor="category">{effectiveViewMode === 'kanban' ? 'Group By:' : 'Categorise By:'}</label>
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value as CategoryFilter)}
                    >
                      <option value="area">
                        {categoryOptionAreaLabel}
                      </option>
                      <option value="type">Type of Food</option>
                      {effectiveViewMode === 'list' ? <option value="recentlyAdded">Date Added</option> : null}
                    </select>
                  </div>
                </>
              ) : null}
              <div
                className={`${styles.sortingField} ${styles.viewModeGroup} ${
                  isSearchActive ? styles.viewModeGroupSearchOnly : ''
                }`}
                ref={compactFieldRef}
              >
                {!isSearchActive ? <label htmlFor="viewMode">View:</label> : null}
                <div className={styles.viewModeControls}>
                  {!isSearchActive ? (
                    <select
                      id="viewMode"
                      value={effectiveViewMode}
                      onChange={(event) => setViewMode(event.target.value as ViewMode)}
                    >
                      <option value="list">List</option>
                      {boardCategory !== null ? <option value="kanban">Kanban</option> : null}
                    </select>
                  ) : null}
                  <label className={styles.compactToggle}>
                    <input
                      type="checkbox"
                      checked={compactCards}
                      onChange={(event) => setCompactCards(event.target.checked)}
                    />
                    <span>Compact Cards</span>
                  </label>
                </div>
              </div>
              <div className={`${styles.sortingField} ${styles.statusFilterGroup}`} ref={statusFieldRef}>
                <span className={styles.statusFilterLabel}>Status:</span>
                <div className={styles.filtersContainer}>
                  <label className={`${styles.statusFilterChip} ${styles.untriedStatusFilterChip}`}>
                    <input
                      type="checkbox"
                      checked={effectiveViewMode === 'kanban' || selectedStatuses.includes('untried')}
                      disabled={effectiveViewMode === 'kanban' || statusCount('untried') === 0}
                      onChange={(event) => toggleSelectedStatus('untried', event.target.checked)}
                    />
                    <span>Want to Try ({statusCount('untried')})</span>
                  </label>
                  <label className={`${styles.statusFilterChip} ${styles.likedStatusFilterChip}`}>
                    <input
                      type="checkbox"
                      checked={effectiveViewMode === 'kanban' || selectedStatuses.includes('liked')}
                      disabled={effectiveViewMode === 'kanban' || statusCount('liked') === 0}
                      onChange={(event) => toggleSelectedStatus('liked', event.target.checked)}
                    />
                    <span>Recommended ({statusCount('liked')})</span>
                  </label>
                  <label className={`${styles.statusFilterChip} ${styles.dislikedStatusFilterChip}`}>
                    <input
                      type="checkbox"
                      checked={effectiveViewMode === 'kanban' || selectedStatuses.includes('disliked')}
                      disabled={effectiveViewMode === 'kanban' || statusCount('disliked') === 0}
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
                        {category === 'area' ? `Filter ${filterEntityLabelPlural}` : 'Filter Types'} ({filterButtonStateLabel})
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
            {boardErrorMessage ? <div className={styles.boardError}>{boardErrorMessage}</div> : null}
            {effectiveViewMode === 'kanban' && boardCategory !== null && !isSearchActive ? (
              <div className={styles.kanbanBoard}>
                {boardLanes.length === 0 ? (
                  <div className={styles.noResults}>{noResultsMessage}</div>
                ) : (
                  <>
                    {boardLanes.map((lane) => (
                      <div
                        className={styles.kanbanLaneGroup}
                        key={lane.id}
                      >
                        <div className={styles.kanbanLaneHeading}>
                          <button
                            type="button"
                            className={`${styles.kanbanLaneToggle} ${
                              collapsedKanbanLaneIds.has(lane.id) ? '' : styles.kanbanLaneToggleExpanded
                            }`}
                            aria-expanded={!collapsedKanbanLaneIds.has(lane.id)}
                            aria-controls={`kanban-lane-${lane.id}`}
                            onClick={() => {
                              toggleKanbanLaneCollapse(lane.id);
                            }}
                          >
                            {lane.label}
                          </button>
                          <span className={styles.kanbanLaneCount}>
                            {visibleBoardStatuses.reduce(
                              (count, status) => count + (boardGrouped.get(lane.id)?.get(status)?.length ?? 0),
                              0
                            )}{' '}
                            restaurants
                          </span>
                        </div>
                        {collapsedKanbanLaneIds.has(lane.id) ? null : (
                          <div className={styles.kanbanLaneBody}>
                            <div className={styles.kanbanLaneScroll} id={`kanban-lane-${lane.id}`}>
                              <div className={styles.kanbanLaneRow} style={kanbanGridStyle}>
                                {visibleBoardStatuses.map((status) => {
                                  const isActiveDropTarget =
                                    boardDropTarget?.laneId === lane.id && boardDropTarget.status === status;
                                  const places = boardGrouped.get(lane.id)?.get(status) ?? [];
                                  const laneCount = places.length;

                                  return (
                                    <div
                                      className={`${styles.kanbanCell} ${
                                        isActiveDropTarget ? styles.kanbanCellActive : ''
                                      }`}
                                      key={`${lane.id}-${status}`}
                                      onDragOver={(event) => {
                                        if (!canMoveRestaurantsInBoard) {
                                          return;
                                        }

                                        event.preventDefault();
                                        if (
                                          boardDropTarget?.laneId !== lane.id ||
                                          boardDropTarget.status !== status
                                        ) {
                                          setBoardDropTarget({
                                            laneId: lane.id,
                                            status
                                          });
                                        }
                                      }}
                                      onDragLeave={() => {
                                        if (boardDropTarget?.laneId === lane.id && boardDropTarget.status === status) {
                                          setBoardDropTarget(null);
                                        }
                                      }}
                                      onDrop={(event) => {
                                        event.preventDefault();
                                        handleBoardDrop({
                                          laneId: lane.id,
                                          status
                                        });
                                      }}
                                    >
                                      <div className={styles.kanbanColumnHeading}>
                                        <div className={styles.kanbanColumnHeadingContent}>
                                          <span className={styles.kanbanColumnHeadingLabel}>
                                            {status === 'liked'
                                              ? 'Recommended'
                                              : status === 'disliked'
                                                ? 'Not Recommended'
                                                : 'Want to Try'}
                                          </span>{' '}
                                          <span className={styles.kanbanColumnHeadingCount}>{laneCount}</span>
                                        </div>
                                        {createTools ? (
                                          <button
                                            type="button"
                                            className={styles.kanbanColumnAddButton}
                                            aria-label={`Add restaurant to ${lane.label} ${
                                              status === 'liked'
                                                ? 'Recommended'
                                                : status === 'disliked'
                                                  ? 'Not Recommended'
                                                  : 'Want to Try'
                                            }`}
                                            title="Add restaurant"
                                            onClick={() => {
                                              openBoardCreateDialog(lane, status);
                                            }}
                                          >
                                            +
                                          </button>
                                        ) : null}
                                      </div>
                                      {places
                                        .slice()
                                        .sort((a, b) => a.name.localeCompare(b.name))
                                        .map((place) =>
                                          renderRestaurantCard(place, {
                                            draggable: canMoveRestaurantsInBoard,
                                            extraClassName: `${styles.boardPlaceCard} ${
                                              draggedBoardCard?.restaurantId === place.id ? styles.boardPlaceCardDragging : ''
                                            }`,
                                            keyPrefix: `board-${lane.id}-${status}`,
                                            onDragEnd: clearBoardDragState,
                                            onDragStart: (event) => {
                                              if (!canMoveRestaurantsInBoard) {
                                                return;
                                              }

                                              event.dataTransfer.effectAllowed = 'move';
                                              setBoardErrorMessage(null);
                                              setDraggedBoardCard({
                                                restaurantId: place.id,
                                                sourceLaneId: lane.id,
                                                sourceStatus: status
                                              });
                                            },
                                            showCity: isAllCitiesSelected && boardCategory !== 'city',
                                            summaryText:
                                              boardCategory === 'type'
                                                ? place.areas.join(', ')
                                                : getRestaurantTypeSummary(place)
                                          })
                                        )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
                {isMovingBoardCard ? <div className={styles.boardSavingState}>Saving board move…</div> : null}
              </div>
            ) : (
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
                          .map((place) =>
                            renderRestaurantCard(place, {
                              keyPrefix: heading,
                              showCity: isAllCitiesSelected && !isCityGrouping,
                              summaryText: `${
                                category === 'type' && !searchQuery
                                  ? place.areas.join(', ')
                                  : (category === 'recentlyAdded' || searchQuery)
                                    ? `${place.types.map((type) => `${type.emoji} ${type.name}`).join(', ')}${
                                        place.areas.length > 0 ? ` • ${place.areas.join(', ')}` : ''
                                      }`
                                    : place.types.map((type) => `${type.emoji} ${type.name}`).join(', ')
                              }${
                                selectedMealType === 'Any' && !compactCards
                                  ? ` (${place.mealTypes.map((meal) => mealLabel(meal)).join(', ')})`
                                  : ''
                              }`
                            })
                          )}
                      </div>
                    </Fragment>
                  ))
                )}
              </div>
            )}
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
            onClick={() => {
              setBoardCreatePreset(null);
              setIsCreateDialogOpen(true);
            }}
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
                      cityId: boardCreatePreset?.defaults.cityId ?? createDefaultCityId,
                      areas: boardCreatePreset?.defaults.areas,
                      mealTypes: boardCreatePreset?.defaults.mealTypes ?? createDefaultMealTypes,
                      status: boardCreatePreset?.defaults.status ?? createDefaultStatus
                    }}
                    lockedFields={boardCreatePreset?.lockedFields}
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
