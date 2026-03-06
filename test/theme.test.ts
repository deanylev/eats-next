import test from 'node:test';
import assert from 'node:assert/strict';
import { buildThemeCssVariables, getReadableTextColor } from '../lib/theme';

test('getReadableTextColor picks white for dark backgrounds', () => {
  assert.equal(getReadableTextColor('#1b0426'), '#ffffff');
});

test('getReadableTextColor picks black for light backgrounds', () => {
  assert.equal(getReadableTextColor('#e8a61a'), '#000000');
});

test('buildThemeCssVariables returns derived theme variables', () => {
  assert.deepEqual(buildThemeCssVariables('#123456', '#abcdef', 'tenant'), {
    '--tenant-primary': '#123456',
    '--tenant-secondary': '#abcdef',
    '--tenant-on-primary': '#ffffff',
    '--tenant-on-secondary': '#000000'
  });
});
