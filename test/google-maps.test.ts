import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleMapsAutocompleteInput,
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

  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
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
    assert.deepEqual(body.includedPrimaryTypes, [
      'restaurant',
      'cafe',
      'bakery',
      'bar',
      'meal_takeaway'
    ]);

    return new Response(
      JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: 'place-1',
              structuredFormat: {
                mainText: { text: 'Bar Liberty' },
                secondaryText: { text: 'Melbourne VIC, Australia' }
              },
              text: { text: 'Bar Liberty, Melbourne VIC, Australia' }
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
      'addressComponents,displayName,formattedAddress,googleMapsUri,location'
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
        location: {
          latitude: -37.7988,
          longitude: 144.9788
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
      placeId: 'place-1',
      url: 'https://maps.google.com/?cid=123'
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
