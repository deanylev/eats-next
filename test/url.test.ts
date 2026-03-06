import test from 'node:test';
import assert from 'node:assert/strict';
import { isGoogleMapsSearchUrl, isGoogleMapsUrl, normalizeLookupUrl } from '../lib/url';

test('isGoogleMapsUrl accepts direct Google Maps venue URLs', () => {
  assert.equal(isGoogleMapsUrl('https://www.google.com/maps/place/Foo/@1,2,3z'), true);
  assert.equal(isGoogleMapsUrl('https://maps.app.goo.gl/abcd1234'), true);
});

test('isGoogleMapsUrl rejects non-google URLs', () => {
  assert.equal(isGoogleMapsUrl('https://example.com/restaurant'), false);
});

test('isGoogleMapsSearchUrl detects Google Maps search pages', () => {
  assert.equal(isGoogleMapsSearchUrl('https://www.google.com/maps/search/ramen'), true);
  assert.equal(isGoogleMapsSearchUrl('https://www.google.com/maps?q=ramen'), true);
});

test('normalizeLookupUrl keeps Google Maps URLs unchanged', () => {
  const url = 'https://www.google.com/maps/place/Foo/@1,2,3z';
  assert.equal(normalizeLookupUrl(url), url);
});

test('normalizeLookupUrl collapses non-google URLs to origin root', () => {
  assert.equal(normalizeLookupUrl('https://restaurant.example.com/menu/dinner'), 'https://restaurant.example.com/');
});
