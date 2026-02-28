import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
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

const restaurantKey = (cityId: string, name: string, url: string): string =>
  `${cityId}::${name.toLowerCase()}::${url.toLowerCase()}`;

async function main() {
  const db = getDb();
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error('Missing path to legacy index.html. Usage: pnpm import:legacy /absolute/path/to/index.html');
  }

  const legacyHtmlPath = path.resolve(inputPath);
  const html = await fs.readFile(legacyHtmlPath, 'utf8');

  const emojisByTypeLiteral = parseObjectLiteral(html, 'emojisByType');
  const globalPlacesExpression = parseAssignedExpression(html, 'globalPlaces');
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
  const restaurantIdentity = new Set(
    existingRestaurants.map((entry) => restaurantKey(entry.cityId, entry.name, entry.url))
  );

  let createdCountries = 0;
  let createdCities = 0;
  let createdTypes = 0;
  let createdRestaurants = 0;
  let skippedRestaurants = 0;

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
          if (restaurantIdentity.has(key)) {
            skippedRestaurants += 1;
            continue;
          }

          const typeIds: string[] = [];
          for (const typeName of normalizedTypeNames) {
            typeIds.push(await ensureType(typeName));
          }

          await db.transaction(async (tx) => {
            const inserted = await tx
              .insert(restaurants)
              .values({
                cityId,
                name: trimmedName,
                notes: trimmedNotes,
                referredBy: referredByValue(place.referrerUrl),
                url: trimmedUrl,
                status,
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
          });

          restaurantIdentity.add(key);
          createdRestaurants += 1;
        }
      }
    }
  };

  await importCollection(triedPlaces, 'liked');
  await importCollection(wantedPlaces, 'untried');

  console.log(`Legacy import complete from ${legacyHtmlPath}`);
  console.log(`Created countries: ${createdCountries}`);
  console.log(`Created cities: ${createdCities}`);
  console.log(`Created restaurant types: ${createdTypes}`);
  console.log(`Created restaurants: ${createdRestaurants}`);
  console.log(`Skipped restaurants: ${skippedRestaurants}`);
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
