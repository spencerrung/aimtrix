import { describe, expect, it } from 'vitest';
import { changeSavedReference, MAX_SAVED_REFERENCES, parseSavedReferences } from './savedReferences';

describe('saved references', () => {
  it('accepts only bounded, unique opaque references', () => {
    const parsed = parseSavedReferences({ items: [
      { roomId: '!room:test', eventId: '$one', savedAt: 10, body: 'private text' },
      { roomId: '!room:test', eventId: '$one', savedAt: 20 },
      { roomId: '!room:test', eventId: 'not-event', savedAt: 21 },
      { roomId: '!other:test', eventId: '$two', savedAt: 30 },
    ] });
    expect(parsed).toEqual([
      { roomId: '!other:test', eventId: '$two', savedAt: 30 },
      { roomId: '!room:test', eventId: '$one', savedAt: 10 },
    ]);
    expect(JSON.stringify(parsed)).not.toContain('private text');
  });

  it('saves, removes, and caps references without retaining message content', () => {
    const many = Array.from({ length: MAX_SAVED_REFERENCES }, (_, index) => ({ roomId: '!room:test', eventId: `$${index}`, savedAt: index }));
    const next = changeSavedReference(many, '!room:test', '$new', true, 999);
    expect(next).toHaveLength(MAX_SAVED_REFERENCES);
    expect(next[0]).toEqual({ roomId: '!room:test', eventId: '$new', savedAt: 999 });
    expect(changeSavedReference(next, '!room:test', '$new', false)).toHaveLength(MAX_SAVED_REFERENCES - 1);
  });
});
