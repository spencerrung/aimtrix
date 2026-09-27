export const SAVED_REFERENCES_EVENT = 'im.aimtrix.saved_events.v1';
export const MAX_SAVED_REFERENCES = 200;

export interface SavedReference {
  roomId: string;
  eventId: string;
  savedAt: number;
}

/** Account data is visible to the homeserver. Only opaque event references go here. */
export function parseSavedReferences(value: unknown): SavedReference[] {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)) return [];
  const seen = new Set<string>();
  const result: SavedReference[] = [];
  for (const candidate of value.items.slice(0, MAX_SAVED_REFERENCES * 2)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const { roomId, eventId, savedAt } = candidate as Record<string, unknown>;
    if (typeof roomId !== 'string' || !/^![^\s]{1,255}$/.test(roomId) ||
        typeof eventId !== 'string' || !/^\$[^\s]{1,255}$/.test(eventId) ||
        typeof savedAt !== 'number' || !Number.isSafeInteger(savedAt) || savedAt < 0 || savedAt > 8_640_000_000_000_000) continue;
    const key = `${roomId}\0${eventId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ roomId, eventId, savedAt });
    if (result.length === MAX_SAVED_REFERENCES) break;
  }
  return result.sort((a, b) => b.savedAt - a.savedAt);
}

export function changeSavedReference(items: SavedReference[], roomId: string, eventId: string, save: boolean, now = Date.now()): SavedReference[] {
  const other = items.filter((item) => item.roomId !== roomId || item.eventId !== eventId);
  return save ? [{ roomId, eventId, savedAt: now }, ...other].slice(0, MAX_SAVED_REFERENCES) : other;
}
