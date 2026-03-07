import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { and, eq } from 'drizzle-orm';
import { closeDb, getDb } from '@/lib/db';
import {
  cities,
  countries,
  restaurantAreas,
  restaurantMeals,
  restaurants,
  restaurantToTypes,
  restaurantTypes,
  tenants
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

type GitFileCommit = {
  hash: string;
  committedAt: Date;
};

type ParsedLegacyRestaurant = {
  countryName: string;
  cityName: string;
  place: LegacyPlace;
};

type RemovedLegacyRestaurant = {
  countryName: string;
  cityName: string;
  place: LegacyPlace;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

type ParsedLegacyData = {
  emojisByType: Record<string, string>;
  restaurants: ParsedLegacyRestaurant[];
};

type RemovedLegacyImportCandidate = {
  restaurant: RemovedLegacyRestaurant;
  emojisByType: Record<string, string>;
};

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

  const startIndex = source.indexOf('{', equalsIndex);
  if (startIndex < 0) {
    throw new Error(`Could not find object start for "${variableName}".`);
  }

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

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
        return source.slice(startIndex, index + 1);
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

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

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
      return source.slice(startIndex, index).trim();
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

const normalizeTextKey = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const removedRestaurantKey = (countryName: string, cityName: string, name: string): string =>
  `${normalizeTextKey(countryName)}::${normalizeTextKey(cityName)}::${normalizeTextKey(name)}`;

const removedRestaurantCityKey = (cityName: string, name: string): string =>
  `${normalizeTextKey(cityName)}::${normalizeTextKey(name)}`;

const cityLookupKey = (countryId: string, cityName: string): string => `${countryId}::${cityName.toLowerCase()}`;

const restaurantLookupKey = (cityId: string, name: string): string => `${cityId}::${name.toLowerCase()}`;

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

const parseLegacyData = (html: string): ParsedLegacyData => {
  const emojisByTypeLiteral = parseAssignedExpressionOrDefault(html, 'emojisByType', '{}');
  const globalPlacesExpression = parseAssignedExpressionOrDefault(html, 'globalPlaces', '{}');
  const emojisByType = evaluateExpression<Record<string, string>>(emojisByTypeLiteral);
  const globalPlaces = evaluateExpression<Record<string, LegacyPlace>>(globalPlacesExpression);

  const entries: ParsedLegacyRestaurant[] = [];
  const pushCollection = (collection: LegacyPlaces) => {
    for (const [countryName, countryCities] of Object.entries(collection)) {
      for (const [cityName, places] of Object.entries(countryCities)) {
        for (const place of places) {
          entries.push({ countryName, cityName, place });
        }
      }
    }
  };

  let parsedAny = false;
  try {
    const triedPlacesLiteral = parseObjectLiteral(html, 'triedPlaces');
    const wantedPlacesLiteral = parseObjectLiteral(html, 'wantedPlaces');
    const triedPlaces = evaluateExpression<LegacyPlaces>(triedPlacesLiteral, { globalPlaces, emojisByType });
    const wantedPlaces = evaluateExpression<LegacyPlaces>(wantedPlacesLiteral, { globalPlaces, emojisByType });
    pushCollection(triedPlaces);
    pushCollection(wantedPlaces);

    try {
      const noGoodPlacesLiteral = parseObjectLiteral(html, 'noGoodPlaces');
      const noGoodPlaces = evaluateExpression<LegacyPlaces>(noGoodPlacesLiteral, { globalPlaces, emojisByType });
      pushCollection(noGoodPlaces);
    } catch {
      // Older formats did not have explicit disliked places.
    }

    parsedAny = true;
  } catch {
    // Older legacy formats did not use triedPlaces/wantedPlaces.
  }

  if (!parsedAny) {
    const placesByCityLiteral = parseObjectLiteral(html, 'placesByCity');
    const placesByCity = evaluateExpression<Record<string, LegacyPlace[]>>(placesByCityLiteral, {
      globalPlaces,
      emojisByType
    });
    for (const [cityName, places] of Object.entries(placesByCity)) {
      for (const place of places) {
        entries.push({
          countryName: 'Australia',
          cityName,
          place
        });
      }
    }
  }

  return {
    emojisByType,
    restaurants: entries
  };
};

const getRemovedLegacyRestaurants = async (legacyHtmlPath: string): Promise<RemovedLegacyImportCandidate[]> => {
  const currentHtml = await fs.readFile(legacyHtmlPath, 'utf8');
  const currentRestaurants = parseLegacyData(currentHtml).restaurants;
  const currentKeys = new Set(
    currentRestaurants.map((entry) => removedRestaurantKey(entry.countryName, entry.cityName, entry.place.name))
  );
  const currentCityKeys = new Set(
    currentRestaurants.map((entry) => removedRestaurantCityKey(entry.cityName, entry.place.name))
  );

  const repoRoot = getGitRepoRoot(legacyHtmlPath);
  if (!repoRoot) {
    throw new Error('Could not locate git repository for legacy HTML file.');
  }

  const relativePath = path.relative(repoRoot, legacyHtmlPath);
  if (!relativePath || relativePath.startsWith('..')) {
    throw new Error('Legacy HTML file must be inside the git repository.');
  }

  const commits = getGitCommitsForFile(repoRoot, legacyHtmlPath);
  if (commits.length === 0) {
    return [];
  }

  const historicalRestaurants = new Map<string, RemovedLegacyRestaurant>();
  const historicalEmojisByType = new Map<string, string>();

  for (const commit of commits) {
    const htmlAtCommit = getFileContentAtCommit(repoRoot, relativePath, commit.hash);
    if (!htmlAtCommit) {
      continue;
    }

    let parsedLegacyData: ParsedLegacyData;
    try {
      parsedLegacyData = parseLegacyData(htmlAtCommit);
    } catch {
      continue;
    }

    for (const [typeName, emoji] of Object.entries(parsedLegacyData.emojisByType)) {
      const trimmedTypeName = typeName.trim();
      const trimmedEmoji = emoji.trim();
      if (trimmedTypeName.length === 0 || trimmedEmoji.length === 0) {
        continue;
      }

      historicalEmojisByType.set(trimmedTypeName.toLowerCase(), trimmedEmoji);
    }

    for (const entry of parsedLegacyData.restaurants) {
      const trimmedName = entry.place.name?.trim();
      if (!trimmedName) {
        continue;
      }

      const key = removedRestaurantKey(entry.countryName, entry.cityName, trimmedName);
      const existing = historicalRestaurants.get(key);
      if (!existing) {
        historicalRestaurants.set(key, {
          countryName: entry.countryName,
          cityName: entry.cityName,
          place: entry.place,
          firstSeenAt: commit.committedAt,
          lastSeenAt: commit.committedAt
        });
        continue;
      }

      if (commit.committedAt.getTime() < existing.firstSeenAt.getTime()) {
        existing.firstSeenAt = commit.committedAt;
      }

      if (commit.committedAt.getTime() >= existing.lastSeenAt.getTime()) {
        existing.lastSeenAt = commit.committedAt;
        existing.place = entry.place;
        existing.countryName = entry.countryName;
        existing.cityName = entry.cityName;
      }
    }
  }

  const emojisByType = Object.fromEntries(historicalEmojisByType);

  return [...historicalRestaurants.entries()]
    .filter(([key, value]) => {
      if (currentKeys.has(key)) {
        return false;
      }

      return !currentCityKeys.has(removedRestaurantCityKey(value.cityName, value.place.name));
    })
    .map(([, value]) => ({
      restaurant: value,
      emojisByType
    }))
    .sort((left, right) => right.restaurant.lastSeenAt.getTime() - left.restaurant.lastSeenAt.getTime());
};

const formatDate = (date: Date): string =>
  new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'medium'
  }).format(date);

