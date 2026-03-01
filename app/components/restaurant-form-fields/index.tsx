'use client';

import { useMemo, useRef, useState } from 'react';

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
  areaSuggestionsByCity?: Record<string, string[]>;
  disableAreasUntilCitySelected?: boolean;
  defaults?: RestaurantFormDefaults;
  submitLabel: string;
  disableSubmit?: boolean;
  keyPrefix: string;
};

export function RestaurantFormFields({
  cities,
  types,
  areaSuggestionsByCity,
  disableAreasUntilCitySelected = false,
  defaults,
  submitLabel,
  disableSubmit = false,
  keyPrefix
}: RestaurantFormFieldsProps) {
  const selectedTypeIds = new Set(defaults?.typeIds ?? []);
  const selectedMealTypes = new Set(defaults?.mealTypes ?? []);
  const [selectedCityId, setSelectedCityId] = useState<string>(defaults?.cityId ?? '');
  const [areasValue, setAreasValue] = useState<string>(defaults?.areas?.join('\n') ?? '');
  const [status, setStatus] = useState<RestaurantStatus>(defaults?.status ?? 'untried');
  const [showAreaSuggestions, setShowAreaSuggestions] = useState<boolean>(true);
  const areasRef = useRef<HTMLTextAreaElement | null>(null);
  const areaSuggestionsForCity = useMemo(
    () => areaSuggestionsByCity?.[selectedCityId] ?? [],
    [areaSuggestionsByCity, selectedCityId]
  );
  const typedAreas = useMemo(() => {
    return new Set(
      areasValue
        .split('\n')
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0)
    );
  }, [areasValue]);
  const currentAreaDraft = useMemo(() => {
    if (!areasValue) {
      return '';
    }

    const selectionStart = areasRef.current?.selectionStart ?? areasValue.length;
    const textBeforeCursor = areasValue.slice(0, selectionStart);
    const draft = textBeforeCursor.split('\n').at(-1);
    return draft?.trim().toLowerCase() ?? '';
  }, [areasValue]);
  const filteredAreaSuggestions = useMemo(() => {
    if (!selectedCityId) {
      return [];
    }

    return areaSuggestionsForCity
      .filter((area) => {
        const normalizedArea = area.trim().toLowerCase();
        if (normalizedArea.length === 0 || typedAreas.has(normalizedArea)) {
          return false;
        }
        if (currentAreaDraft.length === 0) {
          return true;
        }
        return normalizedArea.startsWith(currentAreaDraft);
      })
      .slice(0, 8);
  }, [areaSuggestionsForCity, currentAreaDraft, selectedCityId, typedAreas]);

  const handleAreaSuggestionClick = (area: string): void => {
    const textarea = areasRef.current;
    const text = textarea?.value ?? areasValue;
    const cursorPosition = textarea?.selectionStart ?? text.length;
    const currentLineStart = text.lastIndexOf('\n', Math.max(cursorPosition - 1, 0)) + 1;
    const currentLineEndRaw = text.indexOf('\n', cursorPosition);
    const currentLineEnd = currentLineEndRaw === -1 ? text.length : currentLineEndRaw;
    const nextValue = `${text.slice(0, currentLineStart)}${area}${text.slice(currentLineEnd)}`;
    const nextCursorPosition = currentLineStart + area.length;

    setShowAreaSuggestions(false);
    setAreasValue(nextValue);

    requestAnimationFrame(() => {
      if (!areasRef.current) {
        return;
      }

      areasRef.current.focus();
      areasRef.current.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  };

  return (
    <>
      <label>
        City
        <select
          name="cityId"
          required
          value={selectedCityId}
          onChange={(event) => {
            setSelectedCityId(event.target.value);
            setShowAreaSuggestions(true);
          }}
        >
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
          ref={areasRef}
          name="areas"
          rows={4}
          value={areasValue}
          onChange={(event) => {
            setAreasValue(event.target.value);
            setShowAreaSuggestions(true);
          }}
          disabled={disableAreasUntilCitySelected && selectedCityId.length === 0}
          placeholder={disableAreasUntilCitySelected && selectedCityId.length === 0 ? 'Select a city first' : ''}
          aria-describedby={`${keyPrefix}-areas-help`}
        />
      </label>
      <small id={`${keyPrefix}-areas-help`}>
        If fewer than 2 areas are entered, URL must be Google Maps. If 2+ areas, URL must not be Google Maps.
      </small>
      {showAreaSuggestions &&
      selectedCityId &&
      currentAreaDraft.length > 0 &&
      filteredAreaSuggestions.length > 0 ? (
        <div className="area-autosuggest">
          <span>Suggestions:</span>
          <div className="inline-options">
            {filteredAreaSuggestions.map((area) => (
              <button
                type="button"
                key={`${keyPrefix}-area-suggestion-${area}`}
                className="area-suggestion"
                onClick={() => handleAreaSuggestionClick(area)}
              >
                {area}
              </button>
            ))}
          </div>
        </div>
      ) : null}

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
