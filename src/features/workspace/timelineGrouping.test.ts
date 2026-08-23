import { describe, expect, it } from 'vitest';
import type { MessageSummary } from '../../matrix/viewModels';
import {
  deriveTimelineDaySeparators,
  formatTimelineDayLabel,
  TIMELINE_QUIET_PERIOD_MS,
} from './timelineGrouping';

function message(id: string, timestamp: number): MessageSummary {
  return {
    id,
    roomId: '!room:test',
    senderId: '@sender:test',
    senderName: 'Sender',
    body: id,
    timestamp,
    kind: 'text',
    isOwn: false,
  };
}

function localTimestamp(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

describe('timeline day grouping', () => {
  it('does not infer a separator for the first item', () => {
    const messages = [message('first', localTimestamp(2026, 3, 10, 12))];

    expect(deriveTimelineDaySeparators(messages, { now: localTimestamp(2026, 3, 10) })).toEqual([]);
  });

  it('requires both a local calendar-day advance and at least six quiet hours', () => {
    const previous = localTimestamp(2026, 3, 10, 22);
    const underThreshold = previous + TIMELINE_QUIET_PERIOD_MS - 1;
    const atThreshold = previous + TIMELINE_QUIET_PERIOD_MS;

    expect(deriveTimelineDaySeparators([
      message('previous', previous),
      message('too-soon', underThreshold),
    ])).toEqual([]);

    expect(deriveTimelineDaySeparators([
      message('previous', previous),
      message('enough-quiet', atThreshold),
    ], { now: atThreshold, locale: 'en-US' })).toEqual([
      {
        beforeIndex: 1,
        timestamp: atThreshold,
        label: 'Today',
        accessibleLabel: 'Wednesday, March 11, 2026',
      },
    ]);
  });

  it('does not create a divider for a long same-day pause', () => {
    const morning = localTimestamp(2026, 3, 10, 1);
    const evening = localTimestamp(2026, 3, 10, 23);

    expect(deriveTimelineDaySeparators([
      message('morning', morning),
      message('evening', evening),
    ])).toEqual([]);
  });

  it('creates one divider after a multi-day gap', () => {
    const earlier = localTimestamp(2026, 3, 1, 9);
    const later = localTimestamp(2026, 3, 6, 9);

    expect(deriveTimelineDaySeparators([
      message('earlier', earlier),
      message('later', later),
    ], { now: localTimestamp(2026, 3, 10), locale: 'en-US' })).toEqual([
      {
        beforeIndex: 1,
        timestamp: later,
        label: 'Friday, Mar 6',
        accessibleLabel: 'Friday, March 6, 2026',
      },
    ]);
  });
});

describe('timeline day labels', () => {
  const now = localTimestamp(2026, 3, 10, 15);

  it('uses relative visual labels with full accessible dates', () => {
    expect(formatTimelineDayLabel(localTimestamp(2026, 3, 10, 8), {
      now,
      locale: 'en-US',
    })).toEqual({
      label: 'Today',
      accessibleLabel: 'Tuesday, March 10, 2026',
    });

    expect(formatTimelineDayLabel(localTimestamp(2026, 3, 9, 8), {
      now,
      locale: 'en-US',
    })).toEqual({
      label: 'Yesterday',
      accessibleLabel: 'Monday, March 9, 2026',
    });
  });

  it('uses a localized weekday and date for older days', () => {
    expect(formatTimelineDayLabel(localTimestamp(2026, 3, 7, 8), {
      now,
      locale: 'en-US',
    })).toEqual({
      label: 'Saturday, Mar 7',
      accessibleLabel: 'Saturday, March 7, 2026',
    });
  });
});
