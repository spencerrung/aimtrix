import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { ReceiptType } from 'matrix-js-sdk/lib/@types/read_receipts.js';
import { Method } from 'matrix-js-sdk/lib/http-api/method.js';
import { validUnreadEventId } from './unreadState';

/**
 * Send the standard scoped receipt without SDK local echo. SDK sendReadReceipt
 * synthesizes a receipt before HTTP succeeds, clearing encrypted highlights even
 * on failure. The controller handles acknowledged counters; sync owns receipts.
 * The caller supplies the scope selected by the SDK's receipt classification.
 */
export async function sendConfirmedReceipt(
  client: MatrixClient,
  event: MatrixEvent,
  receiptType: ReceiptType.Read | ReceiptType.ReadPrivate,
  threadId: string,
): Promise<void> {
  const roomId = event.getRoomId();
  const eventId = event.getId();
  const room = roomId ? client.getRoom(roomId) : null;
  if (!room || !roomId || !validUnreadEventId(eventId) || event.status || room.hasPendingEvent(eventId)) {
    throw new Error('This message is not available for read tracking.');
  }
  if ((receiptType !== ReceiptType.Read && receiptType !== ReceiptType.ReadPrivate) ||
      (threadId !== 'main' && !validUnreadEventId(threadId))) {
    throw new Error('This read receipt scope is not supported.');
  }
  const path = `/rooms/${encodeURIComponent(roomId)}/receipt/${encodeURIComponent(receiptType)}/${encodeURIComponent(eventId)}`;
  await client.http.authedRequest(Method.Post, path, undefined, { thread_id: threadId });
}
