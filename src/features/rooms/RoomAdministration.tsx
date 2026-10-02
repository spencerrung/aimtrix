import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { RoomSummary } from '../../matrix/viewModels';
import { roomAccessEvents, type RoomAccessSetting, type RoomAdministrationActions, type RoomAdministrationState } from '../../matrix/roomAdministration';

interface Confirmation {
  title: string;
  description: string;
  label: string;
  action: () => Promise<void>;
}

export function RoomAdministration({ room, actions, onOpenReplacement }: {
  room: RoomSummary;
  actions: RoomAdministrationActions;
  onOpenReplacement: (roomId: string) => void;
}) {
  const [details, setDetails] = useState<RoomAdministrationState>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [alias, setAlias] = useState('');
  const [allow, setAllow] = useState('*');
  const [deny, setDeny] = useState('');
  const [allowIpLiterals, setAllowIpLiterals] = useState(true);
  const [replacementId, setReplacementId] = useState('');
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const running = useRef(false);
  const loadRef = useRef(actions.load);
  useEffect(() => { loadRef.current = actions.load; }, [actions.load]);

  useEffect(() => {
    let active = true;
    void loadRef.current(room.id).then((value) => {
      if (!active) return;
      setDetails(value);
      setAllow(value.serverAcl.allow.join('\n'));
      setDeny(value.serverAcl.deny.join('\n'));
      setAllowIpLiterals(value.serverAcl.allowIpLiterals);
      setLoading(false);
    }).catch(() => {
      if (active) { setError('Room administration state could not be loaded. Retry when connected.'); setLoading(false); }
    });
    return () => { active = false; };
  }, [room.id]);

  const refresh = async () => {
    setLoading(true); setError('');
    try {
      const value = await actions.load(room.id);
      setDetails(value);
      setAllow(value.serverAcl.allow.join('\n'));
      setDeny(value.serverAcl.deny.join('\n'));
      setAllowIpLiterals(value.serverAcl.allowIpLiterals);
    } catch {
      setError('Room administration state could not be refreshed. Retry when connected.');
      throw new Error('The change was sent, but the latest room state could not be loaded. Retry loading before making another change.');
    } finally { setLoading(false); }
  };
  const run = async (label: string, action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setStatus(`${label}…`);
    try {
      await action();
      await refresh();
      setStatus(`${label} saved on the homeserver.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} failed. Check your permission and connection.`);
      setStatus('');
      throw cause;
    } finally { running.current = false; setBusy(false); }
  };
  const confirmAccess = (setting: RoomAccessSetting, value: string) => {
    const label = setting === 'joinRule' ? 'Join rule' : setting === 'historyVisibility' ? 'History visibility' : 'Guest access';
    setConfirmation({
      title: `Change ${label.toLowerCase()}?`,
      description: setting === 'historyVisibility' && value === 'world_readable'
        ? 'People outside the room may be able to read its history. Encryption is not removed, but ciphertext and event metadata can become public.'
        : setting === 'joinRule' && value === 'public'
          ? 'Anyone who can find this room may be able to join it. Existing room history rules remain separate.'
          : `This changes the Matrix ${label.toLowerCase()} for everyone in the room.`,
      label: `Save ${label.toLowerCase()}`,
      action: () => run(label, () => actions.setAccess(room.id, setting, value)),
    });
  };
  const access = room.access;
  return <section className="room-administration" aria-label="Advanced room administration">
    <h3>Access and discovery</h3>
    <p className="settings-hint">Room purpose is its Matrix topic. Put a welcome message in the room and pin it so new members can find it in Collections.</p>
    {loading ? <p role="status">Loading room administration…</p> : null}
    {error ? <p className="settings-error" role="alert">{error}</p> : null}
    {!loading && !details ? <button className="aqua-button" type="button" onClick={() => void refresh().catch(() => undefined)}>Retry loading room settings</button> : null}
    {details && access ? <>
      {(['joinRule', 'historyVisibility', 'guestAccess'] as const).map((setting) => {
        const descriptor = roomAccessEvents[setting];
        const current = details.access[setting];
        const canChange = access[setting === 'joinRule' ? 'canChangeJoinRule' : setting === 'historyVisibility' ? 'canChangeHistoryVisibility' : 'canChangeGuestAccess'];
        const labels: Record<string, string> = { invite: 'Invite only', public: 'Public join', knock: 'Request to join (knock)', joined: 'From joining', invited: 'From invitation', shared: 'All current members', world_readable: 'Everyone', forbidden: 'Guests forbidden', can_join: 'Guests may join' };
        return <label key={setting}>{setting === 'joinRule' ? 'Who may join' : setting === 'historyVisibility' ? 'Who may see history' : 'Guest access'}
          <select value={current} disabled={busy || !canChange} onChange={(event) => confirmAccess(setting, event.target.value)}>
            {!descriptor.values.includes(current) ? <option value={current}>Current unsupported value: {current}</option> : null}
            {descriptor.values.filter((value) => setting !== 'joinRule' || value !== 'knock' || Number(details.roomVersion) >= 7).map((value) => <option key={value} value={value}>{labels[value] ?? value}</option>)}
          </select>
        </label>;
      })}
      <label>Public directory
        <select className="room-administration__directory" value={details.directoryVisibility} disabled={busy || !details.directoryAvailable} onChange={(event) => {
          const visibility = event.target.value as 'public' | 'private';
          setConfirmation({ title: 'Change public directory listing?', description: visibility === 'public' ? 'This room will appear in the homeserver’s public directory. Join and history rules are separate.' : 'This room will be removed from the homeserver’s public directory.', label: 'Save directory listing', action: () => run('Directory listing', () => actions.setDirectoryVisibility(room.id, visibility)) });
        }}><option value="private">Not listed</option><option value="public">Listed publicly</option></select>
      </label>
      {!details.directoryAvailable ? <p className="settings-hint">Directory visibility could not be read from the homeserver.</p> : null}
      {!details.directoryAvailable || !details.aliasesAvailable ? <button className="aqua-button" type="button" disabled={busy || loading} onClick={() => void refresh().catch(() => undefined)}>Retry room administration state</button> : null}
      <div className="room-administration__aliases">
        <h4>Room aliases</h4>
        <p className="settings-hint">Local aliases end in :{details.localServerName}. Server policy may restrict who can create or remove them.</p>
        {!details.aliasesAvailable ? <p className="settings-hint">Local aliases could not be read from the homeserver.</p> : null}
        <ul>{details.localAliases.map((item) => <li key={item}><code>{item}</code>
          {access.canChangeCanonicalAlias ? <button type="button" className="aqua-button" disabled={busy || item === details.canonicalAlias} onClick={() => void run('Canonical alias', () => actions.setCanonicalAlias(room.id, item)).catch(() => undefined)}>{item === details.canonicalAlias ? 'Canonical' : 'Make canonical'}</button> : null}
          <button type="button" className="aqua-button" disabled={busy || item === details.canonicalAlias} onClick={() => setConfirmation({ title: `Remove ${item}?`, description: 'Existing links using this alias may stop resolving. Choose another canonical alias first if needed.', label: 'Remove alias', action: () => run('Alias removal', () => actions.deleteAlias(room.id, item)) })}>Remove</button>
        </li>)}</ul>
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); void run('Alias creation', () => actions.createAlias(room.id, alias)).then(() => setAlias('')).catch(() => undefined); }}>
          <label>New local alias<input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder={`#welcome:${details.localServerName}`} /></label>
          <button className="aqua-button" type="submit" disabled={busy || !alias.trim() || !details.localServerName}>Add alias</button>
        </form>
      </div>
      {access.canChangeServerAcl ? <div className="room-administration__acl">
        <h4>Server access list</h4>
        <p className="settings-hint">One server pattern per line. Your own homeserver must stay allowed. This can prevent people from other servers joining.</p>
        <label>Allowed servers<textarea rows={3} value={allow} onChange={(event) => setAllow(event.target.value)} /></label>
        <label>Denied servers<textarea rows={3} value={deny} onChange={(event) => setDeny(event.target.value)} /></label>
        <label className="room-dialog-check"><input type="checkbox" checked={allowIpLiterals} onChange={(event) => setAllowIpLiterals(event.target.checked)} /> Allow IP literal servers</label>
        <button className="aqua-button" type="button" disabled={busy} onClick={() => setConfirmation({ title: 'Change the server access list?', description: 'People on denied servers may lose access. The current homeserver must remain allowed.', label: 'Save server access', action: () => run('Server access list', () => actions.setServerAcl(room.id, allow, deny, allowIpLiterals)) })}>Save server access</button>
      </div> : null}
      {details.upgradeVersion && access.canUpgrade ? <div className="room-administration__upgrade">
        <h4>Room version</h4><p>Current: {details.roomVersion}. Server default: {details.upgradeVersion}.</p>
        <button className="aqua-button" type="button" disabled={busy} onClick={() => setConfirmation({ title: 'Upgrade this room?', description: 'The server creates a replacement room and a tombstone in this room. Some members or integrations may need to rejoin; old links and history remain in the old room.', label: 'Upgrade room', action: async () => { await run('Room upgrade', async () => { const replacement = await actions.upgrade(room.id); setReplacementId(replacement); }); } })}>Upgrade room</button>
      </div> : null}
      {replacementId ? <p role="status">Replacement room: <code>{replacementId}</code> <button className="aqua-button" type="button" onClick={() => onOpenReplacement(replacementId)}>Open replacement room</button></p> : null}
    </> : null}
    {status ? <p role="status">{status}</p> : null}
    {confirmation ? <ConfirmDialog title={confirmation.title} description={confirmation.description} actionLabel={confirmation.label} onConfirm={confirmation.action} onClose={() => setConfirmation(undefined)} /> : null}
  </section>;
}
