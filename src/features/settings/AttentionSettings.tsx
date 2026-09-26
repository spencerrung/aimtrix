import { useEffect, useRef, useState } from 'react';
import { useAction } from '../../components/useAction';
import { useDialogBusy } from '../../components/dialogContext';
import type { NotificationRulesSnapshot, RoomNotificationMode } from '../../matrix/notificationRules';
import type { LocalNotificationPolicy } from '../../pwa/notificationPolicy';
import './attentionSettings.css';

export interface AttentionSettingsSnapshot extends NotificationRulesSnapshot {
  localPolicy: LocalNotificationPolicy;
  health: { permission: string; background: string; subscription: string; pusher: string };
}
export interface AttentionSettingsActions {
  load(): Promise<AttentionSettingsSnapshot>;
  setRoom(roomId: string, mode: Exclude<RoomNotificationMode, 'custom'>): Promise<void>;
  setDoNotDisturb(enabled: boolean): Promise<void>;
  addKeyword(pattern: string): Promise<void>;
  removeKeyword(id: string): Promise<void>;
  setLocalPolicy(policy: LocalNotificationPolicy): Promise<void>;
  testNotification(): Promise<void>;
}
const timeValue = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const minuteValue = (value: string) => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };

export function AttentionSettings({ actions }: { actions: AttentionSettingsActions }) {
  const [loaded, setLoaded] = useState<{ owner: AttentionSettingsActions; value: AttentionSettingsSnapshot }>();
  const snapshot = loaded?.owner === actions ? loaded.value : undefined;
  const [policy, setPolicy] = useState<LocalNotificationPolicy>();
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const generation = useRef(0);
  const { busy, run } = useAction();
  useDialogBusy(busy);
  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    void actions.load().then((value) => {
      if (!active || current !== generation.current) return;
      setLoaded({ owner: actions, value }); setPolicy(value.localPolicy); setNow(Date.now()); setLoading(false);
    }, () => {
      if (!active || current !== generation.current) return;
      setError('Notification settings could not be loaded. Refresh to try again.'); setLoading(false);
    });
    return () => { active = false; generation.current = current + 1; };
  }, [actions]);
  const update = (operation?: () => Promise<void>, message = 'Notification settings refreshed.') => run(async () => {
    const current = generation.current;
    setError(''); setNotice('');
    let failed = false;
    try { await operation?.(); }
    catch { failed = true; }
    if (current !== generation.current) return;
    try {
      const value = await actions.load();
      if (current !== generation.current) return;
      setLoaded({ owner: actions, value }); setPolicy(value.localPolicy); setNow(Date.now());
      if (!failed) setNotice(message);
    } catch { failed = true; }
    if (current !== generation.current) return;
    setLoading(false);
    if (failed) setError('Notification settings could not be updated completely. The latest available server state is shown; refresh and retry.');
  });
  return <section className="attention-settings" aria-label="Notification rules and delivery">
    <div className="attention-settings-heading"><h4>Notification rules and delivery</h4><button className="aqua-button" type="button" disabled={busy || loading} onClick={() => void update()}>Refresh notification settings</button></div>
    {loading ? <p role="status">Loading notification rules…</p> : null}
    {busy ? <p role="status">Updating notification settings…</p> : null}
    {error ? <p className="settings-error" role="alert">{error}</p> : null}
    {notice ? <p className="settings-success" role="status">{notice}</p> : null}
    {snapshot && policy ? <fieldset className="interaction-fields" disabled={busy || loading}>
      <label className="settings-toggle-row"><span><strong>Do not disturb across devices</strong><small>Pauses homeserver push notifications for this account until you turn it off. Local pause and sound settings are separate.</small></span><input type="checkbox" checked={snapshot.doNotDisturb} onChange={(event) => void update(() => actions.setDoNotDisturb(event.target.checked), 'Account notification rule saved.')} /></label>
      <h4>Room notifications</h4>
      <p>Mentions and keywords follow higher-priority Matrix rules. Custom rules from other clients are preserved.</p>
      <div className="attention-room-list">{snapshot.rooms.map((room) => <label key={room.id}><span>{room.name}</span><select aria-label={`Notifications for ${room.name}`} value={room.mode} disabled={room.mode === 'custom'} onChange={(event) => void update(() => actions.setRoom(room.id, event.target.value as Exclude<RoomNotificationMode, 'custom'>), 'Room notification rule saved.')}>
        <option value="default">Account default</option><option value="all">All messages</option><option value="mentions">Mentions and keywords</option><option value="nothing">Nothing</option>{room.mode === 'custom' ? <option value="custom">Custom · manage in original client</option> : null}
      </select></label>)}</div>
      {!snapshot.rooms.length ? <p>Join a room to set its notification rules.</p> : null}
      <h4>Keyword patterns</h4>
      <p>Use * for any text and ? for one character. Encrypted message bodies cannot be matched by the homeserver, so keyword alerts while Aimtrix is closed are not guaranteed.</p>
      <div className="attention-keyword-list">{snapshot.keywords.map((rule) => <div key={rule.id}><span>{rule.pattern} {rule.enabled ? '' : '(disabled)'}</span>{rule.editable ? <button className="text-button" type="button" aria-label={`Remove keyword ${rule.pattern}`} onClick={() => void update(() => actions.removeKeyword(rule.id), 'Keyword removed.')}>Remove</button> : <small>Managed in another client</small>}</div>)}</div>
      {!snapshot.keywords.length ? <p>No keyword patterns.</p> : null}
      <div className="attention-inline"><label>New keyword pattern<input value={keyword} maxLength={120} onChange={(event) => setKeyword(event.target.value)} /></label><button className="aqua-button" type="button" disabled={!keyword.trim()} onClick={() => void update(async () => { const current = generation.current; await actions.addKeyword(keyword); if (current === generation.current) setKeyword(''); }, 'Keyword saved.')}>Add keyword</button></div>
      <h4>Quiet time on this installation</h4>
      <p>Saved for this account on this device. Applies to Aimtrix foreground alerts and this browser’s push alerts. Native background alerts use your operating system’s quiet settings.</p>
      <p>{policy.pauseUntil > now ? `Paused until ${new Date(policy.pauseUntil).toLocaleString()}.` : 'Local alerts are not paused.'}</p>
      <div className="attention-inline"><button className="aqua-button" type="button" onClick={() => void update(() => actions.setLocalPolicy({ ...policy, pauseUntil: Date.now() + 60 * 60 * 1000 }), 'Local alerts paused for one hour.')}>Pause for one hour</button><button className="aqua-button" type="button" disabled={!policy.pauseUntil} onClick={() => void update(() => actions.setLocalPolicy({ ...policy, pauseUntil: 0 }), 'Local pause cleared. Quiet hours still apply.')}>Clear local pause</button></div>
      <label className="settings-toggle-row"><span><strong>Daily quiet hours</strong><small>Uses this device’s local time. Equal start and end times leave alerts enabled.</small></span><input type="checkbox" checked={policy.quietHours.enabled} onChange={(event) => setPolicy({ ...policy, quietHours: { ...policy.quietHours, enabled: event.target.checked } })} /></label>
      <div className="attention-inline"><label>Quiet hours start<input type="time" required value={timeValue(policy.quietHours.startMinute)} onChange={(event) => { if (event.target.value) setPolicy({ ...policy, quietHours: { ...policy.quietHours, startMinute: minuteValue(event.target.value) } }); }} /></label><label>Quiet hours end<input type="time" required value={timeValue(policy.quietHours.endMinute)} onChange={(event) => { if (event.target.value) setPolicy({ ...policy, quietHours: { ...policy.quietHours, endMinute: minuteValue(event.target.value) } }); }} /></label><button className="aqua-button" type="button" onClick={() => void update(() => actions.setLocalPolicy(policy), 'Quiet hours saved on this device.')}>Save quiet hours</button></div>
      <h4>Delivery checks</h4>
      <dl className="settings-definition-list"><div><dt>Permission</dt><dd>{snapshot.health.permission}</dd></div><div><dt>Background delivery</dt><dd>{snapshot.health.background}</dd></div><div><dt>Device subscription</dt><dd>{snapshot.health.subscription}</dd></div><div><dt>Homeserver registration</dt><dd>{snapshot.health.pusher}</dd></div></dl>
      <p>A present subscription or registration does not prove delivery. Enable Background notifications above to request permission and register this installation. If alerts still fail, check browser or operating system notification permissions and the configured gateway with your administrator.</p>
      <button className="aqua-button" type="button" disabled={snapshot.health.permission !== 'granted'} onClick={() => void update(() => actions.testNotification(), 'Local test requested. Look for an Aimtrix notification; this does not verify background gateway delivery.')}>Test local notification</button>
      <p>The test contains no room content, account identity, or access token. Resume local alerts and leave quiet hours before testing.</p>
    </fieldset> : null}
  </section>;
}
