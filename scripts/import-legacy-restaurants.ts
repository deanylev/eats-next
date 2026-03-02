import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { closeDb, getDb } from '@/lib/db';
import {
  cities,
  countries,
  restaurantAreas,
  restaurantMeals,
  restaurants,
  restaurantToTypes,
  restaurantTypes
} from '@/lib/schema';
import type { MealType } from '@/lib/schema';

type LegacyPlace = {
  area?: string | string[];
  mealType: string | string[];
  name: string;
  notes: string;
  referrerUrl?: string | (() => unknown);
  type: string | string[];
  url: string;
};

type LegacyPlaces = Record<string, Record<string, LegacyPlace[]>>;

const mealTypeMap: Record<string, MealType> = {
  snacc: 'snack',
  breakfast: 'breakfast',
  lunch: 'lunch',
  'sopper time': 'dinner'
};

const parseObjectLiteral = (source: string, variableName: string): string => {
  const declarationIndex = source.indexOf(`const ${variableName} =`);
  if (declarationIndex < 0) {
    throw new Error(`Could not find variable "${variableName}" in legacy HTML.`);
  }

  const equalsIndex = source.indexOf('=', declarationIndex);
  if (equalsIndex < 0) {
    throw new Error(`Could not find assignment for "${variableName}".`);
  }

  let startIndex = source.indexOf('{', equalsIndex);
  if (startIndex < 0) {
    throw new Error(`Could not find object start for "${variableName}".`);
  }

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i++) {
    const char = source[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (!inDouble && !inTemplate && char === '\'') {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && !inTemplate && char === '"') {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && char === '`') {
      inTemplate = !inTemplate;
      continue;
    }

    if (inSingle || inDouble || inTemplate) {
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  throw new Error(`Could not parse object literal for "${variableName}".`);
};

const parseAssignedExpression = (source: string, variableName: string): string => {
  const declarationIndex = source.indexOf(`const ${variableName} =`);
  if (declarationIndex < 0) {
    throw new Error(`Could not find variable "${variableName}" in legacy HTML.`);
  }

  const equalsIndex = source.indexOf('=', declarationIndex);
  if (equalsIndex < 0) {
    throw new Error(`Could not find assignment for "${variableName}".`);
  }

  const startIndex = equalsIndex + 1;

  let depthParen = 0;
  let depthCurly = 0;
  let depthSquare = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i++) {
    const char = source[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (!inDouble && !inTemplate && char === '\'') {
      inSingle = !inSingle;
      continue;
    }

    if (!inSingle && !inTemplate && char === '"') {
      inDouble = !inDouble;
      continue;
    }

    if (!inSingle && !inDouble && char === '`') {
      inTemplate = !inTemplate;
      continue;
    }

    if (inSingle || inDouble || inTemplate) {
      continue;
    }

    if (char === '(') {
      depthParen += 1;
      continue;
    }

    if (char === ')') {
      depthParen -= 1;
      continue;
    }

    if (char === '{') {
      depthCurly += 1;
      continue;
    }

    if (char === '}') {
      depthCurly -= 1;
      continue;
    }

    if (char === '[') {
      depthSquare += 1;
      continue;
    }

    if (char === ']') {
      depthSquare -= 1;
      continue;
    }

    if (char === ';' && depthParen === 0 && depthCurly === 0 && depthSquare === 0) {
      return source.slice(startIndex, i).trim();
    }
  }

  throw new Error(`Could not parse assigned expression for "${variableName}".`);
};

const parseAssignedExpressionOrDefault = (source: string, variableName: string, fallback: string): string => {
  try {
    return parseAssignedExpression(source, variableName);
  } catch {
    return fallback;
  }
};

const evaluateExpression = <T>(expression: string, scope: Record<string, unknown> = {}): T => {
  const names = Object.keys(scope);
  const values = Object.values(scope);
  const result = new Function(...names, `return (${expression});`)(...values);
  return result as T;
};

const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const normalizeMealTypes = (mealType: string | string[]): MealType[] => {
  const mapped = asArray(mealType)
    .map((entry) => mealTypeMap[entry.trim().toLowerCase()])
    .filter((entry): entry is MealType => Boolean(entry));

  return [...new Set(mapped)];
};

const normalizeAreas = (area: string | string[] | undefined): string[] =>
  [...new Set(asArray(area).map((entry) => entry.trim()).filter((entry) => entry.length > 0))];

const normalizeTypes = (type: string | string[]): string[] =>
  [...new Set(asArray(type).map((entry) => entry.trim()).filter((entry) => entry.length > 0))];

const referredByValue = (referrerUrl: LegacyPlace['referrerUrl']): string => {
  if (typeof referrerUrl === 'string' && referrerUrl.trim().length > 0) {
    return referrerUrl.trim();
  }

  if (typeof referrerUrl === 'function') {
    const globalScope = globalThis as typeof globalThis & {
      confirm?: (message?: string) => boolean;
    };
    const previousConfirm = globalScope.confirm;
    let capturedConfirmMessage = '';

    try {
      // Legacy source sometimes uses () => confirm('...') as a lightweight note popup.
      globalScope.confirm = (message?: string) => {
        capturedConfirmMessage = String(message ?? '').trim();
        return true;
      };
      const result = referrerUrl();
      if (capturedConfirmMessage.length > 0) {
        return capturedConfirmMessage;
      }

      if (result === null || result === undefined || typeof result === 'boolean') {
        return '';
      }

      return String(result).trim();
    } catch {
      return '';
    } finally {
      globalScope.confirm = previousConfirm;
    }
  }

  return '';
};

const cityKey = (countryId: string, cityName: string): string => `${countryId}::${cityName.toLowerCase()}`;

const normalizeTextKey = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const normalizeUrlKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\/+$/g, '');

const restaurantKey = (cityId: string, name: string, url: string): string =>
  `${cityId}::${name.toLowerCase()}::${url.toLowerCase()}`;

const restaurantNameKey = (cityId: string, name: string): string =>
  `${cityId}::${name.toLowerCase()}`;

const legacyRestaurantKey = (countryName: string, cityName: string, name: string, url: string): string =>
  `${countryName.toLowerCase()}::${cityName.toLowerCase()}::${name.toLowerCase()}::${url.toLowerCase()}`;

const legacyRestaurantCityNameKey = (countryName: string, cityName: string, name: string): string =>
  `${countryName.toLowerCase()}::${cityName.toLowerCase()}::${name.toLowerCase()}`;

const legacyRestaurantNameUrlKey = (name: string, url: string): string =>
  `${name.toLowerCase()}::${url.toLowerCase()}`;

const legacyRestaurantNormalizedCityNameKey = (countryName: string, cityName: string, name: string): string =>
  `${normalizeTextKey(countryName)}::${normalizeTextKey(cityName)}::${normalizeTextKey(name)}`;

const legacyRestaurantNormalizedNameUrlKey = (name: string, url: string): string =>
  `${normalizeTextKey(name)}::${normalizeUrlKey(url)}`;

type GitFileCommit = {
  hash: string;
  committedAt: Date;
};

const getGitRepoRoot = (targetPath: string): string | null => {
  try {
    return execFileSync('git', ['-C', path.dirname(targetPath), 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8'
    }).trim();
  } catch {
    return null;
  }
};

const getGitCommitsForFile = (repoRoot: string, absoluteFilePath: string): GitFileCommit[] => {
  const relativePath = path.relative(repoRoot, absoluteFilePath);
  if (!relativePath || relativePath.startsWith('..')) {
    return [];
  }

  try {
    const output = execFileSync(
      'git',
      ['-C', repoRoot, 'log', '--all', '--follow', '--reverse', '--format=%H\t%cI', '--', relativePath],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
    );
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [hash, committedAt] = line.split('\t');
        return {
          hash,
          committedAt: new Date(committedAt)
        };
      })
      .filter((entry) => !Number.isNaN(entry.committedAt.getTime()));
  } catch {
    return [];
  }
};

