import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMonthHeadingKey,
  getMonthHeadingLabel,
  isUrl,
  mealLabel,
  readUrlState
} from '../app/components/public-eats-page/utils';

test('mealLabel capitalizes known meal labels', () => {
  assert.equal(mealLabel('dinner'), 'Dinner');
  assert.equal(mealLabel('snack'), 'Snack');
  assert.equal(mealLabel('custom'), 'custom');
});

test('getMonthHeadingKey and label derive month groupings', () => {
  assert.equal(getMonthHeadingKey('2026-03-07T12:00:00.000Z'), '2026-03');
  assert.equal(getMonthHeadingLabel('2026-03'), 'March 2026');
});

test('isUrl only accepts http and https URLs', () => {
  assert.equal(isUrl('https://example.com'), true);
  assert.equal(isUrl('ftp://example.com'), false);
  assert.equal(isUrl('not a url'), false);
});

test('readUrlState returns sensible defaults without window', () => {
  const originalWindow = globalThis.window;
  // @ts-expect-error intentionally deleting for test coverage
  delete globalThis.window;

  try {
    assert.deepEqual(readUrlState(), {
      city: '',
      hasCityQuery: false,
      mealType: 'Any',
      category: 'area',
      status: 'untriedLiked',
      search: '',
      excluded: []
    });
  } finally {
    globalThis.window = originalWindow;
  }
});

test('readUrlState parses query params from window.location.search', () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        search: '?city=Melbourne&mealType=Lunch&category=type&status=liked&exclude=CBD&exclude=Fitzroy'
      }
    }
  });

  try {
    assert.deepEqual(readUrlState(), {
      city: 'Melbourne',
      hasCityQuery: true,
      mealType: 'Lunch',
      category: 'type',
      status: 'liked',
      search: '',
      excluded: ['CBD', 'Fitzroy']
    });
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
  }
});
