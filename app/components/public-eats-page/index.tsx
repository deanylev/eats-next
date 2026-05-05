'use client';

import { MarkerClusterer } from '@googlemaps/markerclusterer';
import Fuse from 'fuse.js';
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import type { CSSProperties, DragEvent, FormEvent } from 'react';
import { moveRestaurantFromRoot, updateRestaurantFromRoot } from '@/app/actions';
import { buildCitySelectGroups, CitySelect } from '@/app/components/city-select';
import { DeleteRestaurantForm } from '@/app/components/delete-restaurant-form';
import { RestaurantFormFields, type RestaurantFormDefaults } from '@/app/components/restaurant-form-fields';
import {
  byAlpha,
  confettiPieceIndexes,
  defaultRestaurantStatuses,
  getFeelingLuckyCandidateIds,
  getIncludedRestaurantAreaLaneIds,
  getPrimaryArea,
  getPrimaryMealType,
  getPreservedIncludedHeadings,
  getMonthHeadingKey,
  getMonthHeadingLabel,
  isUrl,
  mealLabel,
  readUrlState,
  reconcileExcludedAfterStatusChange,
  showFeelingLuckyForStatuses,
  unassignedAreaLaneId,
  type CategoryFilter,
  type RestaurantStatusFilter
} from '@/app/components/public-eats-page/utils';
import { buildAreaSuggestionsByCity } from '@/lib/area-suggestions';
import { clearFlashCookieClient, flashCookieNames } from '@/lib/flash-cookies';
import { buildThemeCssVariables, DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from '@/lib/theme';
import { isGoogleMapsUrl } from '@/lib/url';

import styles from './style.module.scss';
import { LocationBackfillDebugForm } from './location-backfill-debug-form';

const restaurantStatusChoices: RestaurantStatusFilter[] = ['untried', 'liked', 'disliked'];
const allCitiesUrlValue = 'all';
const compactCardsStorageKey = 'publicEatsCompactCards';
const categoryStorageKey = 'publicEatsCategory';
const cityStorageKey = 'publicEatsCity';
const viewModeStorageKey = 'publicEatsViewMode';
const mapLabelModeStorageKey = 'publicEatsMapLabelMode';
const controlsWalkthroughStorageKey = 'publicEatsControlsWalkthroughSeen';
const savedFilterGroupsStorageKey = 'publicEatsSavedFilterGroups';
const minimumUpwardFilterPopoverListHeight = 160;
const filterPopoverOffset = 20;
const defaultUserLocationMapZoom = 15;
const newRestaurantQueryParam = 'newRestaurant';
const newRestaurantHighlightDurationMs = 4200;

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
    const stored = window.localStorage.getItem(viewModeStorageKey);
    return stored === 'kanban' || stored === 'map' ? stored : 'list';
  } catch {
    return 'list';
  }
};

const readStoredCategory = (): CategoryFilter | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(categoryStorageKey);
    return stored === 'area' || stored === 'type' || stored === 'recentlyAdded' || stored === 'distance'
      ? stored
      : null;
  } catch {
    return null;
  }
};

const readStoredCity = (): string | null | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const stored = window.localStorage.getItem(cityStorageKey);
    if (stored === null) {
      return undefined;
    }

    return stored === allCitiesUrlValue ? null : stored;
  } catch {
    return undefined;
  }
};

type MapLabelMode = 'emoji' | 'emojiName' | 'none';

const readStoredMapLabelMode = (): MapLabelMode => {
  if (typeof window === 'undefined') {
    return 'emojiName';
  }

  try {
    const stored = window.localStorage.getItem(mapLabelModeStorageKey);
    return stored === 'emojiName' || stored === 'none' || stored === 'emoji' ? stored : 'emojiName';
  } catch {
    return 'emojiName';
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
  googlePlaceId: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string | Date;
  status: 'untried' | 'liked' | 'disliked';
  dislikedReason: string | null;
  areas: string[];
  mealTypes: string[];
  types: RestaurantType[];
  locations: RestaurantLocation[];
};

type RestaurantLocation = {
  id: string;
  label: string | null;
  address: string | null;
  googlePlaceId: string | null;
  googleMapsUrl: string | null;
  latitude: number;
  longitude: number;
};

type RestaurantLocationPin = {
  id: string;
  restaurant: PublicRestaurant;
  location: RestaurantLocation;
};

type ViewMode = 'list' | 'kanban' | 'map';
type MapClusterStatusCounts = Record<PublicRestaurant['status'], number>;
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
type UserLocation = {
  latitude: number;
  longitude: number;
};
type UserLocationFocusMode = 'always' | 'visible-area';
type GoogleMapsWindow = Window & {
  google?: any;
  initEatsGoogleMap?: () => void;
};

const unassignedAreaLaneLabel = 'No Area';
const silentBoardMoveErrorMessages = new Set([
  'A disliked reason is required to move a restaurant to Not Recommended.',
  'Notes are required.'
]);

const canBackfillRestaurantLocation = (restaurant: PublicRestaurant): boolean =>
  isGoogleMapsUrl(restaurant.url) &&
  restaurant.locations.length === 0;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const getBoardCategory = (category: CategoryFilter, isAllCitiesSelected: boolean): BoardCategory | null => {
  if (category === 'type') {
    return 'type';
  }

  if (category === 'area') {
    return isAllCitiesSelected ? 'city' : 'area';
  }

  return null;
};

const getPrimaryType = (restaurant: PublicRestaurant): RestaurantType | null => restaurant.types[0] ?? null;

const getRestaurantTypeSummary = (restaurant: PublicRestaurant): string =>
  restaurant.types.map((type) => `${type.emoji} ${type.name}`).join(', ');

const updateRestaurantCardPointerTint = (element: HTMLDivElement, clientX: number, clientY: number): void => {
  const bounds = element.getBoundingClientRect();
  const pointerX = clientX - bounds.left;
  const pointerY = clientY - bounds.top;

  element.style.setProperty('--card-pointer-x', `${pointerX.toFixed(1)}px`);
  element.style.setProperty('--card-pointer-y', `${pointerY.toFixed(1)}px`);
  element.style.setProperty('--card-pointer-opacity', '1');
};

const clearRestaurantCardPointerTint = (element: HTMLDivElement): void => {
  element.style.setProperty('--card-pointer-opacity', '0');
};

const buildBoardLanes = (
  boardCategory: BoardCategory,
  restaurants: PublicRestaurant[],
  excluded: string[] = []
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
      const areaLaneIds = getIncludedRestaurantAreaLaneIds(restaurant, excluded);
      if (areaLaneIds.includes(unassignedAreaLaneId)) {
        hasUnassignedLane = true;
      }

      for (const area of areaLaneIds) {
        if (area === unassignedAreaLaneId) {
          continue;
        }

        lanes.set(area, {
          boardCategory,
          id: area,
          label: area
        });
      }
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

const getRestaurantBoardLaneIds = (
  restaurant: PublicRestaurant,
  boardCategory: BoardCategory,
  excluded: string[] = []
): string[] => {
  if (boardCategory === 'area') {
    return getIncludedRestaurantAreaLaneIds(restaurant, excluded);
  }

  const laneId = getRestaurantBoardLaneId(restaurant, boardCategory);
  return laneId ? [laneId] : [];
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
  distanceText?: string | null;
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

const getRestaurantStatusLabel = (status: PublicRestaurant['status']): string => {
  if (status === 'liked') {
    return 'Recommended';
  }

  if (status === 'disliked') {
    return 'Not Recommended';
  }

  return 'Want to Try';
};

const renderMapInfoRow = (label: string, value: string): string => {
  if (!value.trim()) {
    return '';
  }

  return `<div style="display:flex;gap:8px;margin-top:7px;">
    <span style="color:#6b7280;flex:0 0 58px;font-size:12px;font-weight:700;">${escapeHtml(label)}</span>
    <span style="color:#374151;font-size:12px;line-height:1.35;min-width:0;overflow-wrap:anywhere;">${escapeHtml(value)}</span>
  </div>`;
};

const renderMapInfoUrlRow = (label: string, value: string): string => {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '';
  }

  try {
    const url = new URL(trimmedValue);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return renderMapInfoRow(label, trimmedValue);
    }

    return `<div style="display:flex;gap:8px;margin-top:7px;">
      <span style="color:#6b7280;flex:0 0 96px;font-size:12px;font-weight:700;">${escapeHtml(label)}</span>
      <a style="font-size:12px;line-height:1.35;min-width:0;overflow-wrap:anywhere;" href="${escapeHtml(url.toString())}" target="_blank" rel="noreferrer">Click here</a>
    </div>`;
  } catch {
    return renderMapInfoRow(label, trimmedValue);
  }
};

const getRestaurantMapMarkerColors = (
  status: PublicRestaurant['status'],
  themeSecondaryColor: string
): { fill: string; stroke: string } => {
  if (status === 'liked') {
    return { fill: '#28a65d', stroke: '#17653a' };
  }

  if (status === 'disliked') {
    return { fill: '#e13f36', stroke: '#8f221c' };
  }

  return { fill: themeSecondaryColor, stroke: '#17131c' };
};

const buildRestaurantMapMarkerIcon = (
  status: PublicRestaurant['status'],
  themeSecondaryColor: string,
  themePrimaryColor: string,
  chainLocationCount: number,
  isChainHighlighted: boolean,
  isSelected: boolean
): string => {
  const colors = getRestaurantMapMarkerColors(status, themeSecondaryColor);
  const markerPath = 'M19 56C16 49 4 37 4 23C4 14.716 10.716 8 19 8C27.284 8 34 14.716 34 23C34 37 22 49 19 56Z';
  const markerHaloTransform = 'translate(19 32) scale(1.18) translate(-19 -32)';
  const selectedRing = isSelected
    ? `<g>
        <path d="${markerPath}" fill="none" stroke="#fff" stroke-opacity="0.96" stroke-linejoin="round" stroke-width="8" transform="${markerHaloTransform}" />
        <path d="${markerPath}" fill="none" stroke="${themePrimaryColor}" stroke-opacity="0.86" stroke-linejoin="round" stroke-width="4" transform="${markerHaloTransform}" />
      </g>`
    : '';
  const chainBadge = chainLocationCount > 1
    ? `<g>
        <circle cx="34" cy="12" r="10" fill="#111827" stroke="#fff" stroke-width="3" />
        <text x="34" y="16" fill="#fff" font-family="Arial, sans-serif" font-size="${chainLocationCount > 99 ? '8' : '10'}" font-weight="700" text-anchor="middle">${chainLocationCount > 99 ? '99+' : chainLocationCount}</text>
      </g>`
    : '';
  const highlightRing = isChainHighlighted && !isSelected
    ? `<g>
        <path d="${markerPath}" fill="none" stroke="#fff" stroke-opacity="0.9" stroke-linejoin="round" stroke-width="7" transform="${markerHaloTransform}" />
        <path d="${markerPath}" fill="none" stroke="${themePrimaryColor}" stroke-opacity="0.66" stroke-linejoin="round" stroke-width="3" transform="${markerHaloTransform}" />
      </g>`
    : '';

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="62" viewBox="0 0 50 62">
      ${selectedRing}
      ${highlightRing}
      <path d="${markerPath}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="3" />
      <circle cx="19" cy="23" r="7" fill="#fff" fill-opacity="0.92" />
      ${chainBadge}
    </svg>`
  )}`;
};

const buildRestaurantMapClusterIcon = (
  count: number,
  statusCounts: MapClusterStatusCounts,
  themeSecondaryColor: string,
  themePrimaryColor: string
): string => {
  const label = count > 99 ? '99+' : count.toString();
  const statusOrder: PublicRestaurant['status'][] = ['liked', 'disliked', 'untried'];
  const dominantStatus = statusOrder.reduce(
    (currentDominant, status) =>
      statusCounts[status] > statusCounts[currentDominant] ? status : currentDominant,
    'untried'
  );
  const dominantColor = getRestaurantMapMarkerColors(dominantStatus, themeSecondaryColor).fill;
  let segmentOffset = 0;
  const statusSegments = statusOrder
    .map((status) => {
      const statusCount = statusCounts[status];
      if (statusCount === 0) {
        return '';
      }

      const segmentSize = (statusCount / count) * 100;
      const segment = `<circle cx="29" cy="29" r="25" fill="none" stroke="${getRestaurantMapMarkerColors(status, themeSecondaryColor).fill}" stroke-width="7" pathLength="100" stroke-dasharray="${segmentSize.toFixed(3)} ${(100 - segmentSize).toFixed(3)}" stroke-dashoffset="${(-segmentOffset).toFixed(3)}" transform="rotate(-90 29 29)" />`;
      segmentOffset += segmentSize;
      return segment;
    })
    .join('');

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="58" viewBox="0 0 58 58">
      <circle cx="29" cy="29" r="27" fill="${themePrimaryColor}" fill-opacity="0.16" />
      <circle cx="29" cy="29" r="25" fill="none" stroke="#fff" stroke-width="9" />
      ${statusSegments}
      <circle cx="29" cy="29" r="19" fill="${dominantColor}" stroke="#111827" stroke-width="3" />
      <text x="29" y="34" fill="#111827" font-family="Arial, sans-serif" font-size="${count > 99 ? '13' : '15'}" font-weight="800" text-anchor="middle">${label}</text>
    </svg>`
  )}`;
};

const buildUserLocationMapMarkerIcon = (): string =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="13" fill="#3b82f6" fill-opacity="0.18" />
      <circle cx="15" cy="15" r="8" fill="#3b82f6" stroke="#fff" stroke-width="3" />
    </svg>`
  )}`;

const getRestaurantMapLabel = (restaurant: PublicRestaurant, mode: MapLabelMode): string | null => {
  if (mode === 'none') {
    return null;
  }

  const emoji = restaurant.types[0]?.emoji.trim() ?? '';
  if (mode === 'emoji') {
    return emoji || null;
  }

  return [emoji, restaurant.name].filter(Boolean).join(' ');
};

const getDistanceInKm = (
  first: { latitude: number; longitude: number },
  second: { latitude: number; longitude: number }
): number => {
  const earthRadiusKm = 6371;
  const toRadians = (degrees: number): number => degrees * (Math.PI / 180);
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const getRestaurantDistanceInKm = (restaurant: PublicRestaurant, userLocation: UserLocation | null): number | null => {
  if (!userLocation) {
    return null;
  }

  const coordinates = restaurant.locations.length > 0
    ? restaurant.locations.map((location) => ({
        latitude: location.latitude,
        longitude: location.longitude
      }))
    : typeof restaurant.latitude === 'number' && typeof restaurant.longitude === 'number'
      ? [{
          latitude: restaurant.latitude,
          longitude: restaurant.longitude
        }]
      : [];

  if (coordinates.length === 0) {
    return null;
  }

  return Math.min(...coordinates.map((coordinate) => getDistanceInKm(userLocation, coordinate)));
};

const formatDistance = (distanceInKm: number | null): string | null => {
  if (distanceInKm === null || !Number.isFinite(distanceInKm)) {
    return null;
  }

  if (distanceInKm < 1) {
    return `${Math.max(1, Math.round(distanceInKm * 1000))} m away`;
  }

  return `${distanceInKm.toFixed(distanceInKm < 10 ? 1 : 0)} km away`;
};

const distanceHeadingOrder = [
  'Under 1 km',
  '1-5 km',
  '5-10 km',
  '10-25 km',
  '25-50 km',
  '50+ km',
  'Unknown distance'
];

const getDistanceHeading = (distanceInKm: number | null): string => {
  if (distanceInKm === null || !Number.isFinite(distanceInKm)) {
    return 'Unknown distance';
  }

  if (distanceInKm < 1) {
    return 'Under 1 km';
  }

  if (distanceInKm < 5) {
    return '1-5 km';
  }

  if (distanceInKm < 10) {
    return '5-10 km';
  }

  if (distanceInKm < 25) {
    return '10-25 km';
  }

  if (distanceInKm < 50) {
    return '25-50 km';
  }

  return '50+ km';
};

const sortDistanceHeadings = (headings: string[]): string[] =>
  headings.sort((headingA, headingB) => {
    const indexA = distanceHeadingOrder.indexOf(headingA);
    const indexB = distanceHeadingOrder.indexOf(headingB);

    return (indexA === -1 ? Number.MAX_SAFE_INTEGER : indexA)
      - (indexB === -1 ? Number.MAX_SAFE_INTEGER : indexB);
  });

const latitudeToMercator = (latitude: number): number => {
  const sinLatitude = Math.sin(latitude * Math.PI / 180);
  return 0.5 - Math.log((1 + sinLatitude) / (1 - sinLatitude)) / (4 * Math.PI);
};

const mercatorToLatitude = (mercatorY: number): number =>
  (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * mercatorY)));

