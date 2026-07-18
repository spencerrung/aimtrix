import { Hash, Lock, MessageCircle, Plus, Search, Users, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

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
}

export function RoomDialog({ onJoin, onSearch, onCreateDirect, onCreate, onClose }: RoomDialogProps) {
  const [mode, setMode] = useState<'join' | 'direct' | 'create'>('join');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [encrypted, setEncrypted] = useState(true);
  const [space, setSpace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [directoryResults, setDirectoryResults] = useState<PublicRoomChoice[]>([]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
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
      onClose();
    } catch {
      setError(mode === 'join' ? 'Aimtrix could not join that room.' : mode === 'direct' ? 'Aimtrix could not create that direct chat.' : 'Aimtrix could not create the room.');
    } finally {
      setBusy(false);
    }
  };

  const searchDirectory = async () => {
    if (!onSearch || !address.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      setDirectoryResults(await onSearch(address));
    } catch {
      setError('The public room directory could not be searched.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="room-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="room-dialog" role="dialog" aria-modal="true" aria-labelledby="room-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><strong id="room-dialog-title">Add a conversation</strong><button type="button" aria-label="Close" onClick={onClose}><X size={16} /></button></header>
        <div className="room-dialog-tabs">
          <button type="button" className={mode === 'join' ? 'is-active' : ''} onClick={() => setMode('join')}><Hash size={15} /> Join room</button>
          <button type="button" className={mode === 'direct' ? 'is-active' : ''} onClick={() => { setMode('direct'); setAddress(''); }}><MessageCircle size={15} /> Direct chat</button>
          <button type="button" className={mode === 'create' ? 'is-active' : ''} onClick={() => setMode('create')}><Plus size={15} /> Create room</button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          {mode === 'join' ? (
            <>
              <label><span>Room address, ID, or directory search</span><input value={address} placeholder="#room:example.com or a public room name" onChange={(event) => { setAddress(event.target.value); setDirectoryResults([]); }} autoFocus /></label>
              {onSearch ? <button className="aqua-button room-directory-search" type="button" disabled={busy || !address.trim()} onClick={() => void searchDirectory()}><Search size={14} /> Search public rooms</button> : null}
              {directoryResults.length ? <div className="room-directory-results">{directoryResults.map((room) => <button type="button" key={room.roomId} onClick={() => setAddress(room.alias || room.roomId)}><span><strong>{room.name}</strong><small>{room.topic || room.alias || room.roomId}</small></span><em><Users size={12} /> {room.memberCount}</em></button>)}</div> : null}
            </>
          ) : mode === 'direct' ? (
            <label><span>Matrix ID</span><input value={address} placeholder="@buddy:example.com" onChange={(event) => setAddress(event.target.value)} autoFocus /></label>
          ) : (
            <>
              <label><span>Room name</span><input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></label>
              <label><span>Topic</span><input value={topic} onChange={(event) => setTopic(event.target.value)} /></label>
              <label className="room-dialog-check"><input type="checkbox" checked={space} onChange={(event) => setSpace(event.target.checked)} /><span>Create a space for organizing rooms</span></label>
              {!space ? <label className="room-dialog-check"><input type="checkbox" checked={encrypted} onChange={(event) => setEncrypted(event.target.checked)} /><span><Lock size={13} /> Encrypt this room</span></label> : null}
              <label className="room-dialog-check"><input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} /><span>List in the public room directory</span></label>
            </>
          )}
          {error ? <p className="settings-error" role="alert">{error}</p> : null}
          <button className="aqua-button aqua-button--primary" disabled={busy || (mode === 'join' || mode === 'direct' ? !address.trim() : !name.trim())}>{busy ? 'Working…' : mode === 'join' ? 'Join room' : mode === 'direct' ? 'Start direct chat' : 'Create room'}</button>
        </form>
      </section>
    </div>
  );
}
