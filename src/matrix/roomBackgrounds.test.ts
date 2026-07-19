import { describe, expect, it } from 'vitest';
import {
  backgroundPermissionForThreshold,
  parseDirectBackgrounds,
  parseRoomBackground,
  serializeDirectBackgrounds,
  thresholdForBackgroundPermission,
} from './roomBackgrounds';

describe('room backgrounds', () => {
  it('strictly parses presets and Matrix media references', () => {
    expect(parseRoomBackground({ preset: 'green-meadow' })).toEqual({ preset: 'green-meadow', mxcUrl: undefined });
    expect(parseRoomBackground({ preset: 'unknown', mxc_url: 'https://tracking.test/image' })).toEqual({ preset: 'none', mxcUrl: undefined });
    expect(parseRoomBackground({ preset: 'citrus-grove', mxc_url: 'mxc://test/background' })).toEqual({ preset: 'none', mxcUrl: 'mxc://test/background' });
    expect(parseRoomBackground({ preset: 'none', block_space_inheritance: true })).toEqual({ preset: 'none', mxcUrl: undefined, blockSpaceInheritance: true });
  });

  it('round-trips bounded personal DM backgrounds and drops cleared rooms', () => {
    const serialized = serializeDirectBackgrounds({
      '!one:test': { preset: 'aero-sky' },
      '!two:test': { preset: 'none' },
      'not-a-room': { preset: 'soft-twilight' },
    });

    expect(parseDirectBackgrounds(serialized)).toEqual({
      '!one:test': { preset: 'aero-sky', mxcUrl: undefined },
    });
  });

  it('maps Matrix event thresholds to the three truthful permission modes', () => {
    expect(thresholdForBackgroundPermission('members')).toBe(0);
    expect(thresholdForBackgroundPermission('decorators')).toBe(25);
    expect(thresholdForBackgroundPermission('admins')).toBe(50);
    expect(backgroundPermissionForThreshold(0)).toBe('members');
    expect(backgroundPermissionForThreshold(25)).toBe('decorators');
    expect(backgroundPermissionForThreshold(75)).toBe('admins');
  });
});
