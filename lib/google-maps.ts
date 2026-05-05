type GoogleMapsAutocompleteRequest = {
  cityName?: string;
  countryName?: string;
  input: string;
  sessionToken?: string;
};

type GoogleMapsPlaceDetailsRequest = {
  placeId: string;
  sessionToken?: string;
};

type GoogleMapsLocationBackfillRequest = {
  cityName: string;
  countryName: string;
  name: string;
  url: string;
};

type GoogleMapsAutocompleteApiResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
      text?: { text?: string };
    };
  }>;
};

type GoogleMapsPlaceDetailsApiResponse = {
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
  displayName?: { text?: string };
  formattedAddress?: string;
  googleMapsUri?: string;
  id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  websiteUri?: string;
};

type GoogleMapsTextSearchApiResponse = {
  places?: GoogleMapsPlaceDetailsApiResponse[];
};

export type GoogleMapsSuggestion = {
  fullText: string;
  placeId: string;
  primaryText: string;
  secondaryText: string;
};

export type GoogleMapsResolvedPlace = {
  address: string | null;
  area: string | null;
  cityName: string | null;
  countryName: string | null;
  label: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  url: string;
  websiteUrl: string | null;
};

const googleMapsAutocompleteEndpoint = 'https://places.googleapis.com/v1/places:autocomplete';
const googleMapsTextSearchEndpoint = 'https://places.googleapis.com/v1/places:searchText';
const googleMapsAutocompleteFieldMask = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.structuredFormat.mainText.text',
  'suggestions.placePrediction.structuredFormat.secondaryText.text',
  'suggestions.placePrediction.text.text'
].join(',');
const googleMapsPlaceDetailsFieldMask = [
  'addressComponents',
  'displayName',
  'formattedAddress',
  'googleMapsUri',
  'location',
  'websiteUri'
].join(',');
const googleMapsTextSearchFieldMask = [
  'places.addressComponents',
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.googleMapsUri',
  'places.location',
  'places.websiteUri'
].join(',');
const googleMapsIncludedPrimaryTypes = [
  'restaurant',
  'cafe',
  'bakery',
  'bar',
  'meal_takeaway'
];

const getGoogleMapsApiKey = (): string => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing GOOGLE_MAPS_API_KEY environment variable.');
  }

  return apiKey;
};

const getGoogleMapsErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    const message = payload.error?.message?.trim();
    if (message) {
      return message;
    }
  } catch {}

  return `Google Maps request failed with status ${response.status}.`;
};

export const buildGoogleMapsAutocompleteInput = ({
  cityName,
  countryName,
  input
}: Pick<GoogleMapsAutocompleteRequest, 'cityName' | 'countryName' | 'input'>): string => {
  const normalizedInput = input.trim();
  const normalizedCityName = cityName?.trim() ?? '';
  const normalizedCountryName = countryName?.trim() ?? '';

  const parts = [normalizedInput];
  const inputLower = normalizedInput.toLowerCase();

  if (normalizedCityName && !inputLower.includes(normalizedCityName.toLowerCase())) {
    parts.push(normalizedCityName);
  }

  if (normalizedCountryName && !inputLower.includes(normalizedCountryName.toLowerCase())) {
    parts.push(normalizedCountryName);
  }

  return parts.join(' ').trim();
};

export const searchGoogleMapsSuggestions = async ({
  cityName,
  countryName,
  input,
  sessionToken
}: GoogleMapsAutocompleteRequest): Promise<GoogleMapsSuggestion[]> => {
  const apiKey = getGoogleMapsApiKey();
  const response = await fetch(googleMapsAutocompleteEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': googleMapsAutocompleteFieldMask
    },
    body: JSON.stringify({
      input: buildGoogleMapsAutocompleteInput({
        cityName,
        countryName,
        input
      }),
      includedPrimaryTypes: googleMapsIncludedPrimaryTypes,
      includeQueryPredictions: false,
      ...(sessionToken ? { sessionToken } : {})
    }),
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(await getGoogleMapsErrorMessage(response));
  }

  const payload = (await response.json()) as GoogleMapsAutocompleteApiResponse;

  return (payload.suggestions ?? [])
    .flatMap((suggestion): GoogleMapsSuggestion[] => {
      const placePrediction = suggestion.placePrediction;
      const placeId = placePrediction?.placeId?.trim() ?? '';
      const fullText = placePrediction?.text?.text?.trim() ?? '';
      if (!placeId || !fullText) {
        return [];
      }

      return [
        {
          fullText,
          placeId,
          primaryText: placePrediction?.structuredFormat?.mainText?.text?.trim() ?? fullText,
          secondaryText: placePrediction?.structuredFormat?.secondaryText?.text?.trim() ?? ''
        }
      ];
    })
    .slice(0, 5);
};

const findAddressComponentText = (
  addressComponents: GoogleMapsPlaceDetailsApiResponse['addressComponents'],
  types: string[]
): string | null => {
  const component = addressComponents?.find((entry) => types.some((type) => entry.types?.includes(type)));

  return component?.longText?.trim() || component?.shortText?.trim() || null;
};

