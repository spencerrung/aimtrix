import { useRef, useState, type FormEvent } from 'react';
import { Dialog, DialogClose } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { SpaceSummary, WorkspaceSnapshot } from '../../matrix/viewModels';

export interface SpaceAdministrationActions {
  addChild: (spaceId: string, childId: string, suggested: boolean) => Promise<void>;
  setSuggested: (spaceId: string, childId: string, suggested: boolean) => Promise<void>;
  removeChild: (spaceId: string, childId: string) => Promise<void>;
  setCanonicalParent: (childSpaceId: string, parentSpaceId: string) => Promise<void>;
}

export function SpaceAdministration({ space, workspace, actions, onClose }: {
  space: SpaceSummary;
  workspace: WorkspaceSnapshot;
  actions: SpaceAdministrationActions;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [childSearch, setChildSearch] = useState('');
  const [selectedChildId, setSelectedChildId] = useState('');
  const [suggested, setSuggested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<{ id: string; name: string }>();
  const running = useRef(false);
  const roomById = new Map(workspace.rooms.map((room) => [room.id, room]));
  const spaceById = new Map(workspace.spaces.map((item) => [item.id, item]));
  const childIds = new Set(space.childIds);
  const labelFor = (id: string) => roomById.get(id)?.name || spaceById.get(id)?.name || workspace.spaceRoomPreviews[id]?.name || id;
  const visibleChildren = space.childIds.filter((id) => `${labelFor(id)} ${id}`.toLowerCase().includes(childSearch.trim().toLowerCase())).slice(0, 100);
  const candidates = [
    ...workspace.rooms.filter((room) => room.membership === 'join' && room.kind !== 'direct'),
    ...workspace.spaces.filter((item) => item.kind === 'matrix' && item.membership === 'join' && item.id !== space.id),
  ].filter((item) => !childIds.has(item.id) && `${item.name} ${item.id}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 20);
  const selectedChild = candidates.find((item) => item.id === selectedChildId) ?? roomById.get(selectedChildId) ?? spaceById.get(selectedChildId);
  const run = async (label: string, action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true); setStatus(`${label}…`); setError('');
    try {
      await action();
      setStatus(`${label} saved on the homeserver. The space map will refresh with sync.`);
    } catch (cause) {
      setStatus('');
      setError(cause instanceof Error ? cause.message : `${label} failed. Check your permission and connection.`);
      throw cause;
    } finally { running.current = false; setBusy(false); }
  };
  return <>
    <Dialog className="room-dialog space-administration" aria-labelledby="space-administration-title" onClose={onClose} busy={busy}>
      <header><strong id="space-administration-title">Manage {space.name}</strong><DialogClose aria-label="Close">Close</DialogClose></header>
      <p className="settings-hint">The space purpose is its Matrix topic. Suggested rooms appear first for new members; changing relationships uses standard Matrix space state.</p>
      {space.canManage ? <>
        <h3>Add a room or subspace</h3>
        <label>Find a joined room or subspace<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedChildId(''); }} placeholder="Search by name or room ID" data-initial-focus /></label>
        <div className="space-administration__choices" role="group" aria-label="Available rooms and subspaces">
          {candidates.map((item) => <button type="button" key={item.id} className="aqua-button" aria-pressed={selectedChildId === item.id} onClick={() => setSelectedChildId(item.id)}>{item.name}</button>)}
          {!candidates.length ? <p>No joined rooms match. Join the room first, then add it here.</p> : null}
        </div>
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); if (selectedChild) void run('Space child', () => actions.addChild(space.id, selectedChild.id, suggested)).then(() => { setSelectedChildId(''); setSearch(''); }).catch(() => undefined); }}>
          <p>{selectedChild ? `Selected: ${selectedChild.name}` : 'Choose a room above.'}</p>
          <label className="room-dialog-check"><input type="checkbox" checked={suggested} onChange={(event) => setSuggested(event.target.checked)} /> Recommend to new members</label>
          <button type="submit" className="aqua-button aqua-button--primary" disabled={busy || !selectedChild}>Add to space</button>
        </form>
        <h3>Children in this space</h3>
        <label>Find a child<input type="search" value={childSearch} onChange={(event) => setChildSearch(event.target.value)} /></label>
        <p className="settings-hint">Showing {visibleChildren.length} of {space.childIds.length} direct children. Search to reach later rooms.</p>
        <ul className="space-administration__children">{visibleChildren.map((id) => <li key={id}><span>{labelFor(id)} {space.suggestedChildIds?.includes(id) ? <small>Recommended</small> : null}</span>
          <button className="aqua-button" type="button" disabled={busy} onClick={() => void run('Recommendation', () => actions.setSuggested(space.id, id, !space.suggestedChildIds?.includes(id))).catch(() => undefined)}>{space.suggestedChildIds?.includes(id) ? 'Unrecommend' : 'Recommend'}</button>
          <button className="aqua-button" type="button" disabled={busy} onClick={() => setRemove({ id, name: labelFor(id) })}>Remove</button>
        </li>)}</ul>
      </> : <p className="settings-hint">Your role cannot edit this space’s children.</p>}
      {space.canManageParents && space.parentSpaceIds.length ? <>
        <h3>Canonical parent</h3>
        <p className="settings-hint">The chosen parent is advertised by this subspace. Removing a parent relationship is a separate action in that parent space.</p>
        {space.parentSpaceIds.map((id) => <button key={id} className="aqua-button" type="button" disabled={busy || space.canonicalParentId === id} onClick={() => void run('Canonical parent', () => actions.setCanonicalParent(space.id, id)).catch(() => undefined)}>{space.canonicalParentId === id ? `${labelFor(id)} (canonical)` : `Make ${labelFor(id)} canonical`}</button>)}
      </> : null}
      {status ? <p role="status">{status}</p> : null}
      {error ? <p className="settings-error" role="alert">{error}</p> : null}
    </Dialog>
    {remove ? <ConfirmDialog title={`Remove ${remove.name} from ${space.name}?`} description="This removes the Matrix space relationship. The room itself and its history remain; a subspace parent link is removed too when you have permission." actionLabel="Remove from space" onClose={() => setRemove(undefined)} onConfirm={() => run('Space removal', () => actions.removeChild(space.id, remove.id))} /> : null}
  </>;
}
