import { describe, expect, it } from 'vitest';
import { colorForId, initialsFor } from './viewModels';

describe('view model presentation helpers', () => {
  it('creates compact initials for buddies and rooms', () => {
    expect(initialsFor('Mara Chen')).toBe('MC');
    expect(initialsFor('Aimtrix')).toBe('AI');
    expect(initialsFor('')).toBe('?');
  });

  it('assigns stable colors without exposing identifiers', () => {
    expect(colorForId('@mara:example.com')).toBe(colorForId('@mara:example.com'));
    expect(colorForId('@mara:example.com')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
