import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { closeDb, getDb } from '@/lib/db';
import { cities, countries, restaurants, tenants } from '@/lib/schema';

type LegacyPlace = {
  name: string;
};

type LegacyPlaces = Record<string, Record<string, LegacyPlace[]>>;

type ParsedLegacyRestaurant = {
  countryName: string;
  cityName: string;
  place: LegacyPlace;
};

type ParsedLegacyData = {
  triedRestaurants: ParsedLegacyRestaurant[];
  wantedRestaurants: ParsedLegacyRestaurant[];
};

type DiffEntry = {
  key: string;
  label: string;
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

const normalizeTextKey = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

const compareAlpha = (left: string, right: string): number =>
  left.localeCompare(right, 'en', { sensitivity: 'base' });

const buildRestaurantKey = (countryName: string, cityName: string, name: string): string =>
  `${normalizeTextKey(countryName)}::${normalizeTextKey(cityName)}::${normalizeTextKey(name)}`;

const buildRestaurantLabel = (countryName: string, cityName: string, name: string): string =>
  `${name} (${cityName}, ${countryName})`;

const collectLegacyRestaurants = (collection: LegacyPlaces): ParsedLegacyRestaurant[] => {
  const entries: ParsedLegacyRestaurant[] = [];

  for (const [countryName, countryCities] of Object.entries(collection)) {
    for (const [cityName, places] of Object.entries(countryCities)) {
      for (const place of places) {
        entries.push({
          countryName,
          cityName,
          place
        });
      }
    }
  }

  return entries;
};

const parseLegacyData = (html: string): ParsedLegacyData => {
  const emojisByTypeLiteral = parseAssignedExpressionOrDefault(html, 'emojisByType', '{}');
  const globalPlacesExpression = parseAssignedExpressionOrDefault(html, 'globalPlaces', '{}');
  const emojisByType = evaluateExpression<Record<string, string>>(emojisByTypeLiteral);
  const globalPlaces = evaluateExpression<Record<string, LegacyPlace>>(globalPlacesExpression);

  try {
    const triedPlacesLiteral = parseObjectLiteral(html, 'triedPlaces');
    const wantedPlacesLiteral = parseObjectLiteral(html, 'wantedPlaces');
    const triedPlaces = evaluateExpression<LegacyPlaces>(triedPlacesLiteral, { globalPlaces, emojisByType });
    const wantedPlaces = evaluateExpression<LegacyPlaces>(wantedPlacesLiteral, { globalPlaces, emojisByType });

    return {
      triedRestaurants: collectLegacyRestaurants(triedPlaces),
      wantedRestaurants: collectLegacyRestaurants(wantedPlaces)
    };
  } catch {
    const placesByCityLiteral = parseObjectLiteral(html, 'placesByCity');
    const placesByCity = evaluateExpression<Record<string, LegacyPlace[]>>(placesByCityLiteral, {
      globalPlaces,
      emojisByType
    });

    const wantedRestaurants: ParsedLegacyRestaurant[] = [];
    for (const [cityName, places] of Object.entries(placesByCity)) {
      for (const place of places) {
        wantedRestaurants.push({
          countryName: 'Australia',
          cityName,
          place
        });
      }
    }

    return {
      triedRestaurants: [],
      wantedRestaurants
    };
  }
};

const toEntryMap = (restaurantsToMap: Array<{ countryName: string; cityName: string; name: string }>): Map<string, DiffEntry> => {
  const entries = new Map<string, DiffEntry>();

  for (const restaurant of restaurantsToMap) {
    const trimmedName = restaurant.name.trim();
    if (!trimmedName) {
      continue;
    }

    const key = buildRestaurantKey(restaurant.countryName, restaurant.cityName, trimmedName);
    if (!entries.has(key)) {
      entries.set(key, {
        key,
        label: buildRestaurantLabel(restaurant.countryName, restaurant.cityName, trimmedName)
      });
    }
  }

  return entries;
};

const printDiffSection = (title: string, htmlEntries: Map<string, DiffEntry>, dbEntries: Map<string, DiffEntry>): void => {
  const onlyInHtml = [...htmlEntries.values()]
    .filter((entry) => !dbEntries.has(entry.key))
    .sort((left, right) => compareAlpha(left.label, right.label));
  const onlyInDb = [...dbEntries.values()]
    .filter((entry) => !htmlEntries.has(entry.key))
    .sort((left, right) => compareAlpha(left.label, right.label));

  console.log(title);
  console.log(`  Only in index.html: ${onlyInHtml.length}`);
  for (const entry of onlyInHtml) {
    console.log(`    - ${entry.label}`);
  }

  console.log(`  Only in DB: ${onlyInDb.length}`);
  for (const entry of onlyInDb) {
    console.log(`    - ${entry.label}`);
  }

  console.log('');
};

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Missing path to legacy index.html. Usage: pnpm diff:legacy /absolute/path/to/index.html');
  }

  const legacyHtmlPath = path.resolve(inputPath);
  const html = await fs.readFile(legacyHtmlPath, 'utf8');
  const legacyData = parseLegacyData(html);

  const db = getDb();
  const rootTenant = await db.query.tenants.findFirst({
    where: eq(tenants.isRoot, true)
  });
  if (!rootTenant?.id) {
    throw new Error('Could not resolve root tenant.');
  }

  const dbRestaurants = await db
    .select({
      name: restaurants.name,
      status: restaurants.status,
      cityName: cities.name,
      countryName: countries.name
    })
    .from(restaurants)
    .innerJoin(cities, eq(restaurants.cityId, cities.id))
    .innerJoin(countries, eq(cities.countryId, countries.id))
    .where(and(eq(restaurants.tenantId, rootTenant.id), isNull(restaurants.deletedAt)));

  const legacyWantedMap = toEntryMap(
    legacyData.wantedRestaurants.map((restaurant) => ({
      countryName: restaurant.countryName,
      cityName: restaurant.cityName,
      name: restaurant.place.name
    }))
  );
  const legacyLikedMap = toEntryMap(
    legacyData.triedRestaurants.map((restaurant) => ({
      countryName: restaurant.countryName,
      cityName: restaurant.cityName,
      name: restaurant.place.name
    }))
  );

  const dbWantedMap = toEntryMap(
    dbRestaurants
      .filter((restaurant) => restaurant.status === 'untried')
      .map((restaurant) => ({
        countryName: restaurant.countryName,
        cityName: restaurant.cityName,
        name: restaurant.name
      }))
  );
  const dbLikedMap = toEntryMap(
    dbRestaurants
      .filter((restaurant) => restaurant.status === 'liked')
      .map((restaurant) => ({
        countryName: restaurant.countryName,
        cityName: restaurant.cityName,
        name: restaurant.name
      }))
  );

  console.log(`Legacy diff report for ${legacyHtmlPath}`);
  console.log('');
  printDiffSection('Want To Try', legacyWantedMap, dbWantedMap);
  printDiffSection('Liked', legacyLikedMap, dbLikedMap);
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