export const resolveGoogleMapsPlaceUrl = async ({
  placeId,
  sessionToken
}: GoogleMapsPlaceDetailsRequest): Promise<GoogleMapsResolvedPlace> => {
  const apiKey = getGoogleMapsApiKey();
  const params = new URLSearchParams();
  if (sessionToken) {
    params.set('sessionToken', sessionToken);
  }

  const query = params.toString();
  const endpoint = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}${query ? `?${query}` : ''}`;
  const response = await fetch(endpoint, {
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': googleMapsPlaceDetailsFieldMask
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(await getGoogleMapsErrorMessage(response));
  }

  const payload = (await response.json()) as GoogleMapsPlaceDetailsApiResponse;
  const url = payload.googleMapsUri?.trim() ?? '';
  if (!url) {
    throw new Error('Google Maps did not return a place URL for that result.');
  }

  const cityName = findAddressComponentText(payload.addressComponents, ['locality', 'postal_town']);
  const countryName = findAddressComponentText(payload.addressComponents, ['country']);
  const area = findAddressComponentText(payload.addressComponents, [
    'neighborhood',
    'sublocality',
    'sublocality_level_1',
    'administrative_area_level_3'
  ]);

  return {
    address: payload.formattedAddress?.trim() || null,
    area,
    cityName,
    countryName,
    label: payload.displayName?.text?.trim() ?? '',
    latitude: typeof payload.location?.latitude === 'number' ? payload.location.latitude : null,
    longitude: typeof payload.location?.longitude === 'number' ? payload.location.longitude : null,
    placeId,
    url,
    websiteUrl: payload.websiteUri?.trim() || null
  };
};

const parseCoordinatesFromGoogleMapsUrl = (url: string): { latitude: number; longitude: number } | null => {
  const atMatch = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|z|$)/);
  if (atMatch?.[1] && atMatch[2]) {
    return {
      latitude: Number(atMatch[1]),
      longitude: Number(atMatch[2])
    };
  }

  const dataMatch = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (dataMatch?.[1] && dataMatch[2]) {
    return {
      latitude: Number(dataMatch[1]),
      longitude: Number(dataMatch[2])
    };
  }

  return null;
};

const parsePlaceNameFromGoogleMapsUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    const placeMatch = parsed.pathname.match(/\/maps\/place\/([^/]+)/i);
    if (placeMatch?.[1]) {
      return decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim() || null;
    }

    return parsed.searchParams.get('query')?.trim() || parsed.searchParams.get('q')?.trim() || null;
  } catch {
    return null;
  }
};

const parsePlaceIdFromGoogleMapsUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('place_id')?.trim() || parsed.searchParams.get('query_place_id')?.trim() || null;
  } catch {
    return null;
  }
};

const expandGoogleMapsUrl = async (url: string): Promise<string> => {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'User-Agent': 'Mozilla/5.0'
    }
  });

  return response.url || url;
};

const searchGoogleMapsPlace = async ({
  query,
  locationBias
}: {
  query: string;
  locationBias: { latitude: number; longitude: number } | null;
}): Promise<GoogleMapsResolvedPlace | null> => {
  const apiKey = getGoogleMapsApiKey();
  const response = await fetch(googleMapsTextSearchEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': googleMapsTextSearchFieldMask
    },
    body: JSON.stringify({
      textQuery: query,
      ...(locationBias
        ? {
            locationBias: {
              circle: {
                center: {
                  latitude: locationBias.latitude,
                  longitude: locationBias.longitude
                },
                radius: 500
              }
            }
          }
        : {})
    }),
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(await getGoogleMapsErrorMessage(response));
  }

  const payload = (await response.json()) as GoogleMapsTextSearchApiResponse;
  const place = payload.places?.[0];
  if (!place) {
    return null;
  }

  return {
    address: place.formattedAddress?.trim() || null,
    area: findAddressComponentText(place.addressComponents, [
      'neighborhood',
      'sublocality',
      'sublocality_level_1',
      'administrative_area_level_3'
    ]),
    cityName: findAddressComponentText(place.addressComponents, ['locality', 'postal_town']),
    countryName: findAddressComponentText(place.addressComponents, ['country']),
    label: place.displayName?.text?.trim() ?? '',
    latitude: typeof place.location?.latitude === 'number' ? place.location.latitude : null,
    longitude: typeof place.location?.longitude === 'number' ? place.location.longitude : null,
    placeId: place.id?.trim() || null,
    url: place.googleMapsUri?.trim() || '',
    websiteUrl: place.websiteUri?.trim() || null
  };
};

export const resolveGoogleMapsLocationFromUrl = async ({
  cityName,
  countryName,
  name,
  url
}: GoogleMapsLocationBackfillRequest): Promise<GoogleMapsResolvedPlace | null> => {
  const expandedUrl = await expandGoogleMapsUrl(url).catch(() => url);
  const placeId = parsePlaceIdFromGoogleMapsUrl(expandedUrl) ?? parsePlaceIdFromGoogleMapsUrl(url);
  if (placeId) {
    return resolveGoogleMapsPlaceUrl({ placeId });
  }

  const coordinates = parseCoordinatesFromGoogleMapsUrl(expandedUrl) ?? parseCoordinatesFromGoogleMapsUrl(url);
  const placeName = parsePlaceNameFromGoogleMapsUrl(expandedUrl) ?? parsePlaceNameFromGoogleMapsUrl(url);
  const query = [placeName ?? name, cityName, countryName].filter(Boolean).join(' ');
  const searchedPlace = await searchGoogleMapsPlace({
    query,
    locationBias: coordinates
  });
  if (searchedPlace && searchedPlace.latitude !== null && searchedPlace.longitude !== null) {
    return searchedPlace;
  }

  if (coordinates) {
    return {
      address: null,
      area: null,
      cityName: null,
      countryName: null,
      label: placeName ?? name,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      placeId: null,
      url: expandedUrl,
      websiteUrl: null
    };
  }

  return searchedPlace;
};
