import { describe, expect, it } from 'vitest';
import { resolveReadReceiptTarget, resolveReadReceiptTargets } from './readReceipts';

describe('read receipt placement', () => {
  it('places a receipt on the latest rendered message at or before a timeline event', () => {
    const targets = resolveReadReceiptTargets(
      ['$message-one', '$reaction', '$message-two', '$edit'],
      ['$message-one', '$message-two'],
      [
        { readerId: '@mara:test', eventId: '$reaction' },
        { readerId: '@pixel:test', eventId: '$edit' },
      ],
    );

    expect(targets.get('$message-one')).toEqual(['@mara:test']);
    expect(targets.get('$message-two')).toEqual(['@pixel:test']);
  });

  it('resolves the current user position when the receipt points to a non-message event', () => {
    expect(resolveReadReceiptTarget(
      ['$message-one', '$reaction', '$message-two'],
      ['$message-one', '$message-two'],
      '$reaction',
    )).toBe('$message-one');
  });

  it('ignores missing receipts, deduplicates readers, and bounds crowded rows', () => {
    const targets = resolveReadReceiptTargets(
      ['$one'],
      ['$one'],
      [
        { readerId: '@outside:test', eventId: '$not-loaded' },
        { readerId: '@one:test', eventId: '$one' },
        { readerId: '@one:test', eventId: '$one' },
        { readerId: '@two:test', eventId: '$one' },
      ],
      1,
    );

    expect(targets.get('$one')).toEqual(['@one:test']);
    expect([...targets.values()].flat()).not.toContain('@outside:test');
  });
});
