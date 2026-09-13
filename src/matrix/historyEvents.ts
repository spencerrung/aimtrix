import type { MatrixEvent } from 'matrix-js-sdk';

export const HISTORY_MESSAGE_LIMIT = 250;
export const HISTORY_RAW_LIMIT = 10_000;
const messageTypes = new Set(['m.text', 'm.notice', 'm.emote', 'm.image', 'm.file', 'm.audio', 'm.video']);

export function historyEventContent(event: MatrixEvent): Record<string, unknown> {
  return event.getOriginalContent?.() ?? event.getContent();
}

export function historyRelation(event: MatrixEvent): { rel_type?: string; event_id?: string; 'm.in_reply_to'?: { event_id?: string } } | undefined {
  const relation = historyEventContent(event)['m.relates_to'];
  return relation && typeof relation === 'object' ? relation : undefined;
}

/** Mirrors the visible rows in the snapshot, including recoverable pending edits. */
export function isVisibleTimelineEvent(event: MatrixEvent): boolean {
  if (!event.getId() || !event.getSender() || event.isRedacted() || event.status === 'cancelled') return false;
  if (historyRelation(event)?.rel_type === 'm.replace' && (event.status === null || event.status === 'sent')) return false;
  const type = event.getType();
  if (type === 'm.room.encrypted') return true;
  const content = historyEventContent(event);
  if (typeof content.body !== 'string') return false;
  return type === 'm.sticker' || (type === 'm.room.message' && messageTypes.has(String(content.msgtype)));
}

/** Trim visible rows while retaining loaded edits/reactions for their originals. */
export function boundedTimelineEvents(events: MatrixEvent[], maxVisible = HISTORY_MESSAGE_LIMIT, direction: 'backward' | 'forward' = 'backward'): MatrixEvent[] {
  const raw = direction === 'backward' ? events.slice(-HISTORY_RAW_LIMIT) : events.slice(0, HISTORY_RAW_LIMIT);
  const visible = raw.filter(isVisibleTimelineEvent);
  const selected = direction === 'backward' ? visible.slice(-maxVisible) : visible.slice(0, maxVisible);
  const selectedEvents = new Set(selected);
  const selectedIds = new Set(selected.map((event) => event.getId()));
  return raw.filter((event) => selectedEvents.has(event) || (!isVisibleTimelineEvent(event) && selectedIds.has(historyRelation(event)?.event_id)));
}
