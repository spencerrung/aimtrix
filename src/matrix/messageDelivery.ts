import type { EventStatus } from 'matrix-js-sdk';

export type MessageDelivery = 'queued' | 'encrypting' | 'sending' | 'failed' | 'accepted';

/** Server acceptance is separate from a recipient's read position or decryption. */
export function deliveryForStatus(status: EventStatus | null): MessageDelivery | undefined {
  switch (status) {
    case 'queued': return 'queued';
    case 'encrypting': return 'encrypting';
    case 'sending': return 'sending';
    case 'not_sent': return 'failed';
    case 'sent':
    case null: return 'accepted';
    default: return undefined;
  }
}

export function deliveryFailureCopy(error?: { errcode?: string } | null): string {
  switch (error?.errcode) {
    case 'M_FORBIDDEN': return 'The server refused this message. Check your room permissions before retrying.';
    case 'M_LIMIT_EXCEEDED': return 'The server is busy. Wait a moment, then retry.';
    case 'M_TOO_LARGE': return 'This message is too large. Cancel it and send a shorter message.';
    case 'M_UNKNOWN_TOKEN':
    case 'M_MISSING_TOKEN': return 'Your session needs attention. Reconnect before retrying.';
    default: return 'Send was not confirmed. Check your connection or encryption status, then retry. Retrying reuses this message.';
  }
}

export class MessageSendError extends Error {
  constructor(public readonly localEchoRetained: boolean) {
    super(localEchoRetained ? 'This message is available to retry in the conversation.' : 'The message could not be prepared. Your draft is preserved.');
    this.name = 'MessageSendError';
  }
}
