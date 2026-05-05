import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAreas, restaurantInputSchema, restaurantTypeInputSchema } from '../lib/validators';

const validUuid = '11111111-1111-4111-8111-111111111111';
const otherUuid = '22222222-2222-4222-8222-222222222222';

const baseRestaurantInput = {
  cityId: validUuid,
  areas: ['CBD'],
  mealTypes: ['lunch'] as const,
  name: 'Kelso',
  notes: 'Good sandwiches',
  referredBy: undefined,
  typeIds: [otherUuid],
  url: 'https://www.google.com/maps/place/Kelso',
  locations: [{
    address: '123 Smith St, Fitzroy',
    googleMapsUrl: 'https://maps.google.com/?cid=11885663895765773631',
    googlePlaceId: 'places/abc123',
    label: 'Kelso Fitzroy',
    latitude: -37.8,
    longitude: 144.97
  }],
  status: 'untried' as const,
  dislikedReason: undefined
};

test('parseAreas trims lines and removes empties', () => {
  assert.deepEqual(parseAreas('CBD\n\n Fitzroy \n  \nCarlton  '), ['CBD', 'Fitzroy', 'Carlton']);
});

test('restaurantTypeInputSchema requires a real emoji', () => {
  assert.equal(restaurantTypeInputSchema.safeParse({ name: 'Italian', emoji: 'abc' }).success, false);
  assert.equal(restaurantTypeInputSchema.safeParse({ name: 'Italian', emoji: '🍝' }).success, true);
});

test('restaurantInputSchema accepts a single-area restaurant with a Google Maps URL', () => {
  assert.equal(restaurantInputSchema.safeParse(baseRestaurantInput).success, true);
});

test('restaurantInputSchema accepts a single-area restaurant with a non-Google URL', () => {
  const result = restaurantInputSchema.safeParse({
    ...baseRestaurantInput,
    url: 'https://kelso.example.com/'
  });

  assert.equal(result.success, true);
});

test('restaurantInputSchema accepts a selected-place Google Maps location row', () => {
  const result = restaurantInputSchema.safeParse({
    ...baseRestaurantInput,
    url: 'https://kelso.example.com/'
  });

  assert.equal(result.success, true);
});

test('restaurantInputSchema requires at least one map location', () => {
  const result = restaurantInputSchema.safeParse({
    ...baseRestaurantInput,
    locations: []
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.issues[0]?.message ?? '', /at least one map location/);
  }
});

test('restaurantInputSchema accepts multi-area restaurants with a non-Google URL', () => {
  const result = restaurantInputSchema.safeParse({
    ...baseRestaurantInput,
    areas: ['CBD', 'Fitzroy'],
    url: 'https://kelso.example.com/'
  });

  assert.equal(result.success, true);
});

test('restaurantInputSchema accepts multi-area restaurants with a Google Maps URL', () => {
  const result = restaurantInputSchema.safeParse({
    ...baseRestaurantInput,
    areas: ['CBD', 'Fitzroy'],
    url: 'https://www.google.com/maps/place/Kelso'
  });

  assert.equal(result.success, true);
});

test('restaurantInputSchema rejects disliked status without a reason', () => {
  const result = restaurantInputSchema.safeParse({
    ...baseRestaurantInput,
    status: 'disliked',
    dislikedReason: undefined
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.issues[0]?.message ?? '', /Disliked reason is required/);
  }
});

test('restaurantInputSchema allows referredBy free text but rejects single-character text', () => {
  assert.equal(
    restaurantInputSchema.safeParse({
      ...baseRestaurantInput,
      referredBy: 'Friend from work'
    }).success,
    true
  );

  const result = restaurantInputSchema.safeParse({
    ...baseRestaurantInput,
    referredBy: 'x'
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error.issues[0]?.message ?? '', /too short/);
  }
});
