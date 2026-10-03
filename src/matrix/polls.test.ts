import { describe, expect, it } from 'vitest';
import { aggregatePoll, createPollStart, parsePollStart, POLL_END, POLL_RESPONSE, POLL_START, POLL_TEXT, type PollRelation } from './polls';

const definition = {
  question: 'Lunch?', answers: [{ id: 'a', text: 'Soup' }, { id: 'b', text: 'Salad' }], disclosed: true, maxSelections: 1,
};
const response = (id: string, senderId: string, timestamp: number, answers: unknown): PollRelation => ({
  id, senderId, timestamp, type: POLL_RESPONSE,
  content: { 'm.relates_to': { rel_type: 'm.reference', event_id: '$poll' }, [POLL_RESPONSE]: { answers } },
});

describe('Matrix polls', () => {
  it('authors a readable unstable poll and validates incoming options', () => {
    const wire = createPollStart('Lunch?', ['Soup', 'Salad'], true);
    expect(wire.type).toBe(POLL_START);
    expect(wire.content[POLL_TEXT]).toContain('1. Soup');
    expect(parsePollStart(wire.type, wire.content)).toMatchObject({ question: 'Lunch?', disclosed: true, answers: [{ text: 'Soup' }, { text: 'Salad' }] });
    expect(() => createPollStart('Lunch?', ['Soup', 'soup'], true)).toThrow('distinct');
    expect(parsePollStart(POLL_START, { [POLL_START]: { question: { [POLL_TEXT]: 'Q' }, answers: [{ id: 'a', [POLL_TEXT]: 'A' }, { id: 'a', [POLL_TEXT]: 'B' }] } })).toBeUndefined();
  });

  it('uses the latest vote per user, including invalid replacements, and ignores late votes', () => {
    const events: PollRelation[] = [
      response('$1', '@alice:test', 1, ['a']),
      response('$2', '@bob:test', 2, ['b']),
      response('$3', '@alice:test', 3, ['missing']),
      response('$4', '@bob:test', 4, ['a']),
      { id: '$end', senderId: '@owner:test', timestamp: 5, type: POLL_END, canEnd: true, content: { 'm.relates_to': { rel_type: 'm.reference', event_id: '$poll' }, [POLL_END]: {}, [POLL_TEXT]: 'Poll ended' } },
      response('$late', '@alice:test', 6, ['a']),
    ];
    expect(aggregatePoll(definition, '$poll', '@alice:test', events)).toMatchObject({
      counts: { a: 1, b: 0 }, totalVotes: 1, ownAnswers: [], closed: true, endEventId: '$end',
    });
  });

  it('ignores unauthorized ends and redacted responses', () => {
    const events = [response('$1', '@alice:test', 1, ['a']),
      { id: '$bad-end', senderId: '@other:test', timestamp: 2, type: POLL_END, canEnd: false, content: { 'm.relates_to': { rel_type: 'm.reference', event_id: '$poll' } } },
      { ...response('$redacted', '@alice:test', 3, ['b']), redacted: true },
    ];
    expect(aggregatePoll(definition, '$poll', '@alice:test', events)).toMatchObject({ counts: { a: 1, b: 0 }, ownAnswers: ['a'], closed: false });
  });

  it('ignores malformed authorized end events and keeps counting votes', () => {
    const relation = { 'm.relates_to': { rel_type: 'm.reference', event_id: '$poll' } };
    const events: PollRelation[] = [
      response('$1', '@alice:test', 1, ['a']),
      { id: '$bad-end', senderId: '@owner:test', timestamp: 2, type: POLL_END, canEnd: true, content: { ...relation, [POLL_END]: {} } },
      response('$2', '@bob:test', 3, ['b']),
      { id: '$end', senderId: '@owner:test', timestamp: 4, type: POLL_END, canEnd: true, content: { ...relation, [POLL_END]: {}, [POLL_TEXT]: 'Closed' } },
    ];
    expect(aggregatePoll(definition, '$poll', '@alice:test', events)).toMatchObject({ counts: { a: 1, b: 1 }, closed: true, endEventId: '$end' });
  });

  it('resolves competing closures independently of relation page order', () => {
    const relation = { 'm.relates_to': { rel_type: 'm.reference', event_id: '$poll' } };
    const close = (id: string, timestamp: number): PollRelation => ({
      id, timestamp, senderId: '@owner:test', type: POLL_END, canEnd: true,
      content: { ...relation, [POLL_END]: {}, [POLL_TEXT]: 'Poll ended' },
    });
    const events = [
      close('$later', 11), response('$late-vote', '@alice:test', 12, ['a']),
      close('$first', 10), response('$same-time-vote', '@bob:test', 10, ['b']),
      close('$same-time-end', 10), response('$early-vote', '@alice:test', 9, ['a']),
    ];
    for (const relations of [events, [...events].reverse()]) {
      expect(aggregatePoll(definition, '$poll', '@alice:test', relations)).toMatchObject({
        closed: true, endEventId: '$first', counts: { a: 1, b: 1 }, totalVotes: 2,
      });
    }
  });
});