async function main() {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('This script must be run in an interactive terminal.');
  }

  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Missing path to legacy index.html. Usage: pnpm import:legacy:removed /absolute/path/to/index.html');
  }

  const legacyHtmlPath = path.resolve(inputPath);
  const removedRestaurants = await getRemovedLegacyRestaurants(legacyHtmlPath);
  if (removedRestaurants.length === 0) {
    console.log(`No removed legacy restaurants found in git history for ${legacyHtmlPath}.`);
    return;
  }

  const db = getDb();
  const existingRootTenant = await db.query.tenants.findFirst({
    where: eq(tenants.isRoot, true)
  });
  const rootTenant =
    existingRootTenant ??
    (
      await db
        .insert(tenants)
        .values({
          isRoot: true,
          displayName: 'Dean',
          subdomain: null,
          adminUsername: null,
          adminPasswordHash: null
        })
        .returning({ id: tenants.id })
    )[0];

  if (!rootTenant?.id) {
    throw new Error('Could not resolve root tenant.');
  }

  const tenantId = rootTenant.id;
  const existingCountries = await db.select().from(countries).where(eq(countries.tenantId, tenantId));
  const existingCities = await db.select().from(cities).where(eq(cities.tenantId, tenantId));
  const existingTypes = await db.select().from(restaurantTypes).where(eq(restaurantTypes.tenantId, tenantId));
  const existingRestaurants = await db.select().from(restaurants).where(eq(restaurants.tenantId, tenantId));

  const countriesByName = new Map(existingCountries.map((entry) => [entry.name.toLowerCase(), entry.id]));
  const citiesByName = new Map(existingCities.map((entry) => [cityLookupKey(entry.countryId, entry.name), entry.id]));
  const typesByName = new Map(existingTypes.map((entry) => [entry.name.toLowerCase(), entry.id]));
  const restaurantsByName = new Map(
    existingRestaurants.map((entry) => [restaurantLookupKey(entry.cityId, entry.name), entry.id])
  );

  let createdCountries = 0;
  let createdCities = 0;
  let createdTypes = 0;
  let createdDislikedRestaurants = 0;
  let skippedAlreadyExisting = 0;
  let skippedNotTried = 0;
  let skippedIncomplete = 0;
  let aborted = false;

  const ensureCountry = async (countryName: string): Promise<string> => {
    const key = countryName.toLowerCase();
    const existing = countriesByName.get(key);
    if (existing) {
      return existing;
    }

    const inserted = await db
      .insert(countries)
      .values({
        tenantId,
        name: countryName
      })
      .returning({ id: countries.id });
    const countryId = inserted[0]?.id;
    if (!countryId) {
      throw new Error(`Failed to create country: ${countryName}`);
    }

    countriesByName.set(key, countryId);
    createdCountries += 1;
    return countryId;
  };

  const ensureCity = async (countryId: string, cityName: string): Promise<string> => {
    const key = cityLookupKey(countryId, cityName);
    const existing = citiesByName.get(key);
    if (existing) {
      return existing;
    }

    const inserted = await db
      .insert(cities)
      .values({
        tenantId,
        countryId,
        name: cityName
      })
      .returning({ id: cities.id });
    const cityId = inserted[0]?.id;
    if (!cityId) {
      throw new Error(`Failed to create city: ${cityName}`);
    }

    citiesByName.set(key, cityId);
    createdCities += 1;
    return cityId;
  };

  const ensureType = async (typeName: string, emojisByType: Record<string, string>): Promise<string> => {
    const key = typeName.toLowerCase();
    const existing = typesByName.get(key);
    if (existing) {
      return existing;
    }

    const emoji = emojisByType[typeName.toLowerCase()];
    if (!emoji) {
      throw new Error(`Missing emoji mapping for type "${typeName}" in legacy HTML history.`);
    }

    const inserted = await db
      .insert(restaurantTypes)
      .values({
        tenantId,
        name: typeName,
        emoji
      })
      .returning({ id: restaurantTypes.id });
    const typeId = inserted[0]?.id;
    if (!typeId) {
      throw new Error(`Failed to create type: ${typeName}`);
    }

    typesByName.set(key, typeId);
    createdTypes += 1;
    return typeId;
  };

  const readline = createInterface({ input, output });

  try {
    for (const candidate of removedRestaurants) {
      const removed = candidate.restaurant;
      const trimmedName = removed.place.name?.trim();
      const trimmedNotes = removed.place.notes?.trim();
      let trimmedUrl = removed.place.url?.trim() ?? '';
      const normalizedMeals = normalizeMealTypes(removed.place.mealType);
      const normalizedAreas = normalizeAreas(removed.place.area);
      const normalizedTypeNames = normalizeTypes(removed.place.type);

      if (!trimmedName || !trimmedNotes || normalizedMeals.length === 0 || normalizedTypeNames.length === 0) {
        skippedIncomplete += 1;
        continue;
      }

      const countryId = await ensureCountry(removed.countryName);
      const cityId = await ensureCity(countryId, removed.cityName);
      const existingRestaurantId = restaurantsByName.get(restaurantLookupKey(cityId, trimmedName));
      if (existingRestaurantId) {
        skippedAlreadyExisting += 1;
        continue;
      }

      console.log('');
      console.log(`${trimmedName} (${removed.cityName}, ${removed.countryName})`);
      console.log(`First seen: ${formatDate(removed.firstSeenAt)}`);
      console.log(`Last seen: ${formatDate(removed.lastSeenAt)}`);
      console.log(`Meal types: ${normalizedMeals.join(', ')}`);
      console.log(`Types: ${normalizedTypeNames.join(', ')}`);
      if (normalizedAreas.length > 0) {
        console.log(`Areas: ${normalizedAreas.join(', ')}`);
      }
      console.log(`URL: ${trimmedUrl || '(missing in legacy data)'}`);
      console.log(`Notes: ${trimmedNotes}`);

      const dislikedReason = (
        await readline.question('Why did you not like it? (leave blank if you did not try it, q to quit) ')
      ).trim();
      if (dislikedReason.toLowerCase() === 'q' || dislikedReason.toLowerCase() === 'quit') {
        aborted = true;
        break;
      }

      if (dislikedReason.length === 0) {
        skippedNotTried += 1;
        continue;
      }

      if (!trimmedUrl) {
        trimmedUrl = (
          await readline.question('Legacy URL missing. Enter a URL for this restaurant (leave blank to skip): ')
        ).trim();
        if (trimmedUrl.length === 0) {
          skippedIncomplete += 1;
          continue;
        }
      }

      const typeIds: string[] = [];
      for (const typeName of normalizedTypeNames) {
        typeIds.push(await ensureType(typeName, candidate.emojisByType));
      }

      const insertedRestaurantId = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(restaurants)
          .values({
            tenantId,
            cityId,
            name: trimmedName,
            notes: trimmedNotes,
            referredBy: referredByValue(removed.place.referrerUrl),
            url: trimmedUrl,
            status: 'disliked',
            dislikedReason,
            createdAt: removed.firstSeenAt,
            triedAt: removed.lastSeenAt
          })
          .returning({ id: restaurants.id });
        const restaurantId = inserted[0]?.id;
        if (!restaurantId) {
          throw new Error(`Failed to create disliked restaurant: ${trimmedName}`);
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
          normalizedMeals.map((mealType) => ({
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

      restaurantsByName.set(restaurantLookupKey(cityId, trimmedName), insertedRestaurantId);
      createdDislikedRestaurants += 1;
    }
  } finally {
    readline.close();
  }

  console.log('');
  console.log(`Removed legacy restaurant import complete from ${legacyHtmlPath}`);
  console.log(`Candidates found: ${removedRestaurants.length}`);
  console.log(`Created countries: ${createdCountries}`);
  console.log(`Created cities: ${createdCities}`);
  console.log(`Created restaurant types: ${createdTypes}`);
  console.log(`Created disliked restaurants: ${createdDislikedRestaurants}`);
  console.log(`Skipped because already existed: ${skippedAlreadyExisting}`);
  console.log(`Skipped because not tried: ${skippedNotTried}`);
  console.log(`Skipped because legacy data was incomplete: ${skippedIncomplete}`);
  console.log(`Aborted early: ${aborted ? 'yes' : 'no'}`);
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
