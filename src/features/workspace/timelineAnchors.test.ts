import { describe, expect, it } from 'vitest';
import { captureTimelineAnchor, restoreTimelineAnchor } from './timelineAnchors';

function fixture() {
  const container = document.createElement('section');
  container.scrollTop = 100;
  container.getBoundingClientRect = () => ({ top: 20, bottom: 220, height: 200 }) as DOMRect;
  const positions = new Map<string, number>();
  const add = (id: string, top: number, key = id) => {
    const row = document.createElement('article');
    row.dataset.eventId = id;
    row.dataset.messageKey = key;
    positions.set(id, top);
    row.getBoundingClientRect = () => {
      const offset = positions.get(id)! - container.scrollTop + 20;
      return { top: offset, bottom: offset + 50, height: 50 } as DOMRect;
    };
    container.append(row);
    return row;
  };
  return { container, positions, add };
}

describe('timeline event anchors', () => {
  it('preserves the visible event when prepending and trimming the other edge keep total height unchanged', () => {
    const { container, positions, add } = fixture();
    add('older', 0);
    const visible = add('reading', 100);
    const tail = add('tail', 300);
    const anchor = captureTimelineAnchor(container);
    tail.remove();
    add('new-older', 0);
    positions.set('reading', 180);
    expect(restoreTimelineAnchor(container, anchor)).toBe(true);
    expect(container.scrollTop).toBe(180);
    expect(visible.getBoundingClientRect().top).toBe(20);
  });

  it('uses a surviving nearby event when the primary anchor was trimmed or redacted', () => {
    const { container, positions, add } = fixture();
    const primary = add('reading', 100);
    const backup = add('next', 150);
    const anchor = captureTimelineAnchor(container);
    primary.remove();
    positions.set('next', 90);
    expect(restoreTimelineAnchor(container, anchor)).toBe(true);
    expect(backup.getBoundingClientRect().top).toBe(70);
  });

  it('keeps a local echo anchored when its event ID becomes a server event ID', () => {
    const { container, positions, add } = fixture();
    const row = add('local-id', 100, 'stable-transaction');
    const anchor = captureTimelineAnchor(container);
    row.dataset.eventId = '$accepted';
    positions.set('local-id', 130);
    expect(restoreTimelineAnchor(container, anchor)).toBe(true);
    expect(container.scrollTop).toBe(130);
  });

  it('compensates for media growth above the reader without following growth below', () => {
    const { container, positions, add } = fixture();
    add('reading', 100);
    add('below', 200);
    const anchor = captureTimelineAnchor(container);
    positions.set('below', 400);
    restoreTimelineAnchor(container, anchor);
    expect(container.scrollTop).toBe(100);
    positions.set('reading', 165);
    restoreTimelineAnchor(container, anchor);
    expect(container.scrollTop).toBe(165);
  });

  it('does not invent an anchor for hidden rows or move after all anchors disappear', () => {
    const { container, add } = fixture();
    add('offscreen', 800);
    expect(captureTimelineAnchor(container)).toBeUndefined();
    add('reading', 100);
    const anchor = captureTimelineAnchor(container);
    container.replaceChildren();
    expect(restoreTimelineAnchor(container, anchor)).toBe(false);
    expect(container.scrollTop).toBe(100);
  });
});