const getFileContentAtCommit = (repoRoot: string, relativePath: string, hash: string): string | null => {
  try {
    return execFileSync('git', ['-C', repoRoot, 'show', `${hash}:${relativePath}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024
    });
  } catch {
    return null;
  }
};

const setEarliestDate = (map: Map<string, Date>, key: string, candidate: Date): void => {
  const existing = map.get(key);
  if (!existing || candidate.getTime() < existing.getTime()) {
    map.set(key, candidate);
  }
};

const pickEarliestDate = (...candidates: Array<Date | undefined>): Date | undefined => {
  let earliest: Date | undefined;
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if (!earliest || candidate.getTime() < earliest.getTime()) {
      earliest = candidate;
    }
  }

  return earliest;
};

const extractLegacyRestaurantKeys = (html: string): Set<string> => {
  const emojisByTypeLiteral = parseObjectLiteral(html, 'emojisByType');
  const globalPlacesExpression = parseAssignedExpressionOrDefault(html, 'globalPlaces', '{}');
  const triedPlacesLiteral = parseObjectLiteral(html, 'triedPlaces');
  const wantedPlacesLiteral = parseObjectLiteral(html, 'wantedPlaces');

  const emojisByType = evaluateExpression<Record<string, string>>(emojisByTypeLiteral);
  const globalPlaces = evaluateExpression<Record<string, LegacyPlace>>(globalPlacesExpression);
  const triedPlaces = evaluateExpression<LegacyPlaces>(triedPlacesLiteral, { globalPlaces, emojisByType });
  const wantedPlaces = evaluateExpression<LegacyPlaces>(wantedPlacesLiteral, { globalPlaces, emojisByType });

  const keys = new Set<string>();
  const collect = (collection: LegacyPlaces) => {
    for (const [countryName, countryCities] of Object.entries(collection)) {
      for (const [cityName, places] of Object.entries(countryCities)) {
        for (const place of places) {
          const trimmedName = place.name?.trim();
          const trimmedUrl = place.url?.trim();
          if (!trimmedName || !trimmedUrl) {
            continue;
          }

          keys.add(legacyRestaurantKey(countryName, cityName, trimmedName, trimmedUrl));
        }
      }
    }
  };

  collect(triedPlaces);
  collect(wantedPlaces);
  return keys;
};

type LegacyCreatedAtMaps = {
  byCountryCityNameUrl: Map<string, Date>;
  byCountryCityName: Map<string, Date>;
  byNormalizedName: Map<string, Date>;
  byNameUrl: Map<string, Date>;
  byNormalizedCountryCityName: Map<string, Date>;
  byNormalizedNameUrl: Map<string, Date>;
};

const extractLegacyRestaurantIdentities = (
  html: string
): {
  byCountryCityNameUrl: Set<string>;
  byCountryCityName: Set<string>;
  byNormalizedName: Set<string>;
  byNameUrl: Set<string>;
  byNormalizedCountryCityName: Set<string>;
  byNormalizedNameUrl: Set<string>;
} => {
  const emojisByTypeLiteral = parseAssignedExpressionOrDefault(html, 'emojisByType', '{}');
  const globalPlacesExpression = parseAssignedExpressionOrDefault(html, 'globalPlaces', '{}');

  const emojisByType = evaluateExpression<Record<string, string>>(emojisByTypeLiteral);
  const globalPlaces = evaluateExpression<Record<string, LegacyPlace>>(globalPlacesExpression);

  const byCountryCityNameUrl = new Set<string>();
  const byCountryCityName = new Set<string>();
  const byNormalizedName = new Set<string>();
  const byNameUrl = new Set<string>();
  const byNormalizedCountryCityName = new Set<string>();
  const byNormalizedNameUrl = new Set<string>();

  const collectPlace = (countryName: string, cityName: string, place: LegacyPlace) => {
    const trimmedName = place.name?.trim();
    if (!trimmedName) {
      return;
    }

    byCountryCityName.add(legacyRestaurantCityNameKey(countryName, cityName, trimmedName));
    byNormalizedName.add(normalizeTextKey(trimmedName));
    byNormalizedCountryCityName.add(
      legacyRestaurantNormalizedCityNameKey(countryName, cityName, trimmedName)
    );

    const trimmedUrl = place.url?.trim();
    if (trimmedUrl) {
      byCountryCityNameUrl.add(legacyRestaurantKey(countryName, cityName, trimmedName, trimmedUrl));
      byNameUrl.add(legacyRestaurantNameUrlKey(trimmedName, trimmedUrl));
      byNormalizedNameUrl.add(legacyRestaurantNormalizedNameUrlKey(trimmedName, trimmedUrl));
    }
  };

  const collect = (collection: LegacyPlaces) => {
    for (const [countryName, countryCities] of Object.entries(collection)) {
      for (const [cityName, places] of Object.entries(countryCities)) {
        for (const place of places) {
          collectPlace(countryName, cityName, place);
        }
      }
    }
  };

  let collectedAny = false;
  try {
    const triedPlacesLiteral = parseObjectLiteral(html, 'triedPlaces');
    const wantedPlacesLiteral = parseObjectLiteral(html, 'wantedPlaces');
    const triedPlaces = evaluateExpression<LegacyPlaces>(triedPlacesLiteral, { globalPlaces, emojisByType });
    const wantedPlaces = evaluateExpression<LegacyPlaces>(wantedPlacesLiteral, { globalPlaces, emojisByType });
    collect(triedPlaces);
    collect(wantedPlaces);
    collectedAny = true;
  } catch {
    // Older legacy formats did not use triedPlaces/wantedPlaces.
  }

  if (!collectedAny) {
    try {
      const placesByCityLiteral = parseObjectLiteral(html, 'placesByCity');
      const placesByCity = evaluateExpression<Record<string, LegacyPlace[]>>(placesByCityLiteral, {
        globalPlaces,
        emojisByType
      });
      for (const [cityName, places] of Object.entries(placesByCity)) {
        for (const place of places) {
          collectPlace('Australia', cityName, place);
        }
      }
    } catch {
      // No recognized legacy places structure in this commit.
    }
  }

  return {
    byCountryCityNameUrl,
    byCountryCityName,
    byNormalizedName,
    byNameUrl,
    byNormalizedCountryCityName,
    byNormalizedNameUrl
  };
};

const buildLegacyCreatedAtMap = (legacyHtmlPath: string): LegacyCreatedAtMaps => {
  const repoRoot = getGitRepoRoot(legacyHtmlPath);
  if (!repoRoot) {
    return {
      byCountryCityNameUrl: new Map(),
      byCountryCityName: new Map(),
      byNormalizedName: new Map(),
      byNameUrl: new Map(),
      byNormalizedCountryCityName: new Map(),
      byNormalizedNameUrl: new Map()
    };
  }

  const relativePath = path.relative(repoRoot, legacyHtmlPath);
  if (!relativePath || relativePath.startsWith('..')) {
    return {
      byCountryCityNameUrl: new Map(),
      byCountryCityName: new Map(),
      byNormalizedName: new Map(),
      byNameUrl: new Map(),
      byNormalizedCountryCityName: new Map(),
      byNormalizedNameUrl: new Map()
    };
  }

  const commits = getGitCommitsForFile(repoRoot, legacyHtmlPath);
  if (commits.length === 0) {
    return {
      byCountryCityNameUrl: new Map(),
      byCountryCityName: new Map(),
      byNormalizedName: new Map(),
      byNameUrl: new Map(),
      byNormalizedCountryCityName: new Map(),
      byNormalizedNameUrl: new Map()
    };
  }

  const byCountryCityNameUrl = new Map<string, Date>();
  const byCountryCityName = new Map<string, Date>();
  const byNormalizedName = new Map<string, Date>();
  const byNameUrl = new Map<string, Date>();
  const byNormalizedCountryCityName = new Map<string, Date>();
  const byNormalizedNameUrl = new Map<string, Date>();

  for (const commit of commits) {
    const htmlAtCommit = getFileContentAtCommit(repoRoot, relativePath, commit.hash);
    if (!htmlAtCommit) {
      continue;
    }

    let identitiesInCommit: ReturnType<typeof extractLegacyRestaurantIdentities>;
    try {
      identitiesInCommit = extractLegacyRestaurantIdentities(htmlAtCommit);
    } catch {
      continue;
    }

    for (const key of identitiesInCommit.byCountryCityNameUrl) {
      setEarliestDate(byCountryCityNameUrl, key, commit.committedAt);
    }

    for (const key of identitiesInCommit.byCountryCityName) {
      setEarliestDate(byCountryCityName, key, commit.committedAt);
    }

    for (const key of identitiesInCommit.byNameUrl) {
      setEarliestDate(byNameUrl, key, commit.committedAt);
    }

    for (const key of identitiesInCommit.byNormalizedName) {
      setEarliestDate(byNormalizedName, key, commit.committedAt);
    }

    for (const key of identitiesInCommit.byNormalizedCountryCityName) {
      setEarliestDate(byNormalizedCountryCityName, key, commit.committedAt);
    }

    for (const key of identitiesInCommit.byNormalizedNameUrl) {
      setEarliestDate(byNormalizedNameUrl, key, commit.committedAt);
    }
  }

  return {
    byCountryCityNameUrl,
    byCountryCityName,
    byNormalizedName,
    byNameUrl,
    byNormalizedCountryCityName,
    byNormalizedNameUrl
  };
};

async function main() {
  const db = getDb();
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Missing path to legacy index.html. Usage: pnpm import:legacy /absolute/path/to/index.html');
  }

  const legacyHtmlPath = path.resolve(inputPath);
  const html = await fs.readFile(legacyHtmlPath, 'utf8');
  const legacyCreatedAtMaps = buildLegacyCreatedAtMap(legacyHtmlPath);

  const emojisByTypeLiteral = parseObjectLiteral(html, 'emojisByType');
  const globalPlacesExpression = parseAssignedExpressionOrDefault(html, 'globalPlaces', '{}');
  const triedPlacesLiteral = parseObjectLiteral(html, 'triedPlaces');
  const wantedPlacesLiteral = parseObjectLiteral(html, 'wantedPlaces');

  const emojisByType = evaluateExpression<Record<string, string>>(emojisByTypeLiteral);
  const globalPlaces = evaluateExpression<Record<string, LegacyPlace>>(globalPlacesExpression);
  const triedPlaces = evaluateExpression<LegacyPlaces>(triedPlacesLiteral, { globalPlaces });
  const wantedPlaces = evaluateExpression<LegacyPlaces>(wantedPlacesLiteral, { globalPlaces });

  const existingCountries = await db.select().from(countries);
  const existingCities = await db.select().from(cities);
  const existingTypes = await db.select().from(restaurantTypes);
  const existingRestaurants = await db.select().from(restaurants);

  const countriesByName = new Map(existingCountries.map((entry) => [entry.name.toLowerCase(), entry.id]));
  const citiesByCountryAndName = new Map(existingCities.map((entry) => [cityKey(entry.countryId, entry.name), entry.id]));
  const typesByName = new Map(existingTypes.map((entry) => [entry.name.toLowerCase(), entry.id]));
  const restaurantsByIdentity = new Map<string, { id: string; createdAt: Date | null }>(
    existingRestaurants
      .filter((entry) => entry.deletedAt === null)
      .map((entry) => [restaurantKey(entry.cityId, entry.name, entry.url), { id: entry.id, createdAt: entry.createdAt }])
  );
  const restaurantsByName = new Map<string, { id: string; createdAt: Date | null }>(
    existingRestaurants
      .filter((entry) => entry.deletedAt === null)
      .map((entry) => [restaurantNameKey(entry.cityId, entry.name), { id: entry.id, createdAt: entry.createdAt }])
  );

  let createdCountries = 0;
  let createdCities = 0;
  let createdTypes = 0;
  let createdRestaurants = 0;
  let skippedRestaurants = 0;
  let backfilledCreatedAtCount = 0;
  let updatedExistingCreatedAtCount = 0;
  let restaurantsMissingGitCreatedAt = 0;
  let restaurantsWithGitCreatedAtMatch = 0;
  let postPassUpdatedCreatedAtCount = 0;
  let postPassNoMatchCount = 0;
  const postPassNoMatchSamples: string[] = [];

  const ensureCountry = async (countryName: string): Promise<string> => {
    const key = countryName.toLowerCase();
    const existing = countriesByName.get(key);
    if (existing) {
      return existing;
    }

    const inserted = await db
      .insert(countries)
      .values({ name: countryName })
      .returning({ id: countries.id });
    const id = inserted[0]?.id;
    if (!id) {
      throw new Error(`Failed to create country: ${countryName}`);
    }

    countriesByName.set(key, id);
    createdCountries += 1;
    return id;
  };

  const ensureCity = async (countryId: string, cityName: string): Promise<string> => {
    const key = cityKey(countryId, cityName);
    const existing = citiesByCountryAndName.get(key);
    if (existing) {
      return existing;
    }

    const inserted = await db
      .insert(cities)
      .values({ countryId, name: cityName })
      .returning({ id: cities.id });
    const id = inserted[0]?.id;
    if (!id) {
      throw new Error(`Failed to create city: ${cityName}`);
    }

    citiesByCountryAndName.set(key, id);
    createdCities += 1;
    return id;
  };

  const ensureType = async (typeName: string): Promise<string> => {
    const key = typeName.toLowerCase();
    const existing = typesByName.get(key);
    if (existing) {
      return existing;
    }

    const emoji = emojisByType[typeName];
    if (!emoji) {
      throw new Error(`Missing emoji mapping for type "${typeName}" in emojisByType.`);
    }

    const inserted = await db
      .insert(restaurantTypes)
      .values({ name: typeName, emoji })
      .returning({ id: restaurantTypes.id });
    const id = inserted[0]?.id;
    if (!id) {
      throw new Error(`Failed to create type: ${typeName}`);
    }

    typesByName.set(key, id);
    createdTypes += 1;
    return id;
  };

  const importCollection = async (collection: LegacyPlaces, status: 'liked' | 'untried') => {
    for (const [countryName, countryCities] of Object.entries(collection)) {
      const countryId = await ensureCountry(countryName);

      for (const [cityName, places] of Object.entries(countryCities)) {
        const cityId = await ensureCity(countryId, cityName);

        for (const place of places) {
          const normalizedMealTypes = normalizeMealTypes(place.mealType);
          const normalizedTypeNames = normalizeTypes(place.type);
          const normalizedAreas = normalizeAreas(place.area);
          const trimmedName = place.name?.trim();
          const trimmedNotes = place.notes?.trim();
          const trimmedUrl = place.url?.trim();

          if (!trimmedName || !trimmedNotes || !trimmedUrl) {
            skippedRestaurants += 1;
            continue;
          }

          if (normalizedMealTypes.length === 0 || normalizedTypeNames.length === 0) {
            skippedRestaurants += 1;
            continue;
          }

          const key = restaurantKey(cityId, trimmedName, trimmedUrl);
          const byNameKey = restaurantNameKey(cityId, trimmedName);
          const createdAt = pickEarliestDate(
            legacyCreatedAtMaps.byCountryCityNameUrl.get(legacyRestaurantKey(countryName, cityName, trimmedName, trimmedUrl)),
            legacyCreatedAtMaps.byCountryCityName.get(legacyRestaurantCityNameKey(countryName, cityName, trimmedName)),
            legacyCreatedAtMaps.byNameUrl.get(legacyRestaurantNameUrlKey(trimmedName, trimmedUrl)),
            legacyCreatedAtMaps.byNormalizedCountryCityName.get(
              legacyRestaurantNormalizedCityNameKey(countryName, cityName, trimmedName)
            ),
            legacyCreatedAtMaps.byNormalizedName.get(normalizeTextKey(trimmedName)),
            legacyCreatedAtMaps.byNormalizedNameUrl.get(
              legacyRestaurantNormalizedNameUrlKey(trimmedName, trimmedUrl)
            )
          );
          if (createdAt) {
            restaurantsWithGitCreatedAtMatch += 1;
          } else {
            restaurantsMissingGitCreatedAt += 1;
          }
          const existingRestaurant = restaurantsByIdentity.get(key) ?? restaurantsByName.get(byNameKey);
          if (existingRestaurant) {
            if (createdAt) {
              const existingCreatedAtTime = existingRestaurant.createdAt
                ? new Date(existingRestaurant.createdAt).getTime()
                : Number.NaN;
              const nextCreatedAtTime = createdAt.getTime();

              if (Number.isNaN(existingCreatedAtTime) || existingCreatedAtTime !== nextCreatedAtTime) {
                await db
                  .update(restaurants)
                  .set({ createdAt })
                  .where(eq(restaurants.id, existingRestaurant.id));
                updatedExistingCreatedAtCount += 1;
              }
            }

            skippedRestaurants += 1;
            continue;
          }

          const typeIds: string[] = [];
          for (const typeName of normalizedTypeNames) {
            typeIds.push(await ensureType(typeName));
          }

          const insertedRestaurantId = await db.transaction(async (tx) => {
            const inserted = await tx
              .insert(restaurants)
              .values({
                cityId,
                name: trimmedName,
                notes: trimmedNotes,
                referredBy: referredByValue(place.referrerUrl),
                url: trimmedUrl,
                status,
                createdAt: createdAt ?? undefined,
                triedAt: status === 'untried' ? null : new Date()
              })
              .returning({ id: restaurants.id });
            const restaurantId = inserted[0]?.id;
            if (!restaurantId) {
              throw new Error(`Failed to create restaurant: ${trimmedName}`);
            }

            if (normalizedAreas.length > 0) {
              await tx.insert(restaurantAreas).values(
                normalizedAreas.map((area) => ({
                  restaurantId,
                  area
                }))
              );
            }

            await tx.insert(restaurantMeals).values(
              normalizedMealTypes.map((mealType) => ({
                restaurantId,
                mealType
              }))
            );

            await tx.insert(restaurantToTypes).values(
              [...new Set(typeIds)].map((restaurantTypeId) => ({
                restaurantId,
                restaurantTypeId
              }))
            );

            return restaurantId;
          });

          restaurantsByIdentity.set(key, { id: insertedRestaurantId, createdAt: createdAt ?? new Date() });
          restaurantsByName.set(byNameKey, { id: insertedRestaurantId, createdAt: createdAt ?? new Date() });
          if (createdAt) {
            backfilledCreatedAtCount += 1;
          }
          createdRestaurants += 1;
        }
      }
    }
  };

  await importCollection(triedPlaces, 'liked');
  await importCollection(wantedPlaces, 'untried');

  const existingRestaurantsForBackfill = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      url: restaurants.url,
      createdAt: restaurants.createdAt,
      cityName: cities.name,
      countryName: countries.name
    })
    .from(restaurants)
    .innerJoin(cities, eq(cities.id, restaurants.cityId))
    .innerJoin(countries, eq(countries.id, cities.countryId))
    .where(isNull(restaurants.deletedAt));

  for (const existing of existingRestaurantsForBackfill) {
    const matchedCreatedAt = pickEarliestDate(
      legacyCreatedAtMaps.byCountryCityNameUrl.get(
        legacyRestaurantKey(existing.countryName, existing.cityName, existing.name, existing.url)
      ),
      legacyCreatedAtMaps.byCountryCityName.get(
        legacyRestaurantCityNameKey(existing.countryName, existing.cityName, existing.name)
      ),
      legacyCreatedAtMaps.byNameUrl.get(legacyRestaurantNameUrlKey(existing.name, existing.url)),
      legacyCreatedAtMaps.byNormalizedCountryCityName.get(
        legacyRestaurantNormalizedCityNameKey(existing.countryName, existing.cityName, existing.name)
      ),
      legacyCreatedAtMaps.byNormalizedName.get(normalizeTextKey(existing.name)),
      legacyCreatedAtMaps.byNormalizedNameUrl.get(
        legacyRestaurantNormalizedNameUrlKey(existing.name, existing.url)
      )
    );

    if (!matchedCreatedAt) {
      postPassNoMatchCount += 1;
      if (postPassNoMatchSamples.length < 15) {
        postPassNoMatchSamples.push(`${existing.countryName} / ${existing.cityName} / ${existing.name}`);
      }
      continue;
    }

    const existingCreatedAtTime = existing.createdAt ? new Date(existing.createdAt).getTime() : Number.NaN;
    const nextCreatedAtTime = matchedCreatedAt.getTime();
    if (!Number.isNaN(existingCreatedAtTime) && existingCreatedAtTime === nextCreatedAtTime) {
      continue;
    }

    await db
      .update(restaurants)
      .set({ createdAt: matchedCreatedAt })
      .where(and(eq(restaurants.id, existing.id), isNull(restaurants.deletedAt)));
    postPassUpdatedCreatedAtCount += 1;
  }

  console.log(`Legacy import complete from ${legacyHtmlPath}`);
  console.log(`Created countries: ${createdCountries}`);
  console.log(`Created cities: ${createdCities}`);
  console.log(`Created restaurant types: ${createdTypes}`);
  console.log(`Created restaurants: ${createdRestaurants}`);
  console.log(`Skipped restaurants: ${skippedRestaurants}`);
  console.log(`Restaurants with createdAt from git history: ${backfilledCreatedAtCount}`);
  console.log(`Existing restaurants updated with createdAt from git history: ${updatedExistingCreatedAtCount}`);
  console.log(`Restaurants matched to a git createdAt: ${restaurantsWithGitCreatedAtMatch}`);
  console.log(`Restaurants missing git createdAt match: ${restaurantsMissingGitCreatedAt}`);
  console.log(`Existing restaurants updated in post-pass: ${postPassUpdatedCreatedAtCount}`);
  console.log(`Existing restaurants with no git match in post-pass: ${postPassNoMatchCount}`);
  if (postPassNoMatchSamples.length > 0) {
    console.log('Sample no-match restaurants:');
    for (const sample of postPassNoMatchSamples) {
      console.log(`  - ${sample}`);
    }
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await closeDb();
    process.exit(1);
  });
