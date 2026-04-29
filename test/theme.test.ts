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
    '--tenant-on-secondary': '#000000',
    '--tenant-action-bg': 'color-mix(in srgb, #abcdef 18%, rgba(32, 18, 38, 0.72))',
    '--tenant-action-bg-hover': 'color-mix(in srgb, #abcdef 24%, rgba(32, 18, 38, 0.68))',
    '--tenant-action-border': 'color-mix(in srgb, #abcdef 44%, rgba(255, 255, 255, 0.14))',
    '--tenant-action-border-hover': 'color-mix(in srgb, #abcdef 52%, rgba(255, 255, 255, 0.16))',
    '--tenant-action-text': '#abcdef',
    '--tenant-action-shadow':
      'inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 8px 18px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.08)',
    '--tenant-action-shadow-hover':
      'inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 10px 22px rgba(0, 0, 0, 0.14), 0 2px 7px rgba(0, 0, 0, 0.09)'
  });
});

test('buildThemeCssVariables returns brighter action variables for light primary themes', () => {
  assert.deepEqual(buildThemeCssVariables('#f6d7e7', '#ec4b93', 'theme'), {
    '--theme-primary': '#f6d7e7',
    '--theme-secondary': '#ec4b93',
    '--theme-on-primary': '#000000',
    '--theme-on-secondary': '#000000',
    '--theme-action-bg': 'color-mix(in srgb, #ec4b93 12%, #f6d7e7)',
    '--theme-action-bg-hover': 'color-mix(in srgb, #ec4b93 16%, #f6d7e7)',
    '--theme-action-border': 'color-mix(in srgb, #ec4b93 50%, #f6d7e7)',
    '--theme-action-border-hover': 'color-mix(in srgb, #ec4b93 58%, #f6d7e7)',
    '--theme-action-text': '#ec4b93',
    '--theme-action-shadow':
      'inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 8px 18px rgba(0, 0, 0, 0.06), 0 2px 6px rgba(0, 0, 0, 0.04)',
    '--theme-action-shadow-hover':
      'inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 10px 22px rgba(0, 0, 0, 0.08), 0 2px 7px rgba(0, 0, 0, 0.05)'
  });
});
