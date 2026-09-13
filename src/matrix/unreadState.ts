export const MARKED_UNREAD_EVENT = 'm.marked_unread';
export const LEGACY_MARKED_UNREAD_EVENT = 'com.famedly.marked_unread';
export const UNREAD_RETURN_POINT = 'dev.alucard.aimtrix.return_point';

export function validUnreadEventId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && /^\$\S+$/.test(value) &&
    [...value].every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);
}

/** The standard flag works in other clients; the optional extension saves our return location. */
export function parseMarkedUnread(content: unknown): { markedUnread: boolean; unreadEventId?: string } {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return { markedUnread: false };
  const value = content as Record<string, unknown>;
  if (value.unread !== true) return { markedUnread: false };
  const extension = value[UNREAD_RETURN_POINT];
  const eventId = extension && typeof extension === 'object' && !Array.isArray(extension)
    ? (extension as Record<string, unknown>).event_id : undefined;
  return { markedUnread: true, unreadEventId: validUnreadEventId(eventId) ? eventId : undefined };
}
