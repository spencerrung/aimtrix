import { describe, expect, it } from 'vitest';
import {
  defaultUserPreferences,
  loadUserPreferences,
  parseUserPreferences,
  saveUserPreferences,
} from './preferences';

describe('user preferences', () => {
  it('keeps valid personalization and rejects unknown choices', () => {
    expect(parseUserPreferences({
      accent: 'grape',
      density: 'wall-to-wall',
      messageScale: 'large',
      motion: 'reduced',
      detailsOpenByDefault: false,
    })).toEqual({
      ...defaultUserPreferences,
      accent: 'grape',
      density: defaultUserPreferences.density,
      messageScale: 'large',
      motion: 'reduced',
      detailsOpenByDefault: false,
    });
  });

  it('persists preferences locally', () => {
    const preferences = { ...defaultUserPreferences, accent: 'rose' as const };
    saveUserPreferences(preferences);
    expect(loadUserPreferences()).toEqual(preferences);
  });
});
