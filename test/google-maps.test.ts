import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleMapsAutocompleteInput,
  inferGoogleMapsMealTypesFromOpeningHours,
  resolveGoogleMapsPlaceUrl,
  searchGoogleMapsSuggestions
} from '../lib/google-maps';

test('buildGoogleMapsAutocompleteInput appends city and country when they are missing', () => {
  assert.equal(
    buildGoogleMapsAutocompleteInput({
      cityName: 'Melbourne',
      countryName: 'Australia',
      input: 'Bar Liberty'
    }),
    'Bar Liberty Melbourne Australia'
  );
});

test('buildGoogleMapsAutocompleteInput avoids duplicating city and country already in the query', () => {
  assert.equal(
    buildGoogleMapsAutocompleteInput({
      cityName: 'Melbourne',
      countryName: 'Australia',
      input: 'Bar Liberty Melbourne Australia'
    }),
    'Bar Liberty Melbourne Australia'
  );
});

test('searchGoogleMapsSuggestions maps Google autocomplete results into compact suggestions', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  let fetchCount = 0;

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    fetchCount += 1;
    assert.equal(String(input), 'https://places.googleapis.com/v1/places:autocomplete');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>)['X-Goog-Api-Key'], 'test-key');

    const body = JSON.parse(String(init?.body ?? '{}')) as {
      includedPrimaryTypes?: string[];
      input?: string;
      sessionToken?: string;
    };
    assert.equal(body.input, 'Bar Liberty Melbourne Australia');
    assert.equal(body.sessionToken, 'session-123');
    assert.deepEqual(
      body.includedPrimaryTypes,
      fetchCount === 1
        ? [
            'restaurant',
            'cafe',
            'bakery',
            'bar',
            'meal_takeaway'
          ]
        : ['food_store']
    );

    return new Response(
      JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: fetchCount === 1 ? 'place-1' : 'place-2',
              structuredFormat: {
                mainText: { text: fetchCount === 1 ? 'Bar Liberty' : 'Bar Liberty Grocer' },
                secondaryText: { text: fetchCount === 1 ? 'Melbourne VIC, Australia' : 'Fitzroy VIC, Australia' }
              },
              text: { text: fetchCount === 1 ? 'Bar Liberty, Melbourne VIC, Australia' : 'Bar Liberty Grocer, Fitzroy VIC, Australia' }
            }
          }
        ]
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }) as typeof fetch;

  try {
    const suggestions = await searchGoogleMapsSuggestions({
      cityName: 'Melbourne',
      countryName: 'Australia',
      input: 'Bar Liberty',
      sessionToken: 'session-123'
    });

    assert.deepEqual(suggestions, [
      {
        fullText: 'Bar Liberty, Melbourne VIC, Australia',
        placeId: 'place-1',
        primaryText: 'Bar Liberty',
        secondaryText: 'Melbourne VIC, Australia'
      },
      {
        fullText: 'Bar Liberty Grocer, Fitzroy VIC, Australia',
        placeId: 'place-2',
        primaryText: 'Bar Liberty Grocer',
        secondaryText: 'Fitzroy VIC, Australia'
      }
    ]);
    assert.equal(fetchCount, 2);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalApiKey;
    }
  }
});

test('searchGoogleMapsSuggestions can search all place types for origin selection', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://places.googleapis.com/v1/places:autocomplete');
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      includedPrimaryTypes?: string[];
      input?: string;
    };
    assert.equal(body.input, '123 Smith Street Melbourne Australia');
    assert.equal(body.includedPrimaryTypes, undefined);

    return new Response(
      JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: 'address-1',
              structuredFormat: {
                mainText: { text: '123 Smith Street' },
                secondaryText: { text: 'Melbourne VIC, Australia' }
              },
              text: { text: '123 Smith Street, Melbourne VIC, Australia' }
            }
          }
        ]
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }) as typeof fetch;

  try {
    const suggestions = await searchGoogleMapsSuggestions({
      cityName: 'Melbourne',
      countryName: 'Australia',
      input: '123 Smith Street',
      placeTypes: 'any'
    });

    assert.deepEqual(suggestions, [
      {
        fullText: '123 Smith Street, Melbourne VIC, Australia',
        placeId: 'address-1',
        primaryText: '123 Smith Street',
        secondaryText: 'Melbourne VIC, Australia'
      }
    ]);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalApiKey;
    }
  }
});

