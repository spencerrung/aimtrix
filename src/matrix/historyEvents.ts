import type { MatrixEvent } from 'matrix-js-sdk';

export const HISTORY_MESSAGE_LIMIT = 250;
export const HISTORY_RAW_LIMIT = 10_000;
export const supportedMessageTypes = new Set(['m.text', 'm.notice', 'm.emote', 'm.image', 'm.file', 'm.audio', 'm.video', 'm.location']);

/** Remove the plain-text reply quotation included for clients without reply support. */
export function stripReplyFallback(body: string): string {
  const lines = body.split('\n');
  let index = 0;
  while (index < lines.length && lines[index].startsWith('> ')) index += 1;
  if (index > 0 && lines[index] === '') index += 1;
  return lines.slice(index).join('\n') || body;
}

export function historyEventContent(event: MatrixEvent): Record<string, unknown> {
  return event.getOriginalContent?.() ?? event.getContent();
}

export function historyRelation(event: MatrixEvent): { rel_type?: string; event_id?: string; 'm.in_reply_to'?: { event_id?: string } } | undefined {
  const relation = historyEventContent(event)['m.relates_to'];
  return relation && typeof relation === 'object' ? relation : undefined;
}

/** Mirrors the visible rows in the snapshot, including recoverable pending edits. */
export function isVisibleTimelineEvent(event: MatrixEvent): boolean {
  if (!event.getId() || !event.getSender() || event.status === 'cancelled') return false;
  if (event.isRedacted()) return event.getType() === 'org.matrix.msc3381.poll.start' || event.getType() === 'm.poll.start';
  if (event.isState?.()) return false;
  if (historyRelation(event)?.rel_type === 'm.replace' && (event.status === null || event.status === 'sent')) return false;
  const type = event.getType();
  if (type === 'm.room.encrypted') return true;
  const content = historyEventContent(event);
  if (type === 'm.sticker') return typeof content.body === 'string';
  if (type === 'org.matrix.msc3381.poll.start' || type === 'm.poll.start') return true;
  if (type === 'm.room.message' && content.msgtype === 'm.location') return true;
  return type === 'm.room.message' && typeof content.msgtype === 'string' && content.msgtype.length > 0
    && (typeof content.body === 'string' || !supportedMessageTypes.has(content.msgtype));
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
