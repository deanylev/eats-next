'use client';

import { type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { buildCitySelectGroups, CitySelect } from '@/app/components/city-select';

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
  liked: 'Recommended',
  disliked: 'Not Recommended'
};

export type RestaurantFormDefaults = {
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

type RestaurantFormLockedFields = {
  areas?: boolean;
  city?: boolean;
  status?: boolean;
};

type RestaurantFormFieldsProps = {
  countries: Array<{ id: string; name: string }>;
  cities: Array<{ id: string; name: string; countryId: string; countryName: string }>;
  types: Array<{ id: string; name: string; emoji: string }>;
  areaSuggestionsByCity?: Record<string, string[]>;
  disableAreasUntilCitySelected?: boolean;
  defaults?: RestaurantFormDefaults;
  lockedFields?: RestaurantFormLockedFields;
  onDirtyChange?: (isDirty: boolean) => void;
  submitLabel: string;
  disableSubmit?: boolean;
  keyPrefix: string;
  showDevelopmentPopulateButton?: boolean;
};

const normalizeSetValues = (values: string[] | undefined): string[] => [...(values ?? [])].sort();

const areStringSetsEqual = (left: string[] | undefined, right: string[] | undefined): boolean => {
  const normalizedLeft = normalizeSetValues(left);
  const normalizedRight = normalizeSetValues(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

export function RestaurantFormFields({
  countries,
  cities,
  types,
  areaSuggestionsByCity,
  disableAreasUntilCitySelected = false,
  defaults,
  lockedFields,
  onDirtyChange,
  submitLabel,
  disableSubmit = false,
  keyPrefix,
  showDevelopmentPopulateButton = false
}: RestaurantFormFieldsProps) {
  const [availableCountries, setAvailableCountries] = useState(countries);
  const [availableCities, setAvailableCities] = useState(cities);
  const [availableTypes, setAvailableTypes] = useState(types);
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>(defaults?.typeIds ?? []);
  const [selectedMealTypes, setSelectedMealTypes] = useState<MealType[]>(
    (defaults?.mealTypes?.filter((mealType): mealType is MealType =>
      mealTypeChoices.includes(mealType as MealType)
    ) ?? []) as MealType[]
  );
  const [selectedCityId, setSelectedCityId] = useState<string>(defaults?.cityId ?? '');
  const [selectedAreas, setSelectedAreas] = useState<string[]>(defaults?.areas ?? []);
  const [newAreaValue, setNewAreaValue] = useState<string>('');
  const [status, setStatus] = useState<RestaurantStatus>(defaults?.status ?? 'untried');
  const [isLocationCreatorOpen, setIsLocationCreatorOpen] = useState<boolean>(false);
  const [newCountryName, setNewCountryName] = useState<string>('');
  const [selectedCountryIdForNewCity, setSelectedCountryIdForNewCity] = useState<string>(() => {
    const defaultCity = cities.find((city) => city.id === (defaults?.cityId ?? ''));
    return defaultCity?.countryId ?? countries[0]?.id ?? '';
  });
  const [newCityName, setNewCityName] = useState<string>('');
  const [isCreatingCountry, setIsCreatingCountry] = useState<boolean>(false);
  const [isCreatingCity, setIsCreatingCity] = useState<boolean>(false);
  const [newTypeName, setNewTypeName] = useState<string>('');
  const [newTypeEmoji, setNewTypeEmoji] = useState<string>('');
  const [isCreatingType, setIsCreatingType] = useState<boolean>(false);
  const [nameValue, setNameValue] = useState<string>(defaults?.name ?? '');
  const [notesValue, setNotesValue] = useState<string>(defaults?.notes ?? '');
  const [referredByValue, setReferredByValue] = useState<string>(defaults?.referredBy ?? '');
  const [urlValue, setUrlValue] = useState<string>(defaults?.url ?? '');
  const [dislikedReasonValue, setDislikedReasonValue] = useState<string>(defaults?.dislikedReason ?? '');
  const cityGroups = useMemo(
    () =>
      buildCitySelectGroups(
        availableCities.map((city) => ({
          countryName: city.countryName,
          name: city.name,
          value: city.id
        }))
      ),
    [availableCities]
  );
  const areaSuggestionsForCity = useMemo(
    () => areaSuggestionsByCity?.[selectedCityId] ?? [],
    [areaSuggestionsByCity, selectedCityId]
  );
  const lockedAreaLookup = useMemo(
    () =>
      new Set(
        (lockedFields?.areas ? defaults?.areas ?? [] : [])
          .map((area) => area.trim().toLowerCase())
          .filter((area) => area.length > 0)
      ),
    [defaults?.areas, lockedFields?.areas]
  );
  const selectedAreaLookup = useMemo(
    () => new Set(selectedAreas.map((area) => area.trim().toLowerCase()).filter((area) => area.length > 0)),
    [selectedAreas]
  );
  const availableAreaOptions = useMemo(() => {
    if (!selectedCityId) {
      return [];
    }

    return areaSuggestionsForCity.filter((area) => !selectedAreaLookup.has(area.trim().toLowerCase()));
  }, [areaSuggestionsForCity, selectedAreaLookup, selectedCityId]);
  const areasValue = useMemo(() => selectedAreas.join('\n'), [selectedAreas]);
  const normalizedNewCountryName = newCountryName.trim().toLowerCase();
  const isDuplicateNewCountryName =
    normalizedNewCountryName.length > 0 &&
    availableCountries.some((country) => country.name.trim().toLowerCase() === normalizedNewCountryName);
  const normalizedNewCityName = newCityName.trim().toLowerCase();
  const isDuplicateNewCityName =
    normalizedNewCityName.length > 0 &&
    availableCities.some(
      (city) =>
        city.countryId === selectedCountryIdForNewCity && city.name.trim().toLowerCase() === normalizedNewCityName
    );
  const normalizedNewTypeName = newTypeName.trim().toLowerCase();
  const isDuplicateNewTypeName =
    normalizedNewTypeName.length > 0 &&
    availableTypes.some((type) => type.name.trim().toLowerCase() === normalizedNewTypeName);
  const hasSelectedTypes = selectedTypeIds.length > 0;
  const isDirty = useMemo(() => {
    return (
      selectedCityId !== (defaults?.cityId ?? '') ||
      areasValue !== (defaults?.areas?.join('\n') ?? '') ||
      !areStringSetsEqual(selectedMealTypes, defaults?.mealTypes) ||
      nameValue !== (defaults?.name ?? '') ||
      notesValue !== (defaults?.notes ?? '') ||
      referredByValue !== (defaults?.referredBy ?? '') ||
      !areStringSetsEqual(selectedTypeIds, defaults?.typeIds) ||
      urlValue !== (defaults?.url ?? '') ||
      status !== (defaults?.status ?? 'untried') ||
      dislikedReasonValue !== (defaults?.dislikedReason ?? '') ||
      newCountryName.length > 0 ||
      newCityName.length > 0 ||
      newTypeName.length > 0 ||
      newTypeEmoji.length > 0
    );
  }, [
    areasValue,
    defaults?.areas,
    defaults?.cityId,
    defaults?.dislikedReason,
    defaults?.mealTypes,
    defaults?.name,
    defaults?.notes,
    defaults?.referredBy,
    defaults?.status,
    defaults?.typeIds,
    defaults?.url,
    dislikedReasonValue,
    nameValue,
    newCityName,
    newCountryName,
    newTypeEmoji,
    newTypeName,
    notesValue,
    referredByValue,
    selectedCityId,
    selectedMealTypes,
    selectedTypeIds,
    status,
    urlValue
  ]);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const toggleMealType = (mealType: MealType, checked: boolean): void => {
    setSelectedMealTypes((current) => {
      if (checked) {
        if (current.includes(mealType)) {
          return current;
        }

        return [...current, mealType];
      }

      return current.filter((entry) => entry !== mealType);
    });
  };

  const upsertType = (type: { id: string; name: string; emoji: string }): void => {
    setAvailableTypes((current) => {
      const next = current.some((existing) => existing.id === type.id)
        ? current.map((existing) => (existing.id === type.id ? type : existing))
        : [...current, type];

      return [...next].sort((left, right) => left.name.localeCompare(right.name));
    });
    setSelectedTypeIds((current) => (current.includes(type.id) ? current : [...current, type.id]));
  };

  const upsertCountry = (country: { id: string; name: string }): void => {
    setAvailableCountries((current) => {
      const next = current.some((existing) => existing.id === country.id)
        ? current.map((existing) => (existing.id === country.id ? country : existing))
        : [...current, country];

      return [...next].sort((left, right) => left.name.localeCompare(right.name));
    });
  };

  const upsertCity = (city: { id: string; name: string; countryId: string; countryName: string }): void => {
    setAvailableCities((current) => {
      const next = current.some((existing) => existing.id === city.id)
        ? current.map((existing) => (existing.id === city.id ? city : existing))
        : [...current, city];

      return [...next].sort((left, right) => {
        const countryComparison = left.countryName.localeCompare(right.countryName);
        if (countryComparison !== 0) {
          return countryComparison;
        }

        return left.name.localeCompare(right.name);
      });
    });
  };

  const handleCitySelectionChange = (value: string): void => {
    setSelectedCityId(value);

    const selectedCity = availableCities.find((city) => city.id === value);
    if (selectedCity) {
      setSelectedCountryIdForNewCity(selectedCity.countryId);
    }
  };

  const handleCreateCountry = async (): Promise<void> => {
    const trimmedName = newCountryName.trim();
    if (!trimmedName) {
      window.confirm('Country name is required.');
      return;
    }

    if (isDuplicateNewCountryName) {
      return;
    }

    setIsCreatingCountry(true);

    try {
      const response = await fetch('/api/countries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: trimmedName
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { country?: { id: string; name: string }; duplicate?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.country) {
        window.confirm(payload?.error ?? 'Something went wrong. Please try again.');
        return;
      }

      upsertCountry(payload.country);
      setSelectedCountryIdForNewCity(payload.country.id);

      if (payload.duplicate) {
        setNewCountryName(payload.country.name);
        return;
      }

      setNewCountryName('');
    } catch {
      window.confirm('Something went wrong. Please try again.');
    } finally {
      setIsCreatingCountry(false);
    }
  };

  const handleCreateCity = async (): Promise<void> => {
    const trimmedName = newCityName.trim();
    if (!selectedCountryIdForNewCity) {
      window.confirm('Pick a country first.');
      return;
    }

    if (!trimmedName) {
      window.confirm('City name is required.');
      return;
    }

    if (isDuplicateNewCityName) {
      return;
    }

    setIsCreatingCity(true);

    try {
      const response = await fetch('/api/cities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          countryId: selectedCountryIdForNewCity,
          name: trimmedName
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            city?: { countryId: string; countryName: string; id: string; name: string };
            duplicate?: boolean;
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.city) {
        window.confirm(payload?.error ?? 'Something went wrong. Please try again.');
        return;
      }

      upsertCity(payload.city);
      setSelectedCountryIdForNewCity(payload.city.countryId);
      setSelectedCityId(payload.city.id);

      if (payload.duplicate) {
        setNewCityName(payload.city.name);
        return;
      }

      setNewCityName('');
    } catch {
      window.confirm('Something went wrong. Please try again.');
    } finally {
      setIsCreatingCity(false);
    }
  };

  const handleCreateType = async (): Promise<void> => {
    const trimmedName = newTypeName.trim();
    const trimmedEmoji = newTypeEmoji.trim();
    if (!trimmedName) {
      window.confirm('Type name is required.');
      return;
    }

    if (!trimmedEmoji) {
      window.confirm('Emoji is required.');
      return;
    }

    if (isDuplicateNewTypeName) {
      return;
    }

    setIsCreatingType(true);

    try {
      const response = await fetch('/api/restaurant-types', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: trimmedName,
          emoji: trimmedEmoji
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { duplicate?: boolean; error?: string; type?: { emoji: string; id: string; name: string } }
        | null;

      if (!response.ok || !payload?.type) {
        window.confirm(payload?.error ?? 'Something went wrong. Please try again.');
        return;
      }

      upsertType(payload.type);

      if (payload.duplicate) {
        setNewTypeName(payload.type.name);
        setNewTypeEmoji(payload.type.emoji);
        return;
      }

      setNewTypeName('');
      setNewTypeEmoji('');
    } catch {
      window.confirm('Something went wrong. Please try again.');
    } finally {
      setIsCreatingType(false);
    }
  };

  const handleInlineTypeKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    if (isCreatingType) {
      return;
    }

    void handleCreateType();
  };

  const handleInlineCountryKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    if (isCreatingCountry) {
      return;
    }

    void handleCreateCountry();
  };

  const handleInlineCityKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    if (isCreatingCity) {
      return;
    }

    void handleCreateCity();
  };

  const addArea = (value: string): void => {
    const trimmedValue = value.trim();
    const normalizedValue = trimmedValue.toLowerCase();

    if (trimmedValue.length === 0 || selectedAreaLookup.has(normalizedValue)) {
      return;
    }

    setSelectedAreas((current) => [...current, trimmedValue]);
  };

  const removeArea = (value: string): void => {
    if (lockedAreaLookup.has(value.trim().toLowerCase())) {
      return;
    }

    setSelectedAreas((current) => current.filter((area) => area !== value));
  };

  const handleAddNewArea = (): void => {
    addArea(newAreaValue);
    setNewAreaValue('');
  };

  const handleNewAreaKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    handleAddNewArea();
  };

  const handlePopulateFakeValues = (): void => {
    const fakeCityId = selectedCityId || availableCities[0]?.id || '';
    const fakeTypeIds = hasSelectedTypes ? selectedTypeIds : availableTypes[0] ? [availableTypes[0].id] : [];
    const areaSuggestions = fakeCityId ? areaSuggestionsByCity?.[fakeCityId] ?? [] : [];
    const fakeAreas = areaSuggestions.slice(0, 2);
    const populatedAreas = fakeAreas.length >= 2 ? fakeAreas : ['CBD', 'North Side'];
    const fakeSuffix = Math.floor(Date.now() % 100000)
      .toString()
      .padStart(5, '0');

    setSelectedCityId(fakeCityId);
    setSelectedAreas(populatedAreas);
    setSelectedMealTypes(['lunch', 'dinner']);
    setNameValue(`Test Restaurant ${fakeSuffix}`);
    setNotesValue('Development-only seeded restaurant notes.');
    setReferredByValue('Local recommendation');
    setSelectedTypeIds(fakeTypeIds);
    setUrlValue(`https://example.com/restaurants/test-${fakeSuffix}/`);
    setStatus('untried');
    setDislikedReasonValue('');
    setNewAreaValue('');
  };

  return (
    <>
      <label>
        City
        {lockedFields?.city ? <input type="hidden" name="cityId" value={selectedCityId} /> : null}
        <CitySelect
          id={`${keyPrefix}-city`}
          name={lockedFields?.city ? undefined : 'cityId'}
          required={true}
          groups={cityGroups}
          value={selectedCityId}
          onChange={handleCitySelectionChange}
          disabled={lockedFields?.city}
        />
      </label>
      {!lockedFields?.city && (
        <div className="inline-location-toggle">
          <button
            type="button"
            className="location-toggle-button"
            aria-expanded={isLocationCreatorOpen}
            onClick={() => setIsLocationCreatorOpen((current) => !current)}
          >
            {isLocationCreatorOpen ? 'Hide' : 'Add new country or city'}
          </button>
        </div>
      )}
      {isLocationCreatorOpen ? (
        <div className="inline-type-creator">
          <div className="inline-location-creator-row">
            <input
              type="text"
              value={newCountryName}
              placeholder="New country name"
              onChange={(event) => setNewCountryName(event.target.value)}
              onKeyDown={handleInlineCountryKeyDown}
            />
            <button
              type="button"
              className="secondary-action-button"
              disabled={isCreatingCountry || newCountryName.trim().length === 0 || isDuplicateNewCountryName}
              onClick={() => {
                void handleCreateCountry();
              }}
            >
              {isCreatingCountry ? 'Adding…' : 'Add country'}
            </button>
          </div>
          <div className="inline-location-creator-row">
            <select
              value={selectedCountryIdForNewCity}
              onChange={(event) => setSelectedCountryIdForNewCity(event.target.value)}
              disabled={availableCountries.length === 0 || isCreatingCity}
            >
              <option value="" disabled>
                {availableCountries.length === 0 ? 'Add a country first' : 'Choose country'}
              </option>
              {availableCountries.map((country) => (
                <option key={`${keyPrefix}-country-${country.id}`} value={country.id}>
                  {country.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newCityName}
              placeholder="New city name"
              onChange={(event) => setNewCityName(event.target.value)}
              onKeyDown={handleInlineCityKeyDown}
              disabled={availableCountries.length === 0}
            />
            <button
              type="button"
              className="secondary-action-button"
              disabled={
                isCreatingCity ||
                availableCountries.length === 0 ||
                selectedCountryIdForNewCity.length === 0 ||
                newCityName.trim().length === 0 ||
                isDuplicateNewCityName
              }
              onClick={() => {
                void handleCreateCity();
              }}
            >
              {isCreatingCity ? 'Adding…' : 'Add city'}
            </button>
          </div>
          {isDuplicateNewCountryName ? <div className="inline-type-warning">That country already exists.</div> : null}
          {isDuplicateNewCityName ? <div className="inline-type-warning">That city already exists in this country.</div> : null}
        </div>
      ) : null}

      <div className="field-group">
        <div className="field-group-label">Areas (optional)</div>
        <input type="hidden" name="areas" value={areasValue} />
        <div className="area-picker" aria-describedby={`${keyPrefix}-areas-help`}>
          {selectedAreas.length > 0 ? (
            <div className="area-pill-list">
              {selectedAreas.map((area) => (
                  <span key={`${keyPrefix}-selected-area-${area}`} className="area-pill">
                    <span>{area}</span>
                    {!lockedAreaLookup.has(area.trim().toLowerCase()) ? (
                      <button type="button" className="area-pill-remove" onClick={() => removeArea(area)} aria-label={`Remove ${area}`}>
                        ×
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
          ) : (
            <div className="area-picker-empty">
              {disableAreasUntilCitySelected && selectedCityId.length === 0
                ? 'Select a city first to choose or add areas.'
                : 'No areas selected yet'}
            </div>
          )}
          {(!lockedFields?.areas || lockedAreaLookup.size > 0) ? (
            <>
              <div className="area-picker-row">
                <select
                  value=""
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value.length > 0) {
                      addArea(value);
                    }
                  }}
                  disabled={
                    (disableAreasUntilCitySelected && selectedCityId.length === 0) ||
                    availableAreaOptions.length === 0
                  }
                >
                  <option value="">
                    {!selectedCityId && disableAreasUntilCitySelected
                      ? 'Select a city first'
                      : availableAreaOptions.length === 0
                        ? 'No saved areas available'
                        : 'Choose an existing area'}
                  </option>
                  {availableAreaOptions.map((area) => (
                    <option key={`${keyPrefix}-area-option-${area}`} value={area}>
                      {area}
                    </option>
                  ))}
                </select>
              </div>
              <div className="area-picker-row">
                <input
                  type="text"
                  value={newAreaValue}
                  onChange={(event) => setNewAreaValue(event.target.value)}
                  onKeyDown={handleNewAreaKeyDown}
                  disabled={disableAreasUntilCitySelected && selectedCityId.length === 0}
                  placeholder={
                    disableAreasUntilCitySelected && selectedCityId.length === 0
                      ? 'Select a city first'
                      : 'Add a new area'}
                />
                <button
                  type="button"
                  className="secondary-action-button"
                  onClick={handleAddNewArea}
                  disabled={
                    (disableAreasUntilCitySelected && selectedCityId.length === 0) || newAreaValue.trim().length === 0
                  }
                >
                  Add new
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
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
                checked={selectedMealTypes.includes(mealType)}
                onChange={(event) => toggleMealType(mealType, event.target.checked)}
              />
              {mealTypeLabel[mealType]}
            </label>
          ))}
        </div>
      </fieldset>

      <label>
        Name
        <input name="name" required value={nameValue} onChange={(event) => setNameValue(event.target.value)} />
      </label>

      <label>
        Notes
        <textarea
          name="notes"
          rows={4}
          required
          value={notesValue}
          onChange={(event) => setNotesValue(event.target.value)}
        />
      </label>

      <label>
        Referred by (URL or free text)
        <input name="referredBy" value={referredByValue} onChange={(event) => setReferredByValue(event.target.value)} />
      </label>

      <fieldset>
        <legend>Restaurant Types (pick at least 1)</legend>
        <div className="inline-type-creator">
          <div className="inline-type-creator-row">
            <input
              type="text"
              value={newTypeName}
              placeholder="New type name"
              onChange={(event) => setNewTypeName(event.target.value)}
              onKeyDown={handleInlineTypeKeyDown}
            />
            <input
              type="text"
              value={newTypeEmoji}
              placeholder="Emoji"
              maxLength={8}
              onChange={(event) => setNewTypeEmoji(event.target.value)}
              onKeyDown={handleInlineTypeKeyDown}
            />
            <button
              type="button"
              className="inline-type-create-button"
              disabled={isCreatingType || newTypeName.trim().length === 0 || newTypeEmoji.trim().length === 0 || isDuplicateNewTypeName}
              onClick={() => {
                void handleCreateType();
              }}
            >
              {isCreatingType ? 'Adding…' : 'Add type'}
            </button>
          </div>
          {isDuplicateNewTypeName ? <div className="inline-type-warning">That type already exists.</div> : null}
        </div>
        <div className="inline-options">
          {availableTypes.map((type) => (
            <label key={`${keyPrefix}-type-${type.id}`}>
              <input
                type="checkbox"
                name="typeIds"
                value={type.id}
                checked={selectedTypeIds.includes(type.id)}
                onChange={(event) => {
                  setSelectedTypeIds((current) =>
                    event.target.checked ? [...current, type.id] : current.filter((entry) => entry !== type.id)
                  );
                }}
              />
              {type.emoji} {type.name}
            </label>
          ))}
        </div>
      </fieldset>

      <label>
        URL
        <input name="url" type="url" required value={urlValue} onChange={(event) => setUrlValue(event.target.value)} />
      </label>

      <label>
        Status
        {lockedFields?.status ? <input type="hidden" name="status" value={status} /> : null}
        <select
          name={lockedFields?.status ? undefined : 'status'}
          required
          value={status}
          onChange={(event) => setStatus(event.target.value as RestaurantStatus)}
          disabled={lockedFields?.status}
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
          Not Recommended Reason
          <textarea
            name="dislikedReason"
            rows={3}
            required
            value={dislikedReasonValue}
            onChange={(event) => setDislikedReasonValue(event.target.value)}
          />
        </label>
      ) : null}

      <div className="form-actions">
        <button type="submit" disabled={disableSubmit}>
          {submitLabel}
        </button>
        {showDevelopmentPopulateButton ? (
          <button type="button" className="secondary-action-button" onClick={handlePopulateFakeValues}>
            [DEV] Fill fake values
          </button>
        ) : null}
      </div>
    </>
  );
}