test('resolveGoogleMapsPlaceUrl returns the Google Maps URL from place details', async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(
      String(input),
      'https://places.googleapis.com/v1/places/place-1?sessionToken=session-123'
    );
    assert.equal(
      (init?.headers as Record<string, string>)['X-Goog-FieldMask'],
      'addressComponents,displayName,formattedAddress,googleMapsUri,location,regularOpeningHours.periods,websiteUri'
    );

    return new Response(
      JSON.stringify({
        addressComponents: [
          { longText: 'Fitzroy', types: ['sublocality_level_1', 'sublocality', 'political'] },
          { longText: 'Melbourne', types: ['locality', 'political'] },
          { longText: 'Australia', types: ['country', 'political'] }
        ],
        displayName: { text: 'Bar Liberty' },
        formattedAddress: '234 Johnston St, Fitzroy VIC 3065, Australia',
        googleMapsUri: 'https://maps.google.com/?cid=123',
        websiteUri: 'https://barliberty.com/',
        location: {
          latitude: -37.7988,
          longitude: 144.9788
        },
        regularOpeningHours: {
          periods: [
            {
              open: { day: 1, hour: 12, minute: 0 },
              close: { day: 1, hour: 23, minute: 0 }
            }
          ]
        }
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
  }) as typeof fetch;

  try {
    const place = await resolveGoogleMapsPlaceUrl({
      placeId: 'place-1',
      sessionToken: 'session-123'
    });

    assert.deepEqual(place, {
      address: '234 Johnston St, Fitzroy VIC 3065, Australia',
      area: 'Fitzroy',
      cityName: 'Melbourne',
      countryName: 'Australia',
      label: 'Bar Liberty',
      latitude: -37.7988,
      longitude: 144.9788,
      mealTypes: ['lunch', 'dinner'],
      placeId: 'place-1',
      url: 'https://maps.google.com/?cid=123',
      websiteUrl: 'https://barliberty.com/'
    });
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.GOOGLE_MAPS_API_KEY;
    } else {
      process.env.GOOGLE_MAPS_API_KEY = originalApiKey;
    }
  }
});

test('inferGoogleMapsMealTypesFromOpeningHours maps opening periods to meals', () => {
  assert.deepEqual(
    inferGoogleMapsMealTypesFromOpeningHours([
      {
        open: { day: 1, hour: 7, minute: 30 },
        close: { day: 1, hour: 14, minute: 0 }
      },
      {
        open: { day: 1, hour: 17, minute: 30 },
        close: { day: 1, hour: 22, minute: 30 }
      }
    ]),
    ['breakfast', 'lunch', 'dinner']
  );
});

test('inferGoogleMapsMealTypesFromOpeningHours does not treat 11am as lunch', () => {
  assert.deepEqual(
    inferGoogleMapsMealTypesFromOpeningHours([
      {
        open: { day: 1, hour: 11, minute: 0 },
        close: { day: 1, hour: 12, minute: 0 }
      }
    ]),
    []
  );
});

test('inferGoogleMapsMealTypesFromOpeningHours handles overnight hours', () => {
  assert.deepEqual(
    inferGoogleMapsMealTypesFromOpeningHours([
      {
        open: { day: 5, hour: 18, minute: 0 },
        close: { day: 6, hour: 2, minute: 0 }
      }
    ]),
    ['dinner']
  );
});

test('inferGoogleMapsMealTypesFromOpeningHours handles week-wrapping hours', () => {
  assert.deepEqual(
    inferGoogleMapsMealTypesFromOpeningHours([
      {
        open: { day: 6, hour: 18, minute: 0 },
        close: { day: 0, hour: 10, minute: 0 }
      }
    ]),
    ['breakfast', 'dinner']
  );
});
