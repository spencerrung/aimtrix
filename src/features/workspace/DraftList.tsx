import { Dialog, DialogClose } from '../../components/Dialog';
import type { RoomSummary } from '../../matrix/viewModels';
import type { DraftContext, StoredDraft } from './structuredDrafts';

export function DraftList({ drafts, rooms, onOpen, onClose, durable = true }: {
  durable?: boolean;
  drafts: StoredDraft[];
  rooms: RoomSummary[];
  onOpen(context: DraftContext): void;
  onClose(): void;
}) {
  return <Dialog className="draft-list" aria-label="Your drafts" onClose={onClose}>
    <header><h2>Your drafts</h2><DialogClose aria-label="Close drafts">Close</DialogClose></header>
    <p>{durable ? 'Saved on this device for this account.' : 'Some drafts are only in this tab; reloading can lose unsaved changes.'} Files need to be reattached after a reload.</p>
    {drafts.length ? <ul>{[...drafts].sort((a, b) => b.updatedAt - a.updatedAt).map(({ context, value }) => {
      const room = rooms.find((entry) => entry.id === context.roomId);
      return <li key={JSON.stringify([context.roomId, context.threadRootId])}><button type="button" className="aqua-button" disabled={!room || room.membership === 'invite'}
        onClick={() => onOpen(context)}>
        <strong>{room?.name ?? 'Unavailable conversation'}{context.threadRootId ? ' · Thread' : ''}</strong>
        <span>{value.edit ? 'Editing: ' : value.reply ? `Reply to ${value.reply.senderName}: ` : ''}{value.body || 'Attachments ready to revisit'}</span>
        {value.attachments?.length ? <small>{value.attachments.length} {value.attachments.length === 1 ? 'file' : 'files'}</small> : null}
      </button></li>;
    })}</ul> : <p>No unfinished messages. Your next idea has room to grow.</p>}
  </Dialog>;
}
