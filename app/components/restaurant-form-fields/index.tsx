'use client';

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
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
  googlePlaceId?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locations?: RestaurantFormLocation[];
  status?: RestaurantStatus;
  dislikedReason?: string | null;
  rating?: number | null;
};

type RestaurantFormLockedFields = {
  areas?: boolean;
  city?: boolean;
  status?: boolean;
};

type GoogleMapsSuggestion = {
  fullText: string;
  placeId: string;
  primaryText: string;
  secondaryText: string;
};

type RestaurantFormLocation = {
  id?: string;
  label: string;
  address: string;
  googlePlaceId: string;
  googleMapsUrl: string;
  latitude: number;
  longitude: number;
};

type GoogleMapsResolvedLocation = RestaurantFormLocation & {
  mealTypes: MealType[];
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
  preferGoogleMapsFirst?: boolean;
  showDevelopmentPopulateButton?: boolean;
  validationErrorMessage?: string | null;
};

type RestaurantFormFieldErrorKey =
  | 'city'
  | 'locations'
  | 'mealTypes'
  | 'name'
  | 'notes'
  | 'referredBy'
  | 'status'
  | 'rating'
  | 'types'
  | 'url';

const restaurantFormFieldErrorOrder: RestaurantFormFieldErrorKey[] = [
  'city',
  'locations',
  'mealTypes',
  'name',
  'notes',
  'referredBy',
  'types',
  'url',
  'status',
  'rating'
];

const getRestaurantFormFieldErrors = (message: string | null | undefined): Partial<Record<RestaurantFormFieldErrorKey, string>> => {
  if (!message) {
    return {};
  }

  const normalizedMessage = message.toLowerCase();
  const errors: Partial<Record<RestaurantFormFieldErrorKey, string>> = {};

  if (normalizedMessage.includes('city')) {
    errors.city = message;
  }
  if (normalizedMessage.includes('map location')) {
    errors.locations = message;
  }
  if (normalizedMessage.includes('meal type')) {
    errors.mealTypes = message;
  }
  if (normalizedMessage.includes('restaurant name') || normalizedMessage.includes('with this name')) {
    errors.name = message;
  }
  if (normalizedMessage.includes('notes')) {
    errors.notes = message;
  }
  if (normalizedMessage.includes('referred by')) {
    errors.referredBy = message;
  }
  if (normalizedMessage.includes('type')) {
    errors.types = message;
  }
  if (normalizedMessage.includes('url')) {
    errors.url = message;
  }
  if (normalizedMessage.includes('disliked reason')) {
    errors.status = message;
  }
  if (normalizedMessage.includes('rating') || normalizedMessage.includes('star')) {
    errors.rating = message;
  }

  return errors;
};

