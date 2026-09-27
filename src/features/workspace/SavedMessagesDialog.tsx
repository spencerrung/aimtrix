import { useState } from 'react';
import { Dialog, DialogClose } from '../../components/Dialog';
import type { SavedReference } from '../../matrix/savedReferences';
import type { RoomSummary } from '../../matrix/viewModels';

export function SavedMessagesDialog({ items, rooms, onOpen, onRemove, onClose }: {
  items: SavedReference[];
  rooms: RoomSummary[];
  onOpen: (roomId: string, eventId: string) => Promise<void>;
  onRemove: (roomId: string, eventId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const act = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError('');
    try { await action(); } catch { setError('That message is unavailable or the action failed. Check your access and try again.'); }
    finally { setBusy(''); }
  };
  return <Dialog className="saved-messages-dialog" aria-label="Saved messages" onClose={onClose}>
    <header><h2>Saved messages</h2><DialogClose aria-label="Close saved messages">Close</DialogClose></header>
    <p>Only room and event references are saved in your Matrix account data. The homeserver can see those references; message text is fetched when you open a result.</p>
    {error ? <p role="alert">{error}</p> : null}
    {items.length ? <ul>{items.map((item) => {
      const room = rooms.find((entry) => entry.id === item.roomId && entry.membership === 'join');
      const key = `${item.roomId}:${item.eventId}`;
      return <li key={key}>
        <button type="button" className="aqua-button" disabled={!room || Boolean(busy)} onClick={() => void act(key, async () => { await onOpen(item.roomId, item.eventId); onClose(); })}>
          <strong>{room?.name ?? 'Conversation no longer available'}</strong>
          <span>Saved {new Date(item.savedAt).toLocaleString()}</span>
        </button>
        <button type="button" className="aqua-button" disabled={Boolean(busy)} aria-label={`Remove saved message from ${room?.name ?? 'unavailable conversation'}`} onClick={() => void act(key, () => onRemove(item.roomId, item.eventId))}>Remove</button>
      </li>;
    })}</ul> : <p>No saved messages yet. Use Save message in a message’s actions to add one.</p>}
  </Dialog>;
}
