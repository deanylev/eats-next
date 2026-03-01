'use client';

import { useState } from 'react';

type MealType = 'snack' | 'breakfast' | 'lunch' | 'dinner';
type RestaurantStatus = 'untried' | 'liked' | 'disliked';

const mealTypeChoices: MealType[] = ['snack', 'breakfast', 'lunch', 'dinner'];
const statusChoices: RestaurantStatus[] = ['untried', 'liked', 'disliked'];
const mealTypeLabel: Record<MealType, string> = {
  snack: 'Snack',
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner'
};
const statusLabel: Record<RestaurantStatus, string> = {
  untried: 'Want to Try',
  liked: 'Liked',
  disliked: 'Disliked'
};

type RestaurantFormDefaults = {
  cityId?: string;
  areas?: string[];
  mealTypes?: string[];
  name?: string;
  notes?: string;
  referredBy?: string;
  typeIds?: string[];
  url?: string;
  status?: RestaurantStatus;
  dislikedReason?: string | null;
};

type RestaurantFormFieldsProps = {
  cities: Array<{ id: string; name: string; countryName: string }>;
  types: Array<{ id: string; name: string; emoji: string }>;
  defaults?: RestaurantFormDefaults;
  submitLabel: string;
  disableSubmit?: boolean;
  keyPrefix: string;
};

export function RestaurantFormFields({
  cities,
  types,
  defaults,
  submitLabel,
  disableSubmit = false,
  keyPrefix
}: RestaurantFormFieldsProps) {
  const selectedTypeIds = new Set(defaults?.typeIds ?? []);
  const selectedMealTypes = new Set(defaults?.mealTypes ?? []);
  const [status, setStatus] = useState<RestaurantStatus>(defaults?.status ?? 'untried');

  return (
    <>
      <label>
        City
        <select name="cityId" required defaultValue={defaults?.cityId ? String(defaults.cityId) : ''}>
          <option value="" disabled>
            Select city
          </option>
          {cities.map((city) => (
            <option key={`${keyPrefix}-city-${city.id}`} value={city.id}>
              {city.name}, {city.countryName}
            </option>
          ))}
        </select>
      </label>

      <label>
        Areas (optional; one per line)
        <textarea
          name="areas"
          rows={4}
          defaultValue={defaults?.areas?.join('\n') ?? ''}
          aria-describedby={`${keyPrefix}-areas-help`}
        />
      </label>
      <small id={`${keyPrefix}-areas-help`}>
        If fewer than 2 areas are entered, URL must be Google Maps. If 2+ areas, URL must not be Google Maps.
      </small>

      <fieldset>
        <legend>Meal Types (pick 1 to 4)</legend>
        <div className="inline-options">
          {mealTypeChoices.map((mealType) => (
            <label key={`${keyPrefix}-meal-${mealType}`}>
              <input
                type="checkbox"
                name="mealTypes"
                value={mealType}
                defaultChecked={selectedMealTypes.has(mealType)}
              />
              {mealTypeLabel[mealType]}
            </label>
          ))}
        </div>
      </fieldset>

      <label>
        Name
        <input name="name" required defaultValue={defaults?.name ?? ''} />
      </label>

      <label>
        Notes
        <textarea name="notes" rows={4} required defaultValue={defaults?.notes ?? ''} />
      </label>

      <label>
        Referred by (URL or free text)
        <input name="referredBy" defaultValue={defaults?.referredBy ?? ''} />
      </label>

      <fieldset>
        <legend>Restaurant Types (pick at least 1)</legend>
        <div className="inline-options">
          {types.map((type) => (
            <label key={`${keyPrefix}-type-${type.id}`}>
              <input
                type="checkbox"
                name="typeIds"
                value={type.id}
                defaultChecked={selectedTypeIds.has(type.id)}
              />
              {type.emoji} {type.name}
            </label>
          ))}
        </div>
      </fieldset>

      <label>
        URL
        <input name="url" type="url" required defaultValue={defaults?.url ?? ''} />
      </label>

      <label>
        Status
        <select
          name="status"
          required
          defaultValue={defaults?.status ?? 'untried'}
          onChange={(event) => setStatus(event.target.value as RestaurantStatus)}
        >
          {statusChoices.map((status) => (
            <option key={`${keyPrefix}-status-${status}`} value={status}>
              {statusLabel[status]}
            </option>
          ))}
        </select>
      </label>

      {status === 'disliked' ? (
        <label>
          Disliked Reason
          <textarea name="dislikedReason" rows={3} required defaultValue={defaults?.dislikedReason ?? ''} />
        </label>
      ) : null}

      <button type="submit" disabled={disableSubmit}>
        {submitLabel}
      </button>
    </>
  );
}
