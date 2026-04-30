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
  displayName?: { text?: string };
  googleMapsUri?: string;
};

export type GoogleMapsSuggestion = {
  fullText: string;
  placeId: string;
  primaryText: string;
  secondaryText: string;
};

const googleMapsAutocompleteEndpoint = 'https://places.googleapis.com/v1/places:autocomplete';
const googleMapsAutocompleteFieldMask = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.structuredFormat.mainText.text',
  'suggestions.placePrediction.structuredFormat.secondaryText.text',
  'suggestions.placePrediction.text.text'
].join(',');
const googleMapsPlaceDetailsFieldMask = ['displayName', 'googleMapsUri'].join(',');
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

export const resolveGoogleMapsPlaceUrl = async ({
  placeId,
  sessionToken
}: GoogleMapsPlaceDetailsRequest): Promise<{ label: string; url: string }> => {
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

  return {
    label: payload.displayName?.text?.trim() ?? '',
    url
  };
};
