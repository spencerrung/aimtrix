import { describe, expect, it } from 'vitest';
import { MatrixEvent } from 'matrix-js-sdk';
import { boundedTimelineEvents, isVisibleTimelineEvent } from './historyEvents';

function message(index: number) {
  return new MatrixEvent({ type: 'm.room.message', event_id: `$message-${index}`, sender: '@synthetic:test', content: { msgtype: 'm.text', body: `Synthetic ${index}` } });
}

describe('visible history capacity', () => {
  it('keeps 250 visible messages through a tail full of reactions and edits', () => {
    const messages = Array.from({ length: 400 }, (_, i) => message(i));
    const relations = Array.from({ length: 800 }, (_, i) => new MatrixEvent({ type: 'm.reaction', event_id: `$reaction-${i}`, sender: '@synthetic:test', content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$message-399', key: '✨' } } }));
    const edit = new MatrixEvent({ type: 'm.room.message', event_id: '$edit', sender: '@synthetic:test', content: { msgtype: 'm.text', body: '* Correction', 'm.new_content': { msgtype: 'm.text', body: 'Correction' }, 'm.relates_to': { rel_type: 'm.replace', event_id: '$message-399' } } });
    const result = boundedTimelineEvents([...messages, ...relations, edit]);
    expect(result.filter(isVisibleTimelineEvent)).toHaveLength(250);
    expect(result[0].getId()).toBe('$message-150');
    expect(result).toContain(edit);
    expect(result).toContain(relations[799]);
    expect(boundedTimelineEvents(messages, 250, 'forward').at(-1)?.getId()).toBe('$message-249');
  });

  it('excludes cancelled and redacted rows while retaining unresolved encrypted messages', () => {
    const cancelled = message(0);
    Object.assign(cancelled, { status: 'cancelled' });
    const redacted = message(1);
    Object.assign(redacted, { isRedacted: () => true });
    const encrypted = new MatrixEvent({ type: 'm.room.encrypted', event_id: '$encrypted', sender: '@synthetic:test', content: { algorithm: 'm.megolm.v1.aes-sha2' } });
    expect(boundedTimelineEvents([cancelled, redacted, encrypted]).filter(isVisibleTimelineEvent)).toEqual([encrypted]);
  });
});
