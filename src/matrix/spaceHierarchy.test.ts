import { describe, expect, it } from 'vitest';
import { resolveSpaceRelations } from './spaceHierarchy';

describe('resolveSpaceRelations', () => {
  it('keeps direct rooms and rolls nested subspace rooms into the parent scope', () => {
    const result = resolveSpaceRelations(
      [
        { id: 'ouroboros', childIds: ['general', 'vidja'], parentIds: [] },
        { id: 'vidja', childIds: ['games', 'screenshots', 'co-op'], parentIds: [] },
      ],
      new Set(['general', 'games', 'screenshots', 'co-op']),
    );

    expect(result).toEqual([
      {
        id: 'ouroboros',
        childIds: ['general', 'vidja'],
        directRoomIds: ['general'],
        childSpaceIds: ['vidja'],
        parentSpaceIds: [],
        roomIds: ['general', 'games', 'screenshots', 'co-op'],
      },
      {
        id: 'vidja',
        childIds: ['games', 'screenshots', 'co-op'],
        directRoomIds: ['games', 'screenshots', 'co-op'],
        childSpaceIds: [],
        parentSpaceIds: ['ouroboros'],
        roomIds: ['games', 'screenshots', 'co-op'],
      },
    ]);
  });

  it('shows a child beneath its explicit parent even when only m.space.parent is available', () => {
    const result = resolveSpaceRelations(
      [
        { id: 'parent', childIds: ['lobby'], parentIds: [] },
        { id: 'child', childIds: ['games'], parentIds: ['parent'] },
      ],
      new Set(['lobby', 'games']),
    );

    expect(result[0].childSpaceIds).toEqual(['child']);
    expect(result[0].roomIds).toEqual(['lobby', 'games']);
    expect(result[1].parentSpaceIds).toEqual(['parent']);
  });

  it('merges explicit parents and remains safe when malformed state contains a cycle', () => {
    const result = resolveSpaceRelations(
      [
        { id: 'one', childIds: ['two', 'room-one'], parentIds: [] },
        { id: 'two', childIds: ['one', 'room-two'], parentIds: ['one'] },
      ],
      new Set(['room-one', 'room-two']),
    );

    expect(result[0].parentSpaceIds).toEqual(['two']);
    expect(result[1].parentSpaceIds).toEqual(['one']);
    expect(result[0].roomIds).toEqual(['room-two', 'room-one']);
    expect(result[1].roomIds).toEqual(['room-one', 'room-two']);
  });
});
