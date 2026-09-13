import { Dialog, DialogClose } from '../../components/Dialog';
import { Hash, Lock, MessageCircle, Plus, Search, Users, X } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';

export interface PublicRoomChoice {
  roomId: string;
  name: string;
  topic?: string;
  alias?: string;
  memberCount: number;
}

interface RoomDialogProps {
  onJoin?: (roomIdOrAlias: string) => Promise<void>;
  onSearch?: (query: string) => Promise<PublicRoomChoice[]>;
  onCreateDirect?: (userId: string) => Promise<string>;
  onCreate?: (options: {
    name: string;
    topic?: string;
    public: boolean;
    encrypted: boolean;
    space?: boolean;
  }) => Promise<string>;
  onClose: () => void;
  onComplete?: (message: string) => void;
}

export function RoomDialog({ onJoin, onSearch, onCreateDirect, onCreate, onClose, onComplete }: RoomDialogProps) {
  const pending = useRef(false);
  const [mode, setMode] = useState<'join' | 'direct' | 'create'>('join');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [encrypted, setEncrypted] = useState(true);
  const [space, setSpace] = useState(false);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [directoryResults, setDirectoryResults] = useState<PublicRoomChoice[]>([]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (mode === 'join') {
        if (!address.trim() || !onJoin) return;
        await onJoin(address.trim());
      } else if (mode === 'direct') {
        if (!address.trim() || !onCreateDirect) return;
        await onCreateDirect(address.trim());
      } else {
        if (!name.trim() || !onCreate) return;
        await onCreate({ name, topic, public: isPublic, encrypted: space ? false : encrypted, space });
      }
      onComplete?.(mode === 'join' ? 'Room joined.' : mode === 'direct' ? 'Direct chat ready.' : 'Room created.');
      onClose();
    } catch {
      setError(mode === 'join' ? 'Aimtrix could not join that room.' : mode === 'direct' ? 'Aimtrix could not create that direct chat.' : 'Aimtrix could not create the room.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const searchDirectory = async () => {
    if (pending.current || !onSearch || !address.trim()) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      setDirectoryResults(await onSearch(address));
      setSearched(true);
    } catch {
      setError('The public room directory could not be searched.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog className="room-dialog" backdropClassName="room-dialog-backdrop" aria-labelledby="room-dialog-title" onClose={onClose} busy={busy}>
        <header><strong id="room-dialog-title">Add a conversation</strong><DialogClose aria-label="Close"><X size={16} /></DialogClose></header>
        <div className="room-dialog-tabs" aria-label="Conversation type">
          <button type="button" disabled={busy} aria-pressed={mode === 'join'} className={mode === 'join' ? 'is-active' : ''} onClick={() => setMode('join')}><Hash size={15} /> Join room</button>
          <button type="button" disabled={busy} aria-pressed={mode === 'direct'} className={mode === 'direct' ? 'is-active' : ''} onClick={() => { setMode('direct'); setAddress(''); }}><MessageCircle size={15} /> Direct chat</button>
          <button type="button" disabled={busy} aria-pressed={mode === 'create'} className={mode === 'create' ? 'is-active' : ''} onClick={() => setMode('create')}><Plus size={15} /> Create room</button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset className="interaction-fields" disabled={busy}>
          {mode === 'join' ? (
            <>
              <label><span>Room address, ID, or directory search</span><input value={address} placeholder="#room:example.com or a public room name" onChange={(event) => { setAddress(event.target.value); setDirectoryResults([]); setSearched(false); }} data-initial-focus /></label>
              {onSearch ? <button className="aqua-button room-directory-search" type="button" disabled={busy || !address.trim()} onClick={() => void searchDirectory()}><Search size={14} /> Search public rooms</button> : null}
              {directoryResults.length ? <div className="room-directory-results">{directoryResults.map((room) => <button type="button" key={room.roomId} onClick={() => setAddress(room.alias || room.roomId)}><span><strong>{room.name}</strong><small>{room.topic || room.alias || room.roomId}</small></span><em><Users size={12} /> {room.memberCount}</em></button>)}</div> : null}
            </>
          ) : mode === 'direct' ? (
            <label><span>Matrix ID</span><input value={address} placeholder="@buddy:example.com" onChange={(event) => setAddress(event.target.value)} data-initial-focus /></label>
          ) : (
            <>
              <label><span>Room name</span><input value={name} onChange={(event) => setName(event.target.value)} data-initial-focus /></label>
              <label><span>Topic</span><input value={topic} onChange={(event) => setTopic(event.target.value)} /></label>
              <label className="room-dialog-check"><input type="checkbox" checked={space} onChange={(event) => setSpace(event.target.checked)} /><span>Create a space for organizing rooms</span></label>
              {!space ? <label className="room-dialog-check"><input type="checkbox" checked={encrypted} onChange={(event) => setEncrypted(event.target.checked)} /><span><Lock size={13} /> Encrypt this room</span></label> : null}
              <label className="room-dialog-check"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} /><span>List in the public room directory</span></label>
            </>
          )}
          </fieldset>
          <p role="status">{busy ? 'Working…' : searched ? directoryResults.length ? `${directoryResults.length} public rooms found.` : 'No public rooms found. Try a different search.' : ''}</p>
          {!(mode === 'join' ? onJoin : mode === 'direct' ? onCreateDirect : onCreate) ? <p className="settings-hint">Sign in to use this conversation action.</p> : null}
          {error ? <p className="settings-error" role="alert">{error}</p> : null}
          <button className="aqua-button aqua-button--primary" disabled={busy || !(mode === 'join' ? onJoin : mode === 'direct' ? onCreateDirect : onCreate) || (mode === 'join' || mode === 'direct' ? !address.trim() : !name.trim())}>{busy ? 'Working…' : mode === 'join' ? 'Join room' : mode === 'direct' ? 'Start direct chat' : 'Create room'}</button>
        </form>
    </Dialog>
  );
}