const isMappedRestaurantWithinUserMapBounds = (
  userLocation: UserLocation,
  mappedPins: RestaurantLocationPin[],
  mapSize: { width: number; height: number }
): boolean => {
  if (mapSize.width <= 0 || mapSize.height <= 0) {
    return false;
  }

  const worldPixelSize = 256 * 2 ** defaultUserLocationMapZoom;
  const longitudeDegreesPerPixel = 360 / worldPixelSize;
  const longitudeDelta = (mapSize.width / 2) * longitudeDegreesPerPixel;
  const mercatorDelta = mapSize.height / (2 * worldPixelSize);
  const userMercatorY = latitudeToMercator(userLocation.latitude);
  const northLatitude = mercatorToLatitude(userMercatorY - mercatorDelta);
  const southLatitude = mercatorToLatitude(userMercatorY + mercatorDelta);
  const westLongitude = userLocation.longitude - longitudeDelta;
  const eastLongitude = userLocation.longitude + longitudeDelta;

  return mappedPins.some((pin) =>
    pin.location.latitude >= southLatitude &&
    pin.location.latitude <= northLatitude &&
    pin.location.longitude >= westLongitude &&
    pin.location.longitude <= eastLongitude
  );
};

type Props = {
  restaurants: PublicRestaurant[];
  defaultCityName?: string | null;
  showAdminButton?: boolean;
  title?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  googleMapsBrowserApiKey?: string;
  allowRestaurantEditing?: boolean;
  adminTools?: {
    countries: Array<{ id: string; name: string }>;
    cities: Array<{ id: string; name: string; countryId: string; countryName: string }>;
    types: Array<{ id: string; name: string; emoji: string }>;
    areaSuggestionsByCity?: Record<string, string[]>;
  };
  createTools?: {
    countries: Array<{ id: string; name: string }>;
    cities: Array<{ id: string; name: string; countryId: string; countryName: string }>;
    types: Array<{ id: string; name: string; emoji: string }>;
  };
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
  googleMapsBrowserApiKey = '',
  allowRestaurantEditing = true,
  adminTools,
  createTools,
  openCreateDialogByDefault = false,
  rootEditErrorMessage = null,
  rootEditSuccessMessage = null,
  rootDeleteErrorMessage = null,
  openEditRestaurantId
}: Props) {
  const router = useRouter();
  const resolvedPrimaryColor = primaryColor ?? DEFAULT_PRIMARY_COLOR;
  const resolvedSecondaryColor = secondaryColor ?? DEFAULT_SECONDARY_COLOR;
  const rootStyle = buildThemeCssVariables(resolvedPrimaryColor, resolvedSecondaryColor, 'theme') as CSSProperties;
  const [restaurants, setRestaurants] = useState(initialRestaurants);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [boardErrorMessage, setBoardErrorMessage] = useState<string | null>(null);
  const [draggedBoardCard, setDraggedBoardCard] = useState<DraggedBoardCard | null>(null);
  const [boardDropTarget, setBoardDropTarget] = useState<BoardDropTarget | null>(null);
  const [isMovingBoardCard, startMovingBoardCardTransition] = useTransition();
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [isLocatingUser, setIsLocatingUser] = useState(false);
  const [locationErrorMessage, setLocationErrorMessage] = useState<string | null>(null);
  const [mapLoadErrorMessage, setMapLoadErrorMessage] = useState<string | null>(null);
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
  const [resultsMotionKey, setResultsMotionKey] = useState(0);
  const [compactCards, setCompactCards] = useState(false);
  const [mapLabelMode, setMapLabelMode] = useState<MapLabelMode>('emojiName');
  const [collapsedKanbanLaneIds, setCollapsedKanbanLaneIds] = useState<Set<string>>(new Set());
  const [boardCreatePreset, setBoardCreatePreset] = useState<BoardCreatePreset | null>(null);
  const [savedFilterGroups, setSavedFilterGroups] = useState<SavedFilterGroup[]>(readStoredFilterGroups);
  const [expandedCompactCardIds, setExpandedCompactCardIds] = useState<Set<string>>(new Set());
  const [isControlsWalkthroughOpen, setIsControlsWalkthroughOpen] = useState(false);
  const [controlsWalkthroughStepIndex, setControlsWalkthroughStepIndex] = useState(0);
  const [controlsWalkthroughSpotlightRect, setControlsWalkthroughSpotlightRect] = useState<SpotlightRect | null>(null);
  const [controlsWalkthroughCardPosition, setControlsWalkthroughCardPosition] = useState<WalkthroughCardPosition | null>(null);
  const [luckyRestaurantId, setLuckyRestaurantId] = useState<string | null>(null);
  const [activeLuckyConfettiId, setActiveLuckyConfettiId] = useState<string | null>(null);
  const [luckyRunCount, setLuckyRunCount] = useState(0);
  const [pendingNewRestaurantId, setPendingNewRestaurantId] = useState<string | null>(null);
  const [highlightedRestaurantId, setHighlightedRestaurantId] = useState<string | null>(null);
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
  const [filterPopoverDirection, setFilterPopoverDirection] = useState<'up' | 'down'>('up');
  const [filterPopoverMaxHeight, setFilterPopoverMaxHeight] = useState<number | null>(null);
  const [filterPopoverListMaxHeight, setFilterPopoverListMaxHeight] = useState<number | null>(null);
  const [isSearchPopoverOpen, setIsSearchPopoverOpen] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(openCreateDialogByDefault);
  const [createDialogHasUnsavedChanges, setCreateDialogHasUnsavedChanges] = useState(false);
  const [createErrorMessage, setCreateErrorMessage] = useState<string | null>(null);
  const [isCreatingRestaurant, setIsCreatingRestaurant] = useState(false);
  const [editingRestaurantId, setEditingRestaurantId] = useState<string | null>(openEditRestaurantId ?? null);
  const [editDialogHasUnsavedChanges, setEditDialogHasUnsavedChanges] = useState(false);
  const [isSavingEditRestaurant, setIsSavingEditRestaurant] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const restaurantCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const cityFieldRef = useRef<HTMLDivElement | null>(null);
  const compactFieldRef = useRef<HTMLDivElement | null>(null);
  const statusFieldRef = useRef<HTMLDivElement | null>(null);
  const previousResultsMotionSignature = useRef<string | null>(null);
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
  const googleMapContainerRef = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<any>(null);
  const googleMarkerClustererRef = useRef<MarkerClusterer | null>(null);
  const googleMarkersRef = useRef<any[]>([]);
  const googleMarkerStatusByMarkerRef = useRef<WeakMap<object, PublicRestaurant['status']>>(new WeakMap());
  const googleMarkersByPinIdRef = useRef<Map<string, any>>(new Map());
  const googleMarkerOpenersByPinIdRef = useRef<Map<string, () => void>>(new Map());
  const googleMarkerMetadataByPinIdRef = useRef<Map<string, { restaurantId: string; status: PublicRestaurant['status']; chainLocationCount: number }>>(new Map());
  const selectedMapRestaurantIdRef = useRef<string | null>(null);
  const selectedMapPinIdRef = useRef<string | null>(null);
  const googleUserMarkerRef = useRef<any>(null);
  const pendingMapRestaurantFocusIdRef = useRef<string | null>(null);
  const pendingMapPinFocusIdRef = useRef<string | null>(null);
  const shouldFocusUserLocationRef = useRef(false);
  const userLocationFocusModeRef = useRef<UserLocationFocusMode>('always');
  const autoRequestedLocationContextRef = useRef<string | null>(null);
  const filtersReady = hasInitializedFilters;

  const clearNewRestaurantQueryParam = useCallback((): void => {
    if (typeof window === 'undefined') {
      return;
    }

    const url = new URL(window.location.href);
    if (!url.searchParams.has(newRestaurantQueryParam)) {
      return;
    }

    url.searchParams.delete(newRestaurantQueryParam);
    const query = url.searchParams.toString();
    const nextUrl = `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
    window.history.replaceState(null, '', nextUrl);
  }, []);

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
    setMapLabelMode(readStoredMapLabelMode());
    setViewMode(readStoredViewMode());

    const urlState = readUrlState();
    const storedCity = readStoredCity();
    const storedCategory = readStoredCategory();
    const initialCity = urlState.hasCityQuery
      ? urlState.city === allCitiesUrlValue ? null : urlState.city
      : storedCity !== undefined ? storedCity : urlState.city;
    hasExplicitCityQuery.current = urlState.hasCityQuery;
    skipNextExcludeReset.current = urlState.excluded.length > 0;
    skipNextExcludePrune.current = urlState.excluded.length > 0;
    setSelectedStatuses(urlState.statuses);
    setSelectedCity(initialCity);
    setSelectedMealType(urlState.mealType);
    setCategory(urlState.hasCategoryQuery ? urlState.category : storedCategory ?? urlState.category);
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
      window.localStorage.setItem(categoryStorageKey, category);
    } catch {
      // Ignore storage failures; arrange-by still works for the current page session.
    }
  }, [category, hasInitializedFilters]);

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
      window.localStorage.setItem(mapLabelModeStorageKey, mapLabelMode);
    } catch {
      // Ignore storage failures; map label mode still works for the current page session.
    }
  }, [hasInitializedFilters, mapLabelMode]);

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
  const hasResolvedCitySelection = isAllCitiesSelected || selectedCity.trim().length > 0;
  const filterCategory: CategoryFilter = viewMode === 'map' ? 'type' : category;
  const isCityGrouping = filterCategory === 'area' && isAllCitiesSelected;
  const categoryOptionAreaLabel = isAllCitiesSelected ? 'City' : 'Area';
  const filterEntityLabelPlural = isCityGrouping ? 'Cities' : 'Areas';
  const savedGroupCategoryLabel = isCityGrouping ? 'city' : 'area';

  useEffect(() => {
    if (typeof window === 'undefined' || !hasInitializedFilters || !hasResolvedCitySelection) {
      return;
    }

    try {
      window.localStorage.setItem(cityStorageKey, selectedCity === null ? allCitiesUrlValue : selectedCity);
    } catch {
      // Ignore storage failures; city selection still works for the current page session.
    }
  }, [hasInitializedFilters, hasResolvedCitySelection, selectedCity]);

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

    if (filterCategory === 'distance') {
      if (!userLocation) {
        return ['Nearest to you'];
      }

      for (const restaurant of mealFilteredRestaurants) {
        values.add(getDistanceHeading(getRestaurantDistanceInKm(restaurant, userLocation)));
      }

      return sortDistanceHeadings([...values]);
    }

    for (const restaurant of mealFilteredRestaurants) {
      if (filterCategory === 'area') {
        if (isAllCitiesSelected || restaurant.areas.length === 0) {
          values.add(isAllCitiesSelected ? getCityGroupingHeading(restaurant) : (selectedCity ?? restaurant.cityName));
        } else {
          for (const area of restaurant.areas) {
            values.add(area);
          }
        }
      }

      if (filterCategory === 'type') {
        for (const type of restaurant.types) {
          values.add(type.name);
        }
      }

      if (filterCategory === 'recentlyAdded') {
        values.add(getMonthHeadingKey(restaurant.createdAt));
      }
    }

    const headingList = [...values];
    if (filterCategory === 'recentlyAdded') {
      return headingList.sort((a, b) => b.localeCompare(a));
    }

    return headingList.sort((a, b) => byAlpha(a, b));
  }, [filterCategory, isAllCitiesSelected, mealFilteredRestaurants, selectedCity, userLocation]);

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

    if (filterCategory !== 'recentlyAdded' && filterCategory !== 'distance' && headings.length > 1) {
      steps.push({
        id: 'filters',
        title: 'Narrow it down',
        description: 'Filter by area or cuisine here. You can also save a combination if you want to reuse it.'
      });
    }

    steps.push({
      id: 'compact',
      title: 'Choose your view',
      description: 'Switch between list, map, and kanban here when available. Compact cards also shows more places at once when you want a denser view.'
    });

    steps.push({
      id: 'search',
      title: 'Search by name',
      description: 'If you already have a place in mind, use search to jump straight to it.'
    });

    return steps;
  }, [filterCategory, defaultCityName, hasMultipleCities, hasMultipleCountries, headings.length, isSearchActive, onlyCountryName]);

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

    if (filterCategory === 'recentlyAdded' || filterCategory === 'distance') {
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
  }, [filterCategory, hasInitializedFilters, headings, selectedCity]);

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
  }, [filterCategory, hasInitializedFilters, selectedCity]);

  useEffect(() => {
    if (filterCategory === 'recentlyAdded' || filterCategory === 'distance') {
      setIsFilterPopoverOpen(false);
      setFilterPopoverDirection('up');
    }
  }, [filterCategory]);

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

    setCreateErrorMessage(null);
    setIsCreatingRestaurant(false);
    setCreateDialogHasUnsavedChanges(false);
    setBoardCreatePreset(null);
    setIsCreateDialogOpen(false);
  }, [createDialogHasUnsavedChanges]);
  const handleCreateRestaurantSubmit = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (isCreatingRestaurant) {
      return;
    }

    setCreateErrorMessage(null);
    setIsCreatingRestaurant(true);

    try {
      const formData = new FormData(event.currentTarget);
      const response = await fetch('/api/restaurants', {
        method: 'POST',
        body: formData
      });
      const result = (await response.json()) as { error?: string; restaurantId?: string };

      if (!response.ok || !result.restaurantId) {
        throw new Error(result.error ?? 'Could not create restaurant.');
      }

      setCreateDialogHasUnsavedChanges(false);
      setBoardCreatePreset(null);
      setIsCreateDialogOpen(false);
      setPendingNewRestaurantId(result.restaurantId);
      router.refresh();
    } catch (error) {
      setCreateErrorMessage(error instanceof Error ? error.message : 'Could not create restaurant.');
    } finally {
      setIsCreatingRestaurant(false);
    }
  }, [isCreatingRestaurant, router]);

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
  }, [filterCategory, headings.length, isFilterPopoverOpen, savedFilterGroups.length, selectedCity]);

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
      if (filterCategory === 'distance') {
        headingValues.push(userLocation
          ? getDistanceHeading(getRestaurantDistanceInKm(restaurant, userLocation))
          : 'Nearest to you');
      }

      if (filterCategory === 'area') {
        headingValues.push(
          ...(isAllCitiesSelected || restaurant.areas.length === 0
            ? [isAllCitiesSelected ? getCityGroupingHeading(restaurant) : (selectedCity ?? restaurant.cityName)]
            : restaurant.areas)
        );
      }

      if (filterCategory === 'type') {
        headingValues.push(...restaurant.types.map((type) => type.name));
      }

      if (filterCategory === 'recentlyAdded') {
        headingValues.push(getMonthHeadingKey(restaurant.createdAt));
      }

      for (const heading of headingValues) {
        if (filterCategory !== 'recentlyAdded' && filterCategory !== 'distance' && excluded.includes(heading)) {
          continue;
        }

        const current = map.get(heading) ?? [];
        current.push(restaurant);
        map.set(heading, current);
      }
    }

    if (filterCategory === 'recentlyAdded') {
      return new Map([...map.entries()].sort(([headingA], [headingB]) => headingB.localeCompare(headingA)));
    }

    if (filterCategory === 'distance') {
      return new Map(sortDistanceHeadings([...map.keys()]).map((heading) => [heading, map.get(heading) ?? []]));
    }

    return new Map([...map.entries()].sort(([headingA], [headingB]) => byAlpha(headingA, headingB)));
  }, [excluded, filterCategory, isAllCitiesSelected, isSearchActive, mealFilteredRestaurants, searchedRestaurants, selectedCity, userLocation]);
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
        return getIncludedRestaurantAreaLaneIds(restaurant, excluded).length > 0;
      }

      const primaryType = getPrimaryType(restaurant);
      return primaryType !== null && !excluded.includes(primaryType.name);
    });
  }, [boardCategory, excluded, grouped, isSearchActive, mealFilteredRestaurants, searchedRestaurants, selectedStatuses]);
  const boardLanes = useMemo(
    () => (boardCategory ? buildBoardLanes(boardCategory, boardRestaurants, excluded) : []),
    [boardCategory, boardRestaurants, excluded]
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
      for (const laneId of getRestaurantBoardLaneIds(restaurant, boardCategory, excluded)) {
        const lane = map.get(laneId);
        if (!lane) {
          continue;
        }

        const current = lane.get(restaurant.status) ?? [];
        current.push(restaurant);
        lane.set(restaurant.status, current);
      }
    }

    return map;
  }, [boardCategory, boardLanes, boardRestaurants, excluded]);
  const visibleSearchResultCount = useMemo(() => {
    if (!isSearchActive) {
      return 0;
    }

    let count = 0;
    for (const places of grouped.values()) {
      count += places.length;
    }

    return count;
  }, [grouped, isSearchActive]);
  const effectiveViewMode: ViewMode =
    viewMode === 'kanban' && boardCategory !== null ? 'kanban' : viewMode === 'map' ? 'map' : 'list';
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
  const resultsMotionSignature = useMemo(
    () =>
      [
        effectiveViewMode,
        filterCategory,
        selectedCity ?? allCitiesUrlValue,
        selectedMealType,
        selectedStatuses.join(','),
        excluded.join(','),
        normalizedSearchQuery,
        visibleRestaurantIds.join(',')
      ].join('::'),
    [
      effectiveViewMode,
      excluded,
      filterCategory,
      normalizedSearchQuery,
      selectedCity,
      selectedMealType,
      selectedStatuses,
      visibleRestaurantIds
    ]
  );
  const visibleRestaurantsById = useMemo(
    () => new Map(restaurants.map((restaurant) => [restaurant.id, restaurant])),
    [restaurants]
  );
  const visibleRestaurants = useMemo(
    () =>
      visibleRestaurantIds
        .map((id) => visibleRestaurantsById.get(id))
        .filter((restaurant): restaurant is PublicRestaurant => Boolean(restaurant)),
    [visibleRestaurantIds, visibleRestaurantsById]
  );
  const mappedVisiblePins = useMemo(
    () =>
      visibleRestaurants.flatMap((restaurant) =>
        restaurant.locations.map((location) => ({
          id: `${restaurant.id}:${location.id}`,
          restaurant,
          location
        }))
      ),
    [visibleRestaurants]
  );
  const mappedVisiblePinCountByRestaurantId = useMemo(() => {
    const counts = new Map<string, number>();

    for (const pin of mappedVisiblePins) {
      counts.set(pin.restaurant.id, (counts.get(pin.restaurant.id) ?? 0) + 1);
    }

    return counts;
  }, [mappedVisiblePins]);
  const hasMappedVisibleRestaurants = mappedVisiblePins.length > 0;
  useEffect(() => {
    if (!hasInitializedFilters || !hasResolvedCitySelection) {
      return;
    }

    if (viewMode === 'map' && !hasMappedVisibleRestaurants) {
      setViewMode('list');
    }
  }, [hasInitializedFilters, hasMappedVisibleRestaurants, hasResolvedCitySelection, viewMode]);
  const includedHeadingsCount = useMemo(
    () => headings.filter((heading) => !excluded.includes(heading)).length,
    [excluded, headings]
  );
  const activeFilterGroupCategory = filterCategory === 'area' || filterCategory === 'type' ? filterCategory : null;
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
  const luckyCandidateIds = useMemo(
    () => {
      const candidateIds = effectiveViewMode === 'map'
        ? mappedVisiblePins.map((pin) => pin.id)
        : visibleRestaurantIds;

      if (effectiveViewMode === 'map') {
        return mappedVisiblePins
          .filter((pin) => selectedStatuses.includes(pin.restaurant.status))
          .map((pin) => pin.id);
      }

      return getFeelingLuckyCandidateIds(candidateIds, visibleRestaurantsById, selectedStatuses);
    },
    [effectiveViewMode, mappedVisiblePins, selectedStatuses, visibleRestaurantIds, visibleRestaurantsById]
  );
  const disableFeelingLuckyButton =
    !showFeelingLuckyForStatuses(selectedStatuses) || luckyCandidateIds.length === 0;

  useEffect(() => {
    if (!filtersReady) {
      return;
    }

    if (previousResultsMotionSignature.current === null) {
      previousResultsMotionSignature.current = resultsMotionSignature;
      return;
    }

    if (previousResultsMotionSignature.current === resultsMotionSignature) {
      return;
    }

    previousResultsMotionSignature.current = resultsMotionSignature;
    setResultsMotionKey((current) => current + 1);
  }, [filtersReady, resultsMotionSignature]);

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

    let timeoutId: number | null = null;

    const startConfetti = (): void => {
      setActiveLuckyConfettiId(luckyRestaurantId);
      timeoutId = window.setTimeout(() => {
        setActiveLuckyConfettiId((current) => (current === luckyRestaurantId ? null : current));
        setLuckyRestaurantId((current) => (current === luckyRestaurantId ? null : current));
      }, 1800);
    };

    const isLuckyCardInViewport = (): boolean => {
      const luckyCard = restaurantCardRefs.current[luckyRestaurantId];
      if (!luckyCard) {
        return false;
      }

      const rect = luckyCard.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight;
    };

    const onScroll = (): void => {
      if (!isLuckyCardInViewport()) {
        return;
      }

      window.removeEventListener('scroll', onScroll);
      startConfetti();
    };

    setActiveLuckyConfettiId(null);

    if (effectiveViewMode === 'map') {
      startConfetti();
    } else if (isLuckyCardInViewport()) {
      startConfetti();
    } else {
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      window.removeEventListener('scroll', onScroll);
    };
  }, [effectiveViewMode, luckyRestaurantId, luckyRunCount]);

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
    if (typeof window === 'undefined' || !window.visualViewport) {
      return;
    }

    const documentElement = document.documentElement;
    const updateVisualViewportOffset = (): void => {
      const viewport = window.visualViewport;
      if (!viewport) {
        return;
      }

      const bottomOffset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      documentElement.style.setProperty('--visual-viewport-bottom-offset', `${bottomOffset}px`);
    };

    updateVisualViewportOffset();
    window.visualViewport.addEventListener('resize', updateVisualViewportOffset);
    window.visualViewport.addEventListener('scroll', updateVisualViewportOffset);
    window.addEventListener('orientationchange', updateVisualViewportOffset);

    return () => {
      window.visualViewport?.removeEventListener('resize', updateVisualViewportOffset);
      window.visualViewport?.removeEventListener('scroll', updateVisualViewportOffset);
      window.removeEventListener('orientationchange', updateVisualViewportOffset);
      documentElement.style.removeProperty('--visual-viewport-bottom-offset');
    };
  }, []);

  useEffect(() => {
    if (!highlightedRestaurantId) {
      return;
    }

    const clearHighlightTimeoutId = window.setTimeout(() => {
      setHighlightedRestaurantId((current) => (current === highlightedRestaurantId ? null : current));
    }, newRestaurantHighlightDurationMs);

    return () => {
      window.clearTimeout(clearHighlightTimeoutId);
    };
  }, [highlightedRestaurantId]);

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
  }, [filterCategory, selectedCity]);

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
      setCreateErrorMessage(null);
      setIsCreateDialogOpen(true);
    },
    [boardCategory, createDefaultCityId, createDefaultMealTypes, createTools]
  );
  const toggleSelectedStatus = (status: RestaurantStatusFilter, checked: boolean): void => {
    if (effectiveViewMode === 'kanban') {
      return;
    }

    statusFilterSnapshot.current =
      filterCategory !== 'recentlyAdded' && filterCategory !== 'distance'
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
  const resetVisibleFilters = useCallback((): void => {
    setSelectedMealType('Any');
    setSelectedStatuses(getDefaultStatusesForCity(selectedCity));
    preservedIncludedHeadings.current = null;
    statusFilterSnapshot.current = null;
    setExcluded([]);
  }, [getDefaultStatusesForCity, selectedCity]);
  const renderNoResultsState = (variant: 'kanban' | 'list') => {
    if (isSearchActive) {
      return (
        <div className={`${styles.noResults} ${styles.emptyState}`}>
          <div className={styles.emptyStateKicker}>No match</div>
          <div className={styles.emptyStateTitle}>Nothing found for “{searchQuery.trim()}”.</div>
          <p>Try a shorter search, another spelling, or clear the query to get back to browsing.</p>
          <div className={styles.emptyStateActions}>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setIsSearchPopoverOpen(false);
              }}
            >
              Clear Search
            </button>
          </div>
        </div>
      );
    }

    if (selectedStatuses.length === 0) {
      return (
        <div className={`${styles.noResults} ${styles.emptyState}`}>
          <div className={styles.emptyStateKicker}>Nothing visible</div>
          <div className={styles.emptyStateTitle}>Choose at least one status.</div>
          <div className={styles.emptyStateActions}>
            <button
              type="button"
              onClick={() => setSelectedStatuses(getDefaultStatusesForCity(selectedCity))}
            >
              Show Defaults
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={`${styles.noResults} ${styles.emptyState}`}>
        <div className={styles.emptyStateKicker}>{variant === 'kanban' ? 'Board is clear' : 'No places here'}</div>
        <div className={styles.emptyStateTitle}>No restaurants match this view.</div>
        <p>Broaden the filters, switch meal type, or bring the hidden groups back in.</p>
        <div className={styles.emptyStateActions}>
          <button type="button" onClick={resetVisibleFilters}>
            Reset Filters
          </button>
        </div>
      </div>
    );
  };
  const scrollRestaurantCardIntoView = useCallback((restaurantId: string, behavior: ScrollBehavior = 'smooth'): boolean => {
    const restaurantCard = restaurantCardRefs.current[restaurantId];
    if (!restaurantCard || typeof window === 'undefined') {
      return false;
    }

    const cardRect = restaurantCard.getBoundingClientRect();
    const currentScrollTop = Math.max(
      window.scrollY,
      window.pageYOffset,
      document.documentElement?.scrollTop ?? 0,
      document.body?.scrollTop ?? 0
    );
    const targetTop = Math.max(0, currentScrollTop + cardRect.top - window.innerHeight * 0.22);
    window.scrollTo({
      top: targetTop,
      behavior
    });

    return true;
  }, []);
  const showRestaurantInList = useCallback((restaurantId: string): void => {
    setViewMode('list');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!scrollRestaurantCardIntoView(restaurantId)) {
          return;
        }

        setHighlightedRestaurantId(restaurantId);
      });
    });
  }, [scrollRestaurantCardIntoView]);
  const showRestaurantOnMap = useCallback((restaurant: PublicRestaurant): void => {
    if (restaurant.locations.length === 0) {
      return;
    }

    pendingMapRestaurantFocusIdRef.current = restaurant.id;
    setViewMode('map');
  }, []);
  const handleViewModeChange = (nextViewMode: ViewMode): void => {
    if (nextViewMode !== 'list' && (category === 'recentlyAdded' || category === 'distance')) {
      setCategory('area');
    }

    setViewMode(nextViewMode);
  };
  const ensureNewRestaurantVisible = useCallback((restaurant: PublicRestaurant): boolean => {
    let hasUpdatedFilters = false;

    if (searchQuery.trim().length > 0) {
      setSearchQuery('');
      hasUpdatedFilters = true;
    }

    if (!isAllCitiesSelected && selectedCity !== restaurant.cityName) {
      setSelectedCity(restaurant.cityName);
      setSelectedStatuses((current) => {
        const next = getDefaultStatusesForCity(restaurant.cityName);
        return next.includes(restaurant.status) ? next : [...next, restaurant.status];
      });
      statusFilterSnapshot.current = null;
      preservedIncludedHeadings.current = null;
      hasUpdatedFilters = true;
    } else if (!selectedStatuses.includes(restaurant.status)) {
      setSelectedStatuses((current) => [...current, restaurant.status]);
      hasUpdatedFilters = true;
    }

    if (selectedMealType !== 'Any' && !restaurant.mealTypes.includes(selectedMealType)) {
      setSelectedMealType('Any');
      hasUpdatedFilters = true;
    }

    if (filterCategory === 'area') {
      const visibleHeadings =
        isAllCitiesSelected || restaurant.areas.length === 0
          ? [isAllCitiesSelected ? getCityGroupingHeading(restaurant) : restaurant.cityName]
          : restaurant.areas;

      if (visibleHeadings.some((heading) => excluded.includes(heading))) {
        setExcluded((current) => current.filter((entry) => !visibleHeadings.includes(entry)));
        preservedIncludedHeadings.current = null;
        hasUpdatedFilters = true;
      }
    }

    if (filterCategory === 'type') {
      const visibleHeadings = restaurant.types.map((type) => type.name);

      if (visibleHeadings.some((heading) => excluded.includes(heading))) {
        setExcluded((current) => current.filter((entry) => !visibleHeadings.includes(entry)));
        preservedIncludedHeadings.current = null;
        hasUpdatedFilters = true;
      }
    }

    return hasUpdatedFilters;
  }, [
    excluded,
    filterCategory,
    getDefaultStatusesForCity,
    isAllCitiesSelected,
    searchQuery,
    selectedCity,
    selectedMealType,
    selectedStatuses
  ]);
  useEffect(() => {
    if (!pendingNewRestaurantId) {
      return;
    }

    const newRestaurant = restaurants.find((restaurant) => restaurant.id === pendingNewRestaurantId);
    if (!newRestaurant) {
      return;
    }

    if (ensureNewRestaurantVisible(newRestaurant)) {
      return;
    }

    if (!visibleRestaurantIds.includes(newRestaurant.id)) {
      return;
    }

    const revealFrameId = window.requestAnimationFrame(() => {
      if (!scrollRestaurantCardIntoView(newRestaurant.id)) {
        return;
      }

      setLuckyRestaurantId(newRestaurant.id);
      setLuckyRunCount((current) => current + 1);
      setHighlightedRestaurantId(newRestaurant.id);
      clearNewRestaurantQueryParam();
      setPendingNewRestaurantId(null);
    });

    return () => {
      window.cancelAnimationFrame(revealFrameId);
    };
  }, [
    clearNewRestaurantQueryParam,
    ensureNewRestaurantVisible,
    pendingNewRestaurantId,
    restaurants,
    scrollRestaurantCardIntoView,
    visibleRestaurantIds
  ]);
  const handleFeelingLucky = (): void => {
    if (luckyCandidateIds.length === 0) {
      return;
    }

    const luckyId = luckyCandidateIds[Math.floor(Math.random() * luckyCandidateIds.length)];
    if (effectiveViewMode === 'map') {
      const marker = googleMarkersByPinIdRef.current.get(luckyId);
      const googleMaps = (window as GoogleMapsWindow).google?.maps;
      if (!marker || !googleMapRef.current || !googleMaps) {
        return;
      }

      const position = marker.getPosition?.();
      if (position) {
        googleMapRef.current.panTo(position);
        googleMapRef.current.setZoom(Math.max(googleMapRef.current.getZoom() ?? 14, 15));
      }
      googleMaps.event.trigger(marker, 'click');
      setLuckyRestaurantId(luckyId.split(':')[0] ?? luckyId);
      setLuckyRunCount((current) => current + 1);
      return;
    }

    const luckyCard = restaurantCardRefs.current[luckyId];
    if (!luckyCard) {
      return;
    }

    setLuckyRestaurantId(luckyId);
    setLuckyRunCount((current) => current + 1);
    scrollRestaurantCardIntoView(luckyId);
  };
  const requestUserLocation = useCallback((focusMode: UserLocationFocusMode = 'always'): void => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationErrorMessage('Location is not available in this browser.');
      return;
    }

    setIsLocatingUser(true);
    setLocationErrorMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        userLocationFocusModeRef.current = focusMode;
        shouldFocusUserLocationRef.current = true;
        setUserLocation(nextLocation);
        setIsLocatingUser(false);
      },
      (error) => {
        setLocationErrorMessage(error.message || 'Could not get your current location.');
        setIsLocatingUser(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 10_000
      }
    );
  }, []);
  useEffect(() => {
    if (category !== 'distance' || userLocation || isLocatingUser) {
      return;
    }

    requestUserLocation('visible-area');
  }, [category, isLocatingUser, requestUserLocation, userLocation]);
  useEffect(() => {
    if (effectiveViewMode !== 'map' || isAllCitiesSelected || isSearchActive) {
      autoRequestedLocationContextRef.current = null;
      return;
    }

    if (!hasMappedVisibleRestaurants || isLocatingUser) {
      return;
    }

    const locationContext = selectedCity ?? 'default-city';
    if (autoRequestedLocationContextRef.current === locationContext) {
      return;
    }

    autoRequestedLocationContextRef.current = locationContext;
    requestUserLocation('visible-area');
  }, [
    effectiveViewMode,
    hasMappedVisibleRestaurants,
    isAllCitiesSelected,
    isSearchActive,
    isLocatingUser,
    requestUserLocation,
    selectedCity
  ]);
  useEffect(() => {
      if (effectiveViewMode !== 'map') {
        googleMapRef.current = null;
        googleMarkerClustererRef.current?.clearMarkers();
        googleMarkerClustererRef.current?.setMap(null);
        googleMarkerClustererRef.current = null;
        googleMarkersRef.current = [];
        googleMarkerStatusByMarkerRef.current = new WeakMap();
        googleMarkersByPinIdRef.current.clear();
        googleMarkerOpenersByPinIdRef.current.clear();
        googleMarkerMetadataByPinIdRef.current.clear();
        selectedMapPinIdRef.current = null;
        selectedMapRestaurantIdRef.current = null;
        googleUserMarkerRef.current = null;
        return;
      }

    if (!googleMapsBrowserApiKey.trim()) {
      setMapLoadErrorMessage('Set NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_API_KEY to render the embedded Google Map.');
      return;
    }

    let cancelled = false;
    let renderFrameId: number | null = null;
    const windowWithGoogle = window as GoogleMapsWindow;

    const clearGoogleMapObjects = (): void => {
      googleMarkerClustererRef.current?.clearMarkers();
      googleMarkerClustererRef.current?.setMap(null);
      googleMarkerClustererRef.current = null;
      for (const marker of googleMarkersRef.current) {
        marker.setMap(null);
      }
      googleMarkersRef.current = [];
      googleMarkerStatusByMarkerRef.current = new WeakMap();
      googleMarkersByPinIdRef.current.clear();
      googleMarkerOpenersByPinIdRef.current.clear();
      googleMarkerMetadataByPinIdRef.current.clear();
      if (googleUserMarkerRef.current) {
        googleUserMarkerRef.current.setMap(null);
        googleUserMarkerRef.current = null;
      }
    };

    const renderMap = (): void => {
      if (cancelled || !googleMapContainerRef.current || !windowWithGoogle.google?.maps) {
        return;
      }

      const googleMaps = windowWithGoogle.google.maps;
      if (googleMapRef.current?.getDiv?.() !== googleMapContainerRef.current) {
        googleMapRef.current = null;
      }

      const shouldPrioritizeSearchResults = isSearchActive && mappedVisiblePins.length > 0;
      const mapSize = {
        height: googleMapContainerRef.current.clientHeight,
        width: googleMapContainerRef.current.clientWidth
      };
      const isUserNearVisiblePins = userLocation
        ? isMappedRestaurantWithinUserMapBounds(userLocation, mappedVisiblePins, mapSize)
        : false;
      const shouldForceUserLocationFocus = shouldFocusUserLocationRef.current && userLocationFocusModeRef.current === 'always';
      const shouldUseUserLocation = userLocation
        ? !shouldPrioritizeSearchResults &&
          (isUserNearVisiblePins || shouldForceUserLocationFocus)
        : false;
      const fallbackCenter = mappedVisiblePins[0]
        ? {
            lat: mappedVisiblePins[0].location.latitude,
            lng: mappedVisiblePins[0].location.longitude
          }
        : { lat: -37.8136, lng: 144.9631 };
      const center = userLocation && shouldUseUserLocation
        ? { lat: userLocation.latitude, lng: userLocation.longitude }
        : fallbackCenter;
      const hasExistingMap = Boolean(googleMapRef.current);

      if (!googleMapRef.current) {
        googleMapRef.current = new googleMaps.Map(googleMapContainerRef.current, {
          center,
          clickableIcons: true,
          fullscreenControl: true,
          mapTypeControl: false,
          streetViewControl: true,
          zoom: 13
        });
      }
      googleMaps.event.clearListeners(googleMapRef.current, 'click');

      clearGoogleMapObjects();

      const bounds = new googleMaps.LatLngBounds();
      const restaurantBounds = new googleMaps.LatLngBounds();
      const restaurantPositions: Array<{ lat: number; lng: number }> = [];
      const infoWindow = new googleMaps.InfoWindow({
        headerDisabled: true
      });
      if (
        selectedMapRestaurantIdRef.current &&
        !mappedVisiblePinCountByRestaurantId.has(selectedMapRestaurantIdRef.current)
      ) {
        selectedMapRestaurantIdRef.current = null;
      }
      const updateMarkerSelection = (restaurantId: string | null): void => {
        if (restaurantId === null) {
          selectedMapPinIdRef.current = null;
        }

        selectedMapRestaurantIdRef.current = restaurantId;

        for (const [pinId, marker] of googleMarkersByPinIdRef.current) {
          const metadata = googleMarkerMetadataByPinIdRef.current.get(pinId);
          if (!metadata) {
            continue;
          }

          const isChainHighlighted = restaurantId === metadata.restaurantId && metadata.chainLocationCount > 1;
          const isSelected = selectedMapPinIdRef.current === pinId;
          marker.setIcon({
            anchor: new googleMaps.Point(19, 56),
            scaledSize: new googleMaps.Size(50, 62),
            url: buildRestaurantMapMarkerIcon(
              metadata.status,
              resolvedSecondaryColor,
              resolvedPrimaryColor,
              metadata.chainLocationCount,
              isChainHighlighted,
              isSelected
            )
          });
          marker.setZIndex(isSelected ? 1000 : isChainHighlighted ? 500 : metadata.chainLocationCount > 1 ? 200 : undefined);
        }
      };
      googleMapRef.current.addListener('click', () => {
        updateMarkerSelection(null);
        infoWindow.close();
      });
      infoWindow.addListener('closeclick', () => {
        updateMarkerSelection(null);
      });

      if (userLocation && shouldUseUserLocation) {
        const userPosition = { lat: userLocation.latitude, lng: userLocation.longitude };
        googleUserMarkerRef.current = new googleMaps.Marker({
          icon: {
            anchor: new googleMaps.Point(15, 15),
            scaledSize: new googleMaps.Size(30, 30),
            url: buildUserLocationMapMarkerIcon()
          },
          map: googleMapRef.current,
          position: userPosition,
          title: 'Your current location',
          zIndex: 1000
        });
        bounds.extend(userPosition);
      }

      for (const pin of mappedVisiblePins) {
        const { restaurant, location } = pin;
        const chainLocationCount = mappedVisiblePinCountByRestaurantId.get(restaurant.id) ?? 1;
        const isChainHighlighted = selectedMapRestaurantIdRef.current === restaurant.id && chainLocationCount > 1;
        const isSelected = selectedMapPinIdRef.current === pin.id;
        const position = {
          lat: location.latitude,
          lng: location.longitude
        };
        restaurantPositions.push(position);
        const mapLabel = getRestaurantMapLabel(restaurant, mapLabelMode);
        const marker = new googleMaps.Marker({
          icon: {
            anchor: new googleMaps.Point(19, 56),
            scaledSize: new googleMaps.Size(50, 62),
            url: buildRestaurantMapMarkerIcon(
              restaurant.status,
              resolvedSecondaryColor,
              resolvedPrimaryColor,
              chainLocationCount,
              isChainHighlighted,
              isSelected
            )
          },
          ...(mapLabel ? {
            label: {
              className: 'eats-map-marker-label',
              text: mapLabel
            }
          } : {}),
          position,
          title: restaurant.name,
          zIndex: isSelected ? 1000 : isChainHighlighted ? 500 : chainLocationCount > 1 ? 200 : undefined
        });
        const openMarkerInfoWindow = (): void => {
          selectedMapPinIdRef.current = pin.id;
          updateMarkerSelection(restaurant.id);
          const mapsUrl = location.googlePlaceId
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.name)}&query_place_id=${encodeURIComponent(location.googlePlaceId)}`
            : location.googleMapsUrl || restaurant.url;
          const address = location.address
            ? `<div style="color:#4b5563;font-size:12px;line-height:1.35;margin-top:5px;">${escapeHtml(location.address)}</div>`
            : '';
          const typeText = restaurant.types.map((type) => `${type.emoji} ${type.name}`).join(', ');
          const locationLabel = location.label?.trim() ?? '';
          const mealText = restaurant.mealTypes.map((mealType) => mealLabel(mealType)).join(', ');
          const detailText = getRestaurantDetailText(restaurant);
          const detailLabel = restaurant.status === 'disliked' ? 'Reason' : 'Notes';
          const chainText = chainLocationCount > 1
            ? renderMapInfoRow('Locations', `${chainLocationCount} visible on this map`)
            : '';
          const infoWindowContent = document.createElement('div');
          infoWindowContent.className = 'eats-map-info-window';
          infoWindowContent.innerHTML =
            `<button class="eats-map-info-close" type="button" aria-label="Close">×</button>
            <div style="box-sizing:border-box;color:#111827;font-family:Arial,sans-serif;width:min(360px, calc(80vw - 48px));padding:0 30px 2px 0;">
              <div style="font-size:15px;font-weight:700;line-height:1.25;padding-right:4px;">${escapeHtml(restaurant.name)}</div>
              ${locationLabel ? `<div style="color:#4b5563;font-size:12px;line-height:1.35;margin-top:4px;">${escapeHtml(locationLabel)}</div>` : ''}
              <div style="color:#111827;font-size:12px;font-weight:700;margin-top:5px;">${escapeHtml(getRestaurantStatusLabel(restaurant.status))}</div>
              ${address}
              ${renderMapInfoRow('Food', typeText)}
              ${renderMapInfoRow('Meals', mealText)}
              ${chainText}
              ${renderMapInfoRow(detailLabel, detailText)}
              ${renderMapInfoUrlRow('Where I Found It', restaurant.referredBy.trim())}
              <button class="eats-map-info-list" type="button" style="border:0;background:#111827;border-radius:999px;color:white;cursor:pointer;display:inline-block;font-size:13px;font-weight:700;margin-top:10px;padding:7px 11px;">Show in list</button>
              <a style="display:inline-block;font-size:13px;margin-top:10px;" href="${mapsUrl}" target="_blank" rel="noreferrer">Open in Google Maps</a>
            </div>`;
          infoWindowContent.querySelector('.eats-map-info-close')?.addEventListener('click', () => {
            updateMarkerSelection(null);
            infoWindow.close();
          });
          infoWindowContent.querySelector('.eats-map-info-list')?.addEventListener('click', () => {
            updateMarkerSelection(null);
            infoWindow.close();
            showRestaurantInList(restaurant.id);
          });
          infoWindow.setContent(infoWindowContent);
          infoWindow.open({
            anchor: marker,
            map: googleMapRef.current
          });
        };
        marker.addListener('click', openMarkerInfoWindow);
        googleMarkersRef.current.push(marker);
        googleMarkerStatusByMarkerRef.current.set(marker, restaurant.status);
        googleMarkersByPinIdRef.current.set(pin.id, marker);
        googleMarkerOpenersByPinIdRef.current.set(pin.id, openMarkerInfoWindow);
        googleMarkerMetadataByPinIdRef.current.set(pin.id, {
          restaurantId: restaurant.id,
          status: restaurant.status,
          chainLocationCount
        });
        bounds.extend(position);
        restaurantBounds.extend(position);
      }

      if (
        selectedMapPinIdRef.current &&
        !googleMarkerOpenersByPinIdRef.current.has(selectedMapPinIdRef.current)
      ) {
        selectedMapPinIdRef.current = null;
      }
      updateMarkerSelection(selectedMapRestaurantIdRef.current);
      googleMarkerClustererRef.current = new MarkerClusterer({
        map: googleMapRef.current,
        markers: googleMarkersRef.current,
        onClusterClick: (_event, cluster, map): void => {
          if (cluster.bounds) {
            map.fitBounds(cluster.bounds, 80);
            return;
          }

          if (cluster.position) {
            map.panTo(cluster.position);
            map.setZoom(Math.min((map.getZoom() ?? 13) + 2, 20));
          }
        },
        renderer: {
          render: ({ count, markers, position }): any => {
            const statusCounts: MapClusterStatusCounts = {
              disliked: 0,
              liked: 0,
              untried: 0
            };

            for (const marker of markers) {
              const status = googleMarkerStatusByMarkerRef.current.get(marker as object);
              if (status) {
                statusCounts[status] += 1;
              }
            }

            return new googleMaps.Marker({
              icon: {
                anchor: new googleMaps.Point(29, 29),
                scaledSize: new googleMaps.Size(58, 58),
                url: buildRestaurantMapClusterIcon(count, statusCounts, resolvedSecondaryColor, resolvedPrimaryColor)
              },
              position,
              title: `${count} restaurants`,
              zIndex: Number(googleMaps.Marker.MAX_ZINDEX ?? 10_000) + count
            });
          }
        }
      });

      const pendingMapRestaurantFocusId = pendingMapRestaurantFocusIdRef.current;
      const pendingRestaurantMarkers = pendingMapRestaurantFocusId
        ? [...googleMarkersByPinIdRef.current.entries()].flatMap(([pinId, marker]) => {
            const metadata = googleMarkerMetadataByPinIdRef.current.get(pinId);
            return metadata?.restaurantId === pendingMapRestaurantFocusId ? [{ marker, pinId }] : [];
          })
        : [];
      const didFocusPendingRestaurant = pendingMapRestaurantFocusId !== null && pendingRestaurantMarkers.length > 0;
      if (didFocusPendingRestaurant) {
        const focusedBounds = new googleMaps.LatLngBounds();
        for (const { marker } of pendingRestaurantMarkers) {
          const markerPosition = marker.getPosition?.();
          if (markerPosition) {
            focusedBounds.extend(markerPosition);
          }
        }

        if (pendingRestaurantMarkers.length > 1 && !focusedBounds.isEmpty()) {
          googleMapRef.current.fitBounds(focusedBounds, 96);
        } else {
          const position = pendingRestaurantMarkers[0]?.marker.getPosition?.();
          if (position) {
            googleMapRef.current.panTo(position);
            googleMapRef.current.setZoom(Math.max(googleMapRef.current.getZoom() ?? 14, 15));
          }
        }

        const selectedRestaurantMarker = userLocation
          ? pendingRestaurantMarkers
              .map((entry) => {
                const pin = mappedVisiblePins.find((mappedPin) => mappedPin.id === entry.pinId);
                return {
                  ...entry,
                  distance: pin
                    ? getDistanceInKm(userLocation, {
                        latitude: pin.location.latitude,
                        longitude: pin.location.longitude
                      })
                    : Number.POSITIVE_INFINITY
                };
              })
              .sort((first, second) => first.distance - second.distance)[0]
          : pendingRestaurantMarkers[0];
        updateMarkerSelection(pendingMapRestaurantFocusId);
        googleMarkerOpenersByPinIdRef.current.get(
          selectedRestaurantMarker?.pinId ?? pendingRestaurantMarkers[0]?.pinId ?? ''
        )?.();
        pendingMapRestaurantFocusIdRef.current = null;
        pendingMapPinFocusIdRef.current = null;
      }

      const pendingMapPinFocusId = pendingMapPinFocusIdRef.current;
      const pendingMarker = pendingMapPinFocusId ? googleMarkersByPinIdRef.current.get(pendingMapPinFocusId) : null;
      if (!pendingMapRestaurantFocusId && pendingMapPinFocusId && pendingMarker) {
        const position = pendingMarker.getPosition?.();
        if (position) {
          googleMapRef.current.panTo(position);
          googleMapRef.current.setZoom(Math.max(googleMapRef.current.getZoom() ?? 14, 15));
        }
        googleMarkerOpenersByPinIdRef.current.get(pendingMapPinFocusId)?.();
        pendingMapPinFocusIdRef.current = null;
      }

      if (!didFocusPendingRestaurant && !pendingMarker && selectedMapPinIdRef.current) {
        googleMarkerOpenersByPinIdRef.current.get(selectedMapPinIdRef.current)?.();
      }

      googleMaps.event.trigger(googleMapRef.current, 'resize');
      if (didFocusPendingRestaurant || pendingMarker) {
        shouldFocusUserLocationRef.current = false;
      } else if (userLocation && shouldFocusUserLocationRef.current && shouldUseUserLocation) {
        shouldFocusUserLocationRef.current = false;
        googleMapRef.current.panTo({ lat: userLocation.latitude, lng: userLocation.longitude });
        googleMapRef.current.setZoom(Math.max(googleMapRef.current.getZoom() ?? 14, defaultUserLocationMapZoom));
      } else if (
        userLocation &&
        shouldFocusUserLocationRef.current &&
        userLocationFocusModeRef.current === 'visible-area' &&
        !restaurantBounds.isEmpty()
      ) {
        shouldFocusUserLocationRef.current = false;
        googleMapRef.current.fitBounds(restaurantBounds, 64);
      } else if (!bounds.isEmpty()) {
        shouldFocusUserLocationRef.current = false;
        if (!hasExistingMap) {
          googleMapRef.current.fitBounds(shouldPrioritizeSearchResults && !restaurantBounds.isEmpty() ? restaurantBounds : bounds, 64);
        }
      }
      setMapLoadErrorMessage(null);
    };

    const scheduleRenderMap = (): void => {
      if (renderFrameId !== null) {
        window.cancelAnimationFrame(renderFrameId);
      }

      renderFrameId = window.requestAnimationFrame(() => {
        renderFrameId = window.requestAnimationFrame(() => {
          renderFrameId = null;
          renderMap();
        });
      });
    };

    if (windowWithGoogle.google?.maps) {
      scheduleRenderMap();
      return () => {
        cancelled = true;
        if (renderFrameId !== null) {
          window.cancelAnimationFrame(renderFrameId);
        }
        clearGoogleMapObjects();
      };
    }

    windowWithGoogle.initEatsGoogleMap = scheduleRenderMap;
    const existingScript = document.getElementById('eats-google-maps-js');
    if (!existingScript) {
      const script = document.createElement('script');
      script.id = 'eats-google-maps-js';
      script.async = true;
      script.defer = true;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsBrowserApiKey)}&callback=initEatsGoogleMap`;
      script.onerror = () => {
        if (!cancelled) {
          setMapLoadErrorMessage('Could not load Google Maps.');
        }
      };
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (renderFrameId !== null) {
        window.cancelAnimationFrame(renderFrameId);
      }
      clearGoogleMapObjects();
    };
  }, [
    effectiveViewMode,
    googleMapsBrowserApiKey,
    mapLabelMode,
    mappedVisiblePinCountByRestaurantId,
    mappedVisiblePins,
    isSearchActive,
    resolvedPrimaryColor,
    resolvedSecondaryColor,
    showRestaurantInList,
    userLocation
  ]);
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
          countryName: targetCity.countryName,
          dislikedReason: move.status === 'disliked' ? move.dislikedReason : null,
          notes: move.status === 'disliked' ? restaurant.notes : move.notes,
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
          dislikedReason: move.status === 'disliked' ? move.dislikedReason : null,
          notes: move.status === 'disliked' ? restaurant.notes : move.notes,
          status: target.status
        };
      }

      const targetType = adminTools?.types.find((type) => type.id === target.laneId);
      if (!targetType) {
        return restaurant;
      }

      return {
        ...restaurant,
        dislikedReason: move.status === 'disliked' ? move.dislikedReason : null,
        notes: move.status === 'disliked' ? restaurant.notes : move.notes,
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
      if (move.notes?.trim().length) {
        formData.set('notes', move.notes.trim());
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
  const renderRestaurantCard = useCallback(
    (place: PublicRestaurant, options: RestaurantCardRenderOptions) => {
      const compactDetailText = getRestaurantDetailText(place);
      const compactDetailId = `compact-detail-${options.keyPrefix}-${place.id}`;
      const isCompactDetailExpanded = expandedCompactCardIds.has(place.id);
      const canShowOnMap = place.locations.length > 0;
      const showCompactCardActions = canShowOnMap || canEditRestaurants || canDeleteRestaurants;
      const canExpandCompactCard = compactCards && (compactDetailText.length > 0 || showCompactCardActions);
      const types = category === 'type' ? [] : place.types;
      const primaryMealType = getPrimaryMealType(place.mealTypes);
      const areas =
        category === 'area' ? [] : [...new Set(place.areas.map((area) => area.trim()).filter(Boolean))];

      return (
        <div
          className={`${styles.placeCard} ${compactCards ? styles.compactPlaceCard : ''} ${
            canExpandCompactCard ? styles.compactPlaceCardInteractive : ''
          } ${isCompactDetailExpanded ? styles.compactPlaceCardExpanded : ''} ${
            luckyRestaurantId === place.id ? styles.luckyCard : ''
          } ${highlightedRestaurantId === place.id ? styles.newRestaurantCard : ''} ${
            options.extraClassName ?? ''
          } ${
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
          onMouseMove={(event) => {
            updateRestaurantCardPointerTint(event.currentTarget, event.clientX, event.clientY);
          }}
          onMouseLeave={(event) => {
            clearRestaurantCardPointerTint(event.currentTarget);
          }}
        >
          {activeLuckyConfettiId === place.id ? (
            <div className={styles.confettiLayer} aria-hidden="true">
              {confettiPieceIndexes.map((index) => (
                <span className={styles.confettiPiece} key={`${place.id}-confetti-${luckyRunCount}-${index}`} />
              ))}
            </div>
          ) : null}
          {compactCards ? (
            <span className={styles.compactStatusLabel}>
              {getRestaurantStatusLabel(place.status)}
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
          <div className={styles.foodIdentity}>
            {types.map((type) => (
              <span className={styles.typePill} key={type.id}>
                <span aria-hidden="true">{type.emoji}</span>
                <span>{type.name}</span>
              </span>
            ))}
            {primaryMealType ? (
              <span
                className={styles.mealPill}
                title={place.mealTypes.map((mealType) => mealLabel(mealType)).join(', ')}
              >
                {primaryMealType}
              </span>
            ) : null}
            {areas.map((area) => (
              <span className={styles.areaPill} key={area}>{area}</span>
            ))}
          </div>
          <span>
            <a className={styles.subHeading} href={place.url} target="_blank" rel="noreferrer">
              {place.name}
            </a>
          </span>
          {options.distanceText ? (
            <span className={styles.distanceMeta} aria-label={`Distance: ${options.distanceText}`}>
              {options.distanceText}
            </span>
          ) : null}
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
                  {canShowOnMap ? (
                    <button
                      type="button"
                      className={styles.editButton}
                      onClick={() => showRestaurantOnMap(place)}
                    >
                      Show on Map
                    </button>
                  ) : null}
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

          {!compactCards && (canShowOnMap || canEditRestaurants || canDeleteRestaurants) ? (
            <div className={`${styles.cardActions} ${options.draggable ? styles.boardCardActions : ''}`}>
              {canShowOnMap ? (
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={() => showRestaurantOnMap(place)}
                >
                  Show on Map
                </button>
              ) : null}
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
              {canEditRestaurants && canBackfillRestaurantLocation(place) ? (
                <LocationBackfillDebugForm restaurantId={place.id} />
              ) : null}
            </div>
          ) : null}
        </div>
      );
    },
    [
      canDeleteRestaurants,
      canEditRestaurants,
      activeLuckyConfettiId,
      compactCards,
      expandedCompactCardIds,
      highlightedRestaurantId,
      luckyRestaurantId,
      luckyRunCount,
      shouldIgnoreCompactCardToggle,
      showRestaurantOnMap,
      toggleCompactCardExpansion,
      category
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
                    <label htmlFor="category">{effectiveViewMode === 'kanban' ? 'Group By:' : 'Arrange By:'}</label>
                    <select
                      value={filterCategory}
                      disabled={effectiveViewMode === 'map'}
                      onChange={(event) => {
                        const nextCategory = event.target.value as CategoryFilter;
                        if (
                          effectiveViewMode !== 'list' &&
                          (nextCategory === 'recentlyAdded' || nextCategory === 'distance')
                        ) {
                          setViewMode('list');
                        }

                        setCategory(nextCategory);
                        if (nextCategory === 'distance') {
                          requestUserLocation('visible-area');
                        }
                      }}
                    >
                      <option value="area">
                        {categoryOptionAreaLabel}
                      </option>
                      <option value="type">Type of Food</option>
                      <option value="recentlyAdded">Date Added</option>
                      <option value="distance">Nearest</option>
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
                <label htmlFor="viewMode">View:</label>
                <div className={styles.viewModeControls}>
                  <select
                    id="viewMode"
                    value={effectiveViewMode === 'map' && !hasMappedVisibleRestaurants ? 'list' : effectiveViewMode}
                    onChange={(event) => handleViewModeChange(event.target.value as ViewMode)}
                  >
                    <option value="list">List</option>
                    <option value="map" disabled={!hasMappedVisibleRestaurants}>
                      Map
                    </option>
                    <option value="kanban">Kanban</option>
                  </select>
                  {effectiveViewMode === 'map' && hasMappedVisibleRestaurants ? (
                    <>
                      <select
                        aria-label="Map labels"
                        value={mapLabelMode}
                        onChange={(event) => setMapLabelMode(event.target.value as MapLabelMode)}
                      >
                        <option value="emoji">Emoji Labels</option>
                        <option value="emojiName">Emoji + Name</option>
                        <option value="none">No Labels</option>
                      </select>
                      <button
                        type="button"
                        className={`${styles.compactToggle} ${styles.mapLocationButton}`}
                        onClick={() => requestUserLocation()}
                        disabled={isLocatingUser}
                      >
                        {isLocatingUser ? 'Refreshing...' : userLocation ? 'Refresh location' : 'Centre on me'}
                      </button>
                    </>
                  ) : (
                    <label className={styles.compactToggle}>
                      <input
                        type="checkbox"
                        checked={compactCards}
                        onChange={(event) => setCompactCards(event.target.checked)}
                      />
                      <span>Compact Cards</span>
                    </label>
                  )}
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
                  {filterCategory !== 'recentlyAdded' && filterCategory !== 'distance' && headings.length > 1 ? (
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
                        {filterCategory === 'area' ? `Filter ${filterEntityLabelPlural}` : 'Filter Types'} ({filterButtonStateLabel})
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
                                  {filterCategory === 'type'
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
            {isSearchActive ? (
              <div className={styles.searchSummary} aria-live="polite">
                <div className={styles.searchSummaryTitle}>Searching for “{searchQuery.trim()}”</div>
                <div className={styles.searchSummaryMeta}>
                  {visibleSearchResultCount === 1 ? '1 restaurant found' : `${visibleSearchResultCount} restaurants found`}
                </div>
              </div>
            ) : null}
            {boardErrorMessage ? <div className={styles.boardError}>{boardErrorMessage}</div> : null}
            {effectiveViewMode === 'map' && hasMappedVisibleRestaurants ? (
              <div className={`${styles.mapView} ${styles.resultsMotion}`}>
                {locationErrorMessage ? <div className={styles.inlineMapError}>{locationErrorMessage}</div> : null}
                {mapLoadErrorMessage ? <div className={styles.inlineMapError}>{mapLoadErrorMessage}</div> : null}
                <div className={styles.embeddedGoogleMap} ref={googleMapContainerRef} />
              </div>
            ) : effectiveViewMode === 'kanban' && boardCategory !== null ? (
              <div className={`${styles.kanbanBoard} ${styles.resultsMotion}`} key={`kanban-${resultsMotionKey}`}>
                {boardLanes.length === 0 ? (
                  renderNoResultsState('kanban')
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
              <div
                className={`${styles.placesContainer} ${styles.resultsMotion} ${
                  isSearchActive ? styles.searchPlacesContainer : ''
                }`}
                key={`list-${resultsMotionKey}`}
              >
                {grouped.size === 0 ? (
                  renderNoResultsState('list')
                ) : (
                  [...grouped.entries()].map(([heading, places]) => (
                    <Fragment key={heading}>
                      <span className={styles.heading}>
                        {category === 'type' ? `${places[0]?.types.find((type) => type.name === heading)?.emoji ?? ''} ` : ''}
                        {category === 'recentlyAdded' ? getMonthHeadingLabel(heading) : heading}
                      </span>
                      {category === 'distance' && !userLocation ? (
                        <div className={styles.inlineMapError}>
                          Share your location to sort places by distance.
                        </div>
                      ) : null}
                      <div>
                        {places
                          .slice()
                          .sort((a, b) => {
                            if (category === 'recentlyAdded') {
                              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                            }

                            if (category === 'distance') {
                              const distanceA = getRestaurantDistanceInKm(a, userLocation);
                              const distanceB = getRestaurantDistanceInKm(b, userLocation);
                              if (distanceA === null && distanceB === null) {
                                return a.name.localeCompare(b.name);
                              }

                              if (distanceA === null) {
                                return 1;
                              }

                              if (distanceB === null) {
                                return -1;
                              }

                              return distanceA - distanceB || a.name.localeCompare(b.name);
                            }

                            return a.name.localeCompare(b.name);
                          })
                          .map((place) =>
                            renderRestaurantCard(place, {
                              distanceText: category === 'distance'
                                ? formatDistance(getRestaurantDistanceInKm(place, userLocation))
                                : null,
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
              setCreateErrorMessage(null);
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
            <div className={styles.createDialogOverlay} onClick={closeCreateDialog}>
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
                {createErrorMessage ? <div className={styles.boardError}>{createErrorMessage}</div> : null}
                <form onSubmit={handleCreateRestaurantSubmit}>
                  <RestaurantFormFields
                    countries={createTools.countries}
                    cities={createTools.cities}
                    types={createTools.types}
                    areaSuggestionsByCity={areaSuggestionsByCity}
                    disableAreasUntilCitySelected
                    keyPrefix="root-create-restaurant"
                    submitLabel={isCreatingRestaurant ? 'Creating...' : 'Create restaurant'}
                    disableSubmit={createTools.cities.length === 0 || isCreatingRestaurant}
                    preferGoogleMapsFirst
                    defaults={{
                      cityId: boardCreatePreset?.defaults.cityId ?? createDefaultCityId,
                      areas: boardCreatePreset?.defaults.areas,
                      mealTypes: boardCreatePreset?.defaults.mealTypes ?? createDefaultMealTypes,
                      status: boardCreatePreset?.defaults.status ?? createDefaultStatus
                    }}
                    lockedFields={boardCreatePreset?.lockedFields}
                    onDirtyChange={setCreateDialogHasUnsavedChanges}
                    showDevelopmentPopulateButton={process.env.NODE_ENV !== 'production'}
                    validationErrorMessage={createErrorMessage}
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
        <div className={styles.createDialogOverlay} onClick={closeEditRestaurantDialog}>
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
                countries={adminTools.countries}
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
                  googlePlaceId: editingRestaurant.googlePlaceId,
                  address: editingRestaurant.address,
                  latitude: editingRestaurant.latitude,
                  longitude: editingRestaurant.longitude,
                  locations: editingRestaurant.locations.map((location) => ({
                    id: location.id,
                    label: location.label ?? '',
                    address: location.address ?? '',
                    googlePlaceId: location.googlePlaceId ?? '',
                    googleMapsUrl: location.googleMapsUrl ?? '',
                    latitude: location.latitude,
                    longitude: location.longitude
                  })),
                  status: editingRestaurant.status,
                  dislikedReason: editingRestaurant.dislikedReason
                }}
                onDirtyChange={setEditDialogHasUnsavedChanges}
                validationErrorMessage={rootEditErrorMessage}
              />
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
