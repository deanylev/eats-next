import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPreservedIncludedHeadings,
  getFeelingLuckyCandidateIds,
  getIncludedRestaurantAreaLaneIds,
  getMonthHeadingKey,
  getMonthHeadingLabel,
  getPrimaryArea,
  getRestaurantAreaLaneIds,
  isUrl,
  mealLabel,
  readUrlState,
  reconcileExcludedAfterStatusChange,
  showFeelingLuckyForStatuses,
  unassignedAreaLaneId
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
      statuses: ['untried', 'liked'],
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
      statuses: ['liked'],
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

test('readUrlState supports multiple status params and legacy combined status', () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        search: '?status=untried&status=disliked&status=untriedLiked'
      }
    }
  });

  try {
    assert.deepEqual(readUrlState(), {
      city: '',
      hasCityQuery: false,
      mealType: 'Any',
      category: 'area',
      statuses: ['untried', 'disliked', 'liked'],
      search: '',
      excluded: []
    });
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
  }
});

test('readUrlState preserves an explicitly empty status filter', () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: {
        search: '?status=none'
      }
    }
  });

  try {
    assert.deepEqual(readUrlState(), {
      city: '',
      hasCityQuery: false,
      mealType: 'Any',
      category: 'area',
      statuses: [],
      search: '',
      excluded: []
    });
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow
    });
  }
});

test('showFeelingLuckyForStatuses hides lucky when only disliked is selected', () => {
  assert.equal(showFeelingLuckyForStatuses(['disliked']), false);
  assert.equal(showFeelingLuckyForStatuses(['liked']), true);
  assert.equal(showFeelingLuckyForStatuses(['liked', 'disliked']), true);
});

test('getFeelingLuckyCandidateIds excludes disliked restaurants when other statuses are selected', () => {
  const restaurantsById = new Map([
    ['a', { status: 'untried' as const }],
    ['b', { status: 'liked' as const }],
    ['c', { status: 'disliked' as const }]
  ]);

  assert.deepEqual(
    getFeelingLuckyCandidateIds(['a', 'b', 'c'], restaurantsById, ['liked', 'disliked']),
    ['a', 'b']
  );
  assert.deepEqual(
    getFeelingLuckyCandidateIds(['a', 'b', 'c'], restaurantsById, ['disliked']),
    ['a', 'b', 'c']
  );
});

test('getPreservedIncludedHeadings returns null when every heading is selected', () => {
  assert.equal(getPreservedIncludedHeadings(['Bentleigh', 'Brighton'], []), null);
});

test('getPreservedIncludedHeadings returns selected headings when filtering is applied', () => {
  assert.deepEqual(
    getPreservedIncludedHeadings(['Bentleigh', 'Brighton', 'Carlton'], ['Carlton']),
    ['Bentleigh', 'Brighton']
  );
});

test('reconcileExcludedAfterStatusChange keeps current selections and leaves new headings off', () => {
  assert.deepEqual(
    reconcileExcludedAfterStatusChange(['Bentleigh', 'Brighton'], ['Bentleigh', 'Brighton', 'CBD', 'Carlton']),
    ['CBD', 'Carlton']
  );
});

test('reconcileExcludedAfterStatusChange leaves everything selected when no heading filter is applied', () => {
  assert.deepEqual(
    reconcileExcludedAfterStatusChange(null, ['Bentleigh', 'Brighton', 'CBD']),
    []
  );
});

test('reconcileExcludedAfterStatusChange keeps nothing selected when everything was excluded', () => {
  assert.deepEqual(
    reconcileExcludedAfterStatusChange([], ['Bentleigh', 'Brighton', 'CBD']),
    ['Bentleigh', 'Brighton', 'CBD']
  );
});

test('reconcileExcludedAfterStatusChange preserves selections that temporarily disappear', () => {
  assert.deepEqual(
    reconcileExcludedAfterStatusChange(['Bentleigh', 'Brighton', 'Fitzroy North'], ['Bentleigh', 'Brighton']),
    []
  );
  assert.deepEqual(
    reconcileExcludedAfterStatusChange(
      ['Bentleigh', 'Brighton', 'Fitzroy North'],
      ['Bentleigh', 'Brighton', 'CBD', 'Fitzroy North']
    ),
    ['CBD']
  );
});

test('getRestaurantAreaLaneIds includes every unique trimmed area', () => {
  assert.deepEqual(
    getRestaurantAreaLaneIds({
      areas: [' CBD ', 'Fitzroy', 'CBD', '']
    }),
    ['CBD', 'Fitzroy']
  );
});

test('getRestaurantAreaLaneIds uses the unassigned lane when there are no valid areas', () => {
  assert.deepEqual(
    getRestaurantAreaLaneIds({
      areas: [' ', '']
    }),
    [unassignedAreaLaneId]
  );
});

test('getIncludedRestaurantAreaLaneIds filters out excluded areas', () => {
  assert.deepEqual(
    getIncludedRestaurantAreaLaneIds(
      {
        areas: ['CBD', 'Fitzroy']
      },
      ['Fitzroy']
    ),
    ['CBD']
  );
});

test('getIncludedRestaurantAreaLaneIds keeps the unassigned lane visible', () => {
  assert.deepEqual(
    getIncludedRestaurantAreaLaneIds(
      {
        areas: []
      },
      ['CBD', 'Fitzroy']
    ),
    [unassignedAreaLaneId]
  );
});

test('getPrimaryArea returns the first trimmed area', () => {
  assert.equal(
    getPrimaryArea({
      areas: [' CBD ', 'Fitzroy']
    }),
    'CBD'
  );
});
