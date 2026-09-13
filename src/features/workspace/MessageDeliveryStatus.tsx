import { useRef, useState } from 'react';
import type { MessageSummary } from '../../matrix/viewModels';
import { deliveryFailureCopy } from '../../matrix/messageDelivery';
import { useAction } from '../../components/useAction';

export interface MessageDeliveryActions {
  onRetryMessage?: (roomId: string, eventId: string) => Promise<void>;
  onCancelMessage?: (roomId: string, eventId: string) => Promise<void>;
}

const labels = {
  queued: 'Queued…', encrypting: 'Encrypting…', sending: 'Sending…',
  failed: 'Send not confirmed', accepted: 'Accepted by server',
};

export function MessageDeliveryStatus({ message, onRetryMessage, onCancelMessage }: MessageDeliveryActions & { message: MessageSummary }) {
  const { busy, run } = useAction();
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  if (!message.isOwn || !message.delivery) return null;
  const status = message.delivery;
  if (status === 'accepted') return <span className="sending-label" title="The homeserver accepted this message. This does not confirm that another device has read or decrypted it.">{labels[status]}</span>;
  const recover = (cancel: boolean) => {
    const action = cancel ? onCancelMessage : onRetryMessage;
    if (!action) return;
    const scope = container.current?.closest('.thread-panel, .conversation');
    void run(async () => {
      setError('');
      setCancelling(cancel);
      try {
        await action(message.roomId, message.id);
        if (cancel) requestAnimationFrame(() => {
          if (scope?.isConnected && document.activeElement === document.body) {
            const composer = scope.querySelector<HTMLElement>('textarea:not(:disabled), [role="textbox"]');
            if (composer?.checkVisibility()) composer.focus();
          }
        });
      } catch {
        setError(cancel ? 'This message could not be cancelled. Its status may have changed.' : 'Retry was not confirmed. Check your connection or encryption status, then try again.');
      }
    });
  };
  return <div ref={container} onFocusCapture={() => container.current?.scrollIntoView?.({ block: 'nearest' })} className={`message-delivery${status === 'failed' ? ' message-delivery--failed' : ''}`}>
    <span role="status">{message.pendingEdit ? 'Edit: ' : ''}{labels[status]}</span>
    {status === 'failed' ? <p>{message.deliveryError ?? deliveryFailureCopy()}</p> : null}
    <div className="message-delivery__actions">
      {status === 'failed' && onRetryMessage ? <button className="aqua-button" type="button" disabled={busy} onClick={() => recover(false)}>{busy && !cancelling ? 'Retrying…' : 'Retry message'}</button> : null}
      {status === 'failed' && onCancelMessage ? <button className="aqua-button" type="button" disabled={busy} onClick={() => recover(true)}>{busy && cancelling ? 'Cancelling…' : 'Cancel message'}</button> : null}
    </div>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