const getFirstRestaurantFormFieldErrorKey = (
  errors: Partial<Record<RestaurantFormFieldErrorKey, string>>
): RestaurantFormFieldErrorKey | null =>
  restaurantFormFieldErrorOrder.find((field) => Boolean(errors[field])) ?? null;

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
  preferGoogleMapsFirst = false,
  showDevelopmentPopulateButton = false,
  validationErrorMessage = null
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
  const [ratingValue, setRatingValue] = useState<string>(defaults?.rating ? String(defaults.rating) : '');
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
  const [locationRows, setLocationRows] = useState<RestaurantFormLocation[]>(defaults?.locations ?? []);
  const [dislikedReasonValue, setDislikedReasonValue] = useState<string>(defaults?.dislikedReason ?? '');
  const [locationGoogleMapsSearchValue, setLocationGoogleMapsSearchValue] = useState<string>('');
  const [locationGoogleMapsSuggestions, setLocationGoogleMapsSuggestions] = useState<GoogleMapsSuggestion[]>([]);
  const [selectedLocationGoogleMapsSuggestionIds, setSelectedLocationGoogleMapsSuggestionIds] = useState<string[]>([]);
  const [locationGoogleMapsSearchError, setLocationGoogleMapsSearchError] = useState<string>('');
  const [isSearchingLocationGoogleMaps, setIsSearchingLocationGoogleMaps] = useState<boolean>(false);
  const [isResolvingLocationGoogleMapsSelection, setIsResolvingLocationGoogleMapsSelection] = useState<boolean>(false);
  const [areaSelectionError, setAreaSelectionError] = useState<string>('');
  const locationGoogleMapsSessionTokenRef = useRef<string>('');
  const fieldErrors = useMemo(() => getRestaurantFormFieldErrors(validationErrorMessage), [validationErrorMessage]);
  const firstFieldErrorKey = useMemo(() => getFirstRestaurantFormFieldErrorKey(fieldErrors), [fieldErrors]);
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
  const selectedCity = useMemo(
    () => availableCities.find((city) => city.id === selectedCityId) ?? null,
    [availableCities, selectedCityId]
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
  const locationsValue = useMemo(() => JSON.stringify(locationRows), [locationRows]);
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
      locationsValue !== JSON.stringify(defaults?.locations ?? []) ||
      status !== (defaults?.status ?? 'untried') ||
      dislikedReasonValue !== (defaults?.dislikedReason ?? '') ||
      ratingValue !== (defaults?.rating ? String(defaults.rating) : '') ||
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
    defaults?.rating,
    defaults?.referredBy,
    defaults?.locations,
    defaults?.status,
    defaults?.typeIds,
    defaults?.url,
    dislikedReasonValue,
    locationsValue,
    nameValue,
    newCityName,
    newCountryName,
    newTypeEmoji,
    newTypeName,
    notesValue,
    ratingValue,
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

  useEffect(() => {
    if (status === 'untried' && ratingValue.length > 0) {
      setRatingValue('');
    }
  }, [ratingValue, status]);

  useEffect(() => {
    if (!validationErrorMessage || !firstFieldErrorKey || typeof window === 'undefined') {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      document
        .getElementById(`${keyPrefix}-field-error-${firstFieldErrorKey}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [firstFieldErrorKey, keyPrefix, validationErrorMessage]);

  useEffect(() => {
    const trimmedSearch = locationGoogleMapsSearchValue.trim();
    if (trimmedSearch.length < 2) {
      setLocationGoogleMapsSuggestions([]);
      setLocationGoogleMapsSearchError('');
      setIsSearchingLocationGoogleMaps(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const sessionToken =
        locationGoogleMapsSessionTokenRef.current ||
        (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}`);
      locationGoogleMapsSessionTokenRef.current = sessionToken;
      setIsSearchingLocationGoogleMaps(true);
      setLocationGoogleMapsSearchError('');

      void fetch('/api/google-maps-autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          cityName: selectedCity?.name,
          countryName: selectedCity?.countryName,
          input: trimmedSearch,
          sessionToken
        })
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string; suggestions?: GoogleMapsSuggestion[] }
            | null;

          if (!response.ok) {
            throw new Error(payload?.error ?? 'Something went wrong. Please try again.');
          }

          setLocationGoogleMapsSuggestions(payload?.suggestions ?? []);
          setSelectedLocationGoogleMapsSuggestionIds([]);
        })
        .catch((error: unknown) => {
          setLocationGoogleMapsSuggestions([]);
          setSelectedLocationGoogleMapsSuggestionIds([]);
          setLocationGoogleMapsSearchError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
        })
        .finally(() => {
          setIsSearchingLocationGoogleMaps(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [locationGoogleMapsSearchValue, selectedCity?.countryName, selectedCity?.name]);

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

  const clearSelectedAreas = (): void => {
    setSelectedAreas([]);
    setNewAreaValue('');
    setAreaSelectionError('');
  };

  const handleCitySelectionChange = (value: string): void => {
    clearSelectedAreas();
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
      clearSelectedAreas();
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

    setAreaSelectionError('');
    setSelectedAreas((current) => [...current, trimmedValue]);
  };

  const removeArea = (value: string): void => {
    if (lockedAreaLookup.has(value.trim().toLowerCase())) {
      return;
    }

    setAreaSelectionError('');
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
    const fakeName = `Test Restaurant ${fakeSuffix}`;

    setSelectedCityId(fakeCityId);
    setSelectedAreas(populatedAreas);
    setSelectedMealTypes(['lunch', 'dinner']);
    setNameValue(fakeName);
    setNotesValue('Development-only seeded restaurant notes.');
    setReferredByValue('Local recommendation');
    setSelectedTypeIds(fakeTypeIds);
    setUrlValue(`https://example.com/restaurants/test-${fakeSuffix}/`);
    setLocationRows([{
      address: '123 Test Lane, Melbourne VIC 3000, Australia',
      googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fakeName)}`,
      googlePlaceId: `dev-place-${fakeSuffix}`,
      label: fakeName,
      latitude: -37.8136,
      longitude: 144.9631
    }]);
    setStatus('untried');
    setDislikedReasonValue('');
    setNewAreaValue('');
    setLocationGoogleMapsSearchValue('');
    setLocationGoogleMapsSuggestions([]);
    setSelectedLocationGoogleMapsSuggestionIds([]);
    setLocationGoogleMapsSearchError('');
    locationGoogleMapsSessionTokenRef.current = '';
  };

  const resolveLocationGoogleMapsSuggestion = async (suggestion: GoogleMapsSuggestion): Promise<GoogleMapsResolvedLocation> => {
    const sessionToken = locationGoogleMapsSessionTokenRef.current;
    const response = await fetch('/api/google-maps-place-details', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        placeId: suggestion.placeId,
        sessionToken: sessionToken || undefined
      })
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          address?: string | null;
          error?: string;
          label?: string;
          latitude?: number | null;
          longitude?: number | null;
          mealTypes?: string[];
          placeId?: string;
          url?: string;
        }
      | null;

    if (!response.ok || !payload?.url || typeof payload.latitude !== 'number' || typeof payload.longitude !== 'number') {
      throw new Error(payload?.error ?? 'Google Maps did not return coordinates for that place.');
    }

    return {
      label: payload.label?.trim() || suggestion.primaryText,
      address: payload.address ?? '',
      googlePlaceId: payload.placeId ?? suggestion.placeId,
      googleMapsUrl: payload.url,
      latitude: payload.latitude,
      longitude: payload.longitude,
      mealTypes: (payload.mealTypes ?? []).filter((mealType): mealType is MealType =>
        mealTypeChoices.includes(mealType as MealType)
      )
    };
  };

  const handleAddLocationGoogleMapsSuggestions = async (suggestions: GoogleMapsSuggestion[]): Promise<void> => {
    const existingPlaceIds = new Set(locationRows.map((location) => location.googlePlaceId).filter(Boolean));
    const suggestionsToAdd = suggestions.filter((suggestion) => !existingPlaceIds.has(suggestion.placeId));
    if (suggestionsToAdd.length === 0) {
      setLocationGoogleMapsSearchError('Choose at least one new map location.');
      return;
    }

    setIsResolvingLocationGoogleMapsSelection(true);
    setLocationGoogleMapsSearchError('');

    try {
      const locations: GoogleMapsResolvedLocation[] = [];
      for (const suggestion of suggestionsToAdd) {
        locations.push(await resolveLocationGoogleMapsSuggestion(suggestion));
      }

      setLocationRows((current) => [
        ...current,
        ...locations.map((location) => ({
          address: location.address,
          googleMapsUrl: location.googleMapsUrl,
          googlePlaceId: location.googlePlaceId,
          label: location.label,
          latitude: location.latitude,
          longitude: location.longitude
        }))
      ]);
      setNameValue((current) => (current.trim().length === 0 ? locations[0]?.label ?? current : current));
      setSelectedMealTypes((current) =>
        current.length === 0 && locationRows.length === 0 && locations[0]?.mealTypes.length
          ? locations[0].mealTypes
          : current
      );
      setLocationGoogleMapsSuggestions((current) =>
        current.filter((suggestion) => !suggestionsToAdd.some((added) => added.placeId === suggestion.placeId))
      );
      setSelectedLocationGoogleMapsSuggestionIds((current) =>
        current.filter((placeId) => !suggestionsToAdd.some((added) => added.placeId === placeId))
      );
      locationGoogleMapsSessionTokenRef.current = '';
    } catch (error) {
      setLocationGoogleMapsSearchError(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setIsResolvingLocationGoogleMapsSelection(false);
    }
  };

  const toggleLocationGoogleMapsSuggestion = (placeId: string, checked: boolean): void => {
    setSelectedLocationGoogleMapsSuggestionIds((current) => {
      if (checked) {
        return current.includes(placeId) ? current : [...current, placeId];
      }

      return current.filter((selectedPlaceId) => selectedPlaceId !== placeId);
    });
  };

  return (
    <>
      <section className="restaurant-form-section restaurant-form-section-place">
        <div className="restaurant-form-section-heading">
          <h3>Place</h3>
        </div>

        <div className="restaurant-form-city-section">
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
        {fieldErrors.city ? (
          <div className="inline-type-warning" id={`${keyPrefix}-field-error-city`}>
            {fieldErrors.city}
          </div>
        ) : null}
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
        </div>

        {(() => {
          const existingLocationPlaceIds = new Set(locationRows.map((location) => location.googlePlaceId).filter(Boolean));
          const availableLocationGoogleMapsSuggestions = locationGoogleMapsSuggestions.filter(
            (suggestion) => !existingLocationPlaceIds.has(suggestion.placeId)
          );
          const selectedLocationGoogleMapsSuggestions = availableLocationGoogleMapsSuggestions.filter((suggestion) =>
            selectedLocationGoogleMapsSuggestionIds.includes(suggestion.placeId)
          );

          return (
            <div className="field-group restaurant-form-locations-section">
              <div className="field-group-label">Map Locations</div>
              <input type="hidden" name="locations" value={locationsValue} />
              {fieldErrors.locations ? (
                <div className="inline-type-warning" id={`${keyPrefix}-field-error-locations`}>
                  {fieldErrors.locations}
                </div>
              ) : null}
              <div className="google-maps-search">
                <div className="area-picker-row">
                  <input
                    type="text"
                    value={locationGoogleMapsSearchValue}
                    placeholder="Search Google Maps for a location"
                    onChange={(event) => setLocationGoogleMapsSearchValue(event.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary-action-button"
                    onClick={() => {
                      setLocationGoogleMapsSearchValue('');
                      setLocationGoogleMapsSuggestions([]);
                      setSelectedLocationGoogleMapsSuggestionIds([]);
                      setLocationGoogleMapsSearchError('');
                      locationGoogleMapsSessionTokenRef.current = '';
                    }}
                    disabled={
                      locationGoogleMapsSearchValue.trim().length === 0 &&
                      locationGoogleMapsSuggestions.length === 0 &&
                      locationGoogleMapsSearchError.length === 0
                    }
                  >
                    Clear
                  </button>
                </div>
                {isSearchingLocationGoogleMaps ? <div className="inline-type-warning">Searching Google Maps…</div> : null}
                {locationGoogleMapsSearchError ? <div className="inline-type-warning">{locationGoogleMapsSearchError}</div> : null}
                {availableLocationGoogleMapsSuggestions.length > 0 ? (
                  <div className="google-maps-suggestion-list" role="listbox" aria-label="Google Maps location suggestions">
                    {availableLocationGoogleMapsSuggestions.map((suggestion) => (
                      <label
                        key={`${keyPrefix}-location-google-maps-${suggestion.placeId}`}
                        className="google-maps-suggestion"
                      >
                        <input
                          type="checkbox"
                          checked={selectedLocationGoogleMapsSuggestionIds.includes(suggestion.placeId)}
                          disabled={isResolvingLocationGoogleMapsSelection}
                          onChange={(event) => toggleLocationGoogleMapsSuggestion(suggestion.placeId, event.target.checked)}
                        />
                        <span className="google-maps-suggestion-copy">
                          <span className="google-maps-suggestion-primary">{suggestion.primaryText}</span>
                          {suggestion.secondaryText ? (
                            <span className="google-maps-suggestion-secondary">{suggestion.secondaryText}</span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                    <div className="google-maps-suggestion-actions">
                      <button
                        type="button"
                        className="secondary-action-button"
                        disabled={isResolvingLocationGoogleMapsSelection || availableLocationGoogleMapsSuggestions.length === 0}
                        onClick={() => {
                          void handleAddLocationGoogleMapsSuggestions(availableLocationGoogleMapsSuggestions);
                        }}
                      >
                        {availableLocationGoogleMapsSuggestions.length === 1
                          ? 'Add location'
                          : `Add all ${availableLocationGoogleMapsSuggestions.length} locations`}
                      </button>
                      <button
                        type="button"
                        className="secondary-action-button"
                        disabled={isResolvingLocationGoogleMapsSelection || selectedLocationGoogleMapsSuggestions.length === 0}
                        onClick={() => {
                          void handleAddLocationGoogleMapsSuggestions(selectedLocationGoogleMapsSuggestions);
                        }}
                      >
                        {selectedLocationGoogleMapsSuggestions.length === 1
                          ? 'Add 1 selected location'
                          : `Add ${selectedLocationGoogleMapsSuggestions.length} selected locations`}
                      </button>
                    </div>
                  </div>
                ) : null}
                {isResolvingLocationGoogleMapsSelection ? (
                  <div className="inline-type-warning">Adding map location…</div>
                ) : null}
              </div>
              {locationRows.length > 0 ? (
                <div className="google-maps-selected-place-list">
                  {locationRows.map((location, index) => (
                    <div key={`${keyPrefix}-location-${location.googlePlaceId || location.googleMapsUrl}-${index}`} className="google-maps-selected-place">
                      <div className="google-maps-selected-place-copy">
                        <div className="google-maps-selected-place-name">{location.label || location.address || location.googleMapsUrl}</div>
                        {location.address ? (
                          <div className="google-maps-selected-place-secondary">{location.address}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="secondary-action-button"
                        onClick={() => setLocationRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="area-picker-empty">Add at least one map location</div>
              )}
            </div>
          );
        })()}

        <div className="field-group restaurant-form-area-section">
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
        Areas are tags for filtering and grouping. Add precise map pins under Map locations.
      </small>
      {areaSelectionError ? <div className="inline-type-warning">{areaSelectionError}</div> : null}

        <label className="restaurant-form-name-field">
          Name
          <input name="name" required value={nameValue} onChange={(event) => setNameValue(event.target.value)} />
        </label>
        {fieldErrors.name ? (
          <div className="inline-type-warning" id={`${keyPrefix}-field-error-name`}>
            {fieldErrors.name}
          </div>
        ) : null}

        <label>
          URL
          <input name="url" type="url" required value={urlValue} onChange={(event) => setUrlValue(event.target.value)} />
          <input type="hidden" name="googlePlaceId" value="" />
          <input type="hidden" name="address" value="" />
          <input type="hidden" name="latitude" value="" />
          <input type="hidden" name="longitude" value="" />
        </label>
        {fieldErrors.url ? (
          <div className="inline-type-warning" id={`${keyPrefix}-field-error-url`}>
            {fieldErrors.url}
          </div>
        ) : null}

      </section>

      <section className="restaurant-form-section restaurant-form-section-classification">
        <div className="restaurant-form-section-heading">
          <h3>Classification</h3>
        </div>

        <fieldset>
          <legend>Meal Types</legend>
          {fieldErrors.mealTypes ? (
            <div className="inline-type-warning" id={`${keyPrefix}-field-error-mealTypes`}>
              {fieldErrors.mealTypes}
            </div>
          ) : null}
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

        <fieldset>
          <legend>Restaurant Types</legend>
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
          {fieldErrors.types ? (
            <div className="inline-type-warning" id={`${keyPrefix}-field-error-types`}>
              {fieldErrors.types}
            </div>
          ) : null}
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

      </section>

      <section className="restaurant-form-section restaurant-form-section-take">
        <div className="restaurant-form-section-heading">
          <h3>Your Take</h3>
        </div>

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

        <input type="hidden" name="rating" value={ratingValue} />
        {status !== 'untried' ? (
          <div className="field-group restaurant-form-rating-section">
            <div className="field-group-label">Stars</div>
            <div
              className="rating-picker"
              role="radiogroup"
              aria-label="Restaurant star rating"
              aria-describedby={fieldErrors.rating ? `${keyPrefix}-field-error-rating` : undefined}
            >
              <button
                type="button"
                className={`rating-clear-button ${ratingValue.length === 0 ? 'rating-clear-button-active' : ''}`}
                onClick={() => setRatingValue('')}
              >
                No rating
              </button>
              <div className="rating-star-buttons">
                {[1, 2, 3, 4, 5].map((rating) => {
                  const ratingString = String(rating);
                  const isSelected = ratingValue === ratingString;
                  const isFilled = Number(ratingValue || '0') >= rating;

                  return (
                    <button
                      key={`${keyPrefix}-rating-${rating}`}
                      type="button"
                      className={`rating-star-button ${isFilled ? 'rating-star-button-filled' : ''}`}
                      role="radio"
                      aria-checked={isSelected}
                      aria-label={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
                      onClick={() => setRatingValue(ratingString)}
                    >
                      ★
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
        {fieldErrors.rating ? (
          <div className="inline-type-warning" id={`${keyPrefix}-field-error-rating`}>
            {fieldErrors.rating}
          </div>
        ) : null}

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
        {fieldErrors.notes ? (
          <div className="inline-type-warning" id={`${keyPrefix}-field-error-notes`}>
            {fieldErrors.notes}
          </div>
        ) : null}

        {status === 'disliked' ? (
          <>
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
            {fieldErrors.status ? (
              <div className="inline-type-warning" id={`${keyPrefix}-field-error-status`}>
                {fieldErrors.status}
              </div>
            ) : null}
          </>
        ) : null}

        <label>
          Referred By
          <input name="referredBy" value={referredByValue} onChange={(event) => setReferredByValue(event.target.value)} />
        </label>
        {fieldErrors.referredBy ? (
          <div className="inline-type-warning" id={`${keyPrefix}-field-error-referredBy`}>
            {fieldErrors.referredBy}
          </div>
        ) : null}
      </section>

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
