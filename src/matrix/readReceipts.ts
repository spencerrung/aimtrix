export interface ReaderReceipt {
  readerId: string;
  eventId: string;
}

export function resolveReadReceiptTarget(
  timelineEventIds: string[],
  renderedMessageIds: string[],
  receiptEventId: string,
): string | undefined {
  const eventIndex = new Map(timelineEventIds.map((eventId, index) => [eventId, index]));
  const receiptIndex = eventIndex.get(receiptEventId);
  if (receiptIndex === undefined) return undefined;

  for (let index = renderedMessageIds.length - 1; index >= 0; index -= 1) {
    const messageIndex = eventIndex.get(renderedMessageIds[index]);
    if (messageIndex !== undefined && messageIndex <= receiptIndex) {
      return renderedMessageIds[index];
    }
  }

  return undefined;
}

/**
 * Places each reader on the latest rendered message at or before their latest
 * unthreaded receipt. Receipts outside the loaded timeline are intentionally
 * omitted rather than guessed from timestamps.
 */
export function resolveReadReceiptTargets(
  timelineEventIds: string[],
  renderedMessageIds: string[],
  receipts: ReaderReceipt[],
  maxReadersPerMessage = 20,
): Map<string, string[]> {
  const eventIndex = new Map(timelineEventIds.map((eventId, index) => [eventId, index]));
  const rendered = renderedMessageIds.flatMap((messageId) => {
    const index = eventIndex.get(messageId);
    return index === undefined ? [] : [{ messageId, index }];
  });
  const targets = new Map<string, string[]>();

  for (const receipt of receipts) {
    const receiptIndex = eventIndex.get(receipt.eventId);
    if (receiptIndex === undefined) continue;
    let target: (typeof rendered)[number] | undefined;
    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      if (rendered[index].index <= receiptIndex) {
        target = rendered[index];
        break;
      }
    }
    if (!target) continue;
    const readers = targets.get(target.messageId) ?? [];
    if (readers.length >= maxReadersPerMessage || readers.includes(receipt.readerId)) continue;
    readers.push(receipt.readerId);
    targets.set(target.messageId, readers);
  }

  return targets;
}
