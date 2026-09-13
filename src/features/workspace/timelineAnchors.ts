export interface TimelineAnchor {
  candidates: Array<{ key: string; eventId: string; offset: number }>;
}

export function historyRows(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-event-id][data-message-key]')];
}

/** Remember reading content, not total height: either edge of a bounded window may trim. */
export function captureTimelineAnchor(container: HTMLElement): TimelineAnchor | undefined {
  const viewport = container.getBoundingClientRect();
  const rows = historyRows(container);
  const firstVisible = rows.findIndex((row) => {
    const bounds = row.getBoundingClientRect();
    return bounds.height > 0 && bounds.bottom > viewport.top && bounds.top < viewport.bottom;
  });
  if (firstVisible < 0) return undefined;
  const candidates = rows.map((row, index) => ({
    key: row.dataset.messageKey!, eventId: row.dataset.eventId!,
    offset: row.getBoundingClientRect().top - viewport.top, distance: Math.abs(index - firstVisible),
  })).sort((left, right) => left.distance - right.distance)
    .map(({ key, eventId, offset }) => ({ key, eventId, offset }));
  return { candidates };
}

/** Returns false only when none of the remembered rows survives the new window. */
export function restoreTimelineAnchor(container: HTMLElement, anchor?: TimelineAnchor): boolean {
  if (!anchor) return false;
  const rows = historyRows(container);
  for (const candidate of anchor.candidates) {
    const row = rows.find((item) => item.dataset.messageKey === candidate.key || item.dataset.eventId === candidate.eventId);
    if (!row) continue;
    const offset = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    container.scrollTop += offset - candidate.offset;
    return true;
  }
  return false;
}
