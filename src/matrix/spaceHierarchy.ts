export interface SpaceHierarchyRoomData {
  id: string;
  name: string;
  avatarUrl?: string;
  topic?: string;
  roomType?: string;
  membership?: string;
  childIds: string[];
}

export interface SpaceRelationSeed {
  id: string;
  childIds: string[];
  parentIds: string[];
}

export interface ResolvedSpaceRelation {
  id: string;
  childIds: string[];
  directRoomIds: string[];
  childSpaceIds: string[];
  parentSpaceIds: string[];
  roomIds: string[];
}

/**
 * Resolves Matrix space state into a cycle-safe navigation tree. Child ordering
 * is preserved from the already Matrix-ordered seed data.
 */
export function resolveSpaceRelations(
  seeds: SpaceRelationSeed[],
  knownRoomIds: ReadonlySet<string>,
): ResolvedSpaceRelation[] {
  const spaceIds = new Set(seeds.map((seed) => seed.id));
  const seedById = new Map(seeds.map((seed) => [seed.id, seed]));
  const parentsBySpace = new Map<string, string[]>();
  const childrenBySpace = new Map(
    seeds.map((seed) => [seed.id, [...new Set(seed.childIds.filter((childId) => childId !== seed.id))]]),
  );

  for (const seed of seeds) {
    const explicitParents = seed.parentIds.filter(
      (parentId, index, values) =>
        parentId !== seed.id && spaceIds.has(parentId) && values.indexOf(parentId) === index,
    );
    parentsBySpace.set(seed.id, explicitParents);
    for (const parentId of explicitParents) {
      const children = childrenBySpace.get(parentId) ?? [];
      if (!children.includes(seed.id)) children.push(seed.id);
      childrenBySpace.set(parentId, children);
    }
  }

  for (const parent of seeds) {
    for (const childId of childrenBySpace.get(parent.id) ?? []) {
      if (!spaceIds.has(childId) || childId === parent.id) continue;
      const parents = parentsBySpace.get(childId) ?? [];
      if (!parents.includes(parent.id)) parents.push(parent.id);
      parentsBySpace.set(childId, parents);
    }
  }

  const collectRooms = (spaceId: string, ancestry: ReadonlySet<string>): string[] => {
    if (ancestry.has(spaceId)) return [];
    const seed = seedById.get(spaceId);
    if (!seed) return [];
    const nextAncestry = new Set(ancestry).add(spaceId);
    const roomIds: string[] = [];
    for (const childId of childrenBySpace.get(spaceId) ?? []) {
      if (spaceIds.has(childId)) {
        roomIds.push(...collectRooms(childId, nextAncestry));
      } else if (knownRoomIds.has(childId)) {
        roomIds.push(childId);
      }
    }
    return [...new Set(roomIds)];
  };

  return seeds.map((seed) => ({
    id: seed.id,
    childIds: childrenBySpace.get(seed.id) ?? [],
    directRoomIds: (childrenBySpace.get(seed.id) ?? []).filter(
      (childId) => !spaceIds.has(childId) && knownRoomIds.has(childId),
    ),
    childSpaceIds: (childrenBySpace.get(seed.id) ?? []).filter(
      (childId, index, values) =>
        childId !== seed.id && spaceIds.has(childId) && values.indexOf(childId) === index,
    ),
    parentSpaceIds: parentsBySpace.get(seed.id) ?? [],
    roomIds: collectRooms(seed.id, new Set()),
  }));
}
