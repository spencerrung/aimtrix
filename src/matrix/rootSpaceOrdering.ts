const MSC3230_ORDER_PATTERN = /^[\x20-\x7E]{1,50}$/;

/** Returns whether a value is a valid MSC3230 lexicographic order string. */
export function isValidMsc3230Order(value: unknown): value is string {
  return typeof value === 'string' && MSC3230_ORDER_PATTERN.test(value);
}

/**
 * Produces stable, lexicographically sortable MSC3230 order content for root spaces.
 * Duplicate IDs retain the order assigned to their first occurrence.
 */
export function createRootSpaceOrderContent(
  rootIds: readonly string[],
): Readonly<Record<string, Readonly<{ order: string }>>> {
  const content: Record<string, Readonly<{ order: string }>> = {};
  rootIds.forEach((rootId, index) => {
    if (!(rootId in content)) content[rootId] = { order: String(index).padStart(6, '0') };
  });
  return content;
}

/**
 * Orders roots by valid per-room MSC3230 values, then a legacy account-data list,
 * while preserving input order for every remaining tie.
 */
export function sortRootSpaceIds(
  rootIds: readonly string[],
  orders: Readonly<Record<string, unknown>> | ReadonlyMap<string, unknown>,
  legacyOrder: readonly string[] = [],
): string[] {
  const legacyIndices = new Map<string, number>();
  legacyOrder.forEach((rootId, index) => {
    if (!legacyIndices.has(rootId)) legacyIndices.set(rootId, index);
  });
  const orderFor = (rootId: string): string | undefined => {
    const value = orders instanceof Map
      ? (orders as ReadonlyMap<string, unknown>).get(rootId)
      : (orders as Readonly<Record<string, unknown>>)[rootId];
    if (isValidMsc3230Order(value)) return value;
    if (value && typeof value === 'object' && isValidMsc3230Order((value as { order?: unknown }).order)) {
      return (value as { order: string }).order;
    }
    return undefined;
  };

  return rootIds
    .map((id, originalIndex) => ({ id, originalIndex, order: orderFor(id) }))
    .sort((left, right) => {
      if (left.order !== undefined && right.order !== undefined) {
        return left.order < right.order ? -1 : left.order > right.order ? 1 : left.originalIndex - right.originalIndex;
      }
      if (left.order !== undefined) return -1;
      if (right.order !== undefined) return 1;

      const leftLegacy = legacyIndices.get(left.id);
      const rightLegacy = legacyIndices.get(right.id);
      if (leftLegacy !== undefined && rightLegacy !== undefined) return leftLegacy - rightLegacy;
      if (leftLegacy !== undefined) return -1;
      if (rightLegacy !== undefined) return 1;
      return left.originalIndex - right.originalIndex;
    })
    .map(({ id }) => id);
}
