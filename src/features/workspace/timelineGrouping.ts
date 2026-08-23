import type { MessageSummary } from '../../matrix/viewModels';

export const TIMELINE_QUIET_PERIOD_MS = 6 * 60 * 60 * 1_000;

export interface TimelineDaySeparator {
  /** Index of the message immediately following the separator. */
  beforeIndex: number;
  timestamp: number;
  label: string;
  accessibleLabel: string;
}

export interface TimelineGroupingOptions {
  now?: number | Date;
  locale?: string | string[];
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dateFromNow(now: number | Date | undefined): Date {
  return now === undefined ? new Date() : new Date(now);
}

export function formatTimelineDayLabel(
  timestamp: number,
  options: TimelineGroupingOptions = {},
): Pick<TimelineDaySeparator, 'label' | 'accessibleLabel'> {
  const date = new Date(timestamp);
  const now = dateFromNow(options.now);
  const day = startOfLocalDay(timestamp);
  const today = startOfLocalDay(now.getTime());
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);

  let label: string;
  if (day === today) {
    label = 'Today';
  } else if (day === yesterdayDate.getTime()) {
    label = 'Yesterday';
  } else {
    label = new Intl.DateTimeFormat(options.locale, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  return {
    label,
    accessibleLabel: new Intl.DateTimeFormat(options.locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date),
  };
}

/**
 * Derives separators solely from adjacent messages. A separator belongs before
 * the later message when its local calendar day advances after at least six
 * hours of quiet time.
 */
export function deriveTimelineDaySeparators(
  messages: readonly MessageSummary[],
  options: TimelineGroupingOptions = {},
): TimelineDaySeparator[] {
  const separators: TimelineDaySeparator[] = [];

  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const current = messages[index];
    const elapsed = current.timestamp - previous.timestamp;

    if (
      elapsed >= TIMELINE_QUIET_PERIOD_MS
      && startOfLocalDay(current.timestamp) > startOfLocalDay(previous.timestamp)
    ) {
      separators.push({
        beforeIndex: index,
        timestamp: current.timestamp,
        ...formatTimelineDayLabel(current.timestamp, options),
      });
    }
  }

  return separators;
}
