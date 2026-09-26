import { useDialogBusy } from '../../components/dialogContext';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useAction } from '../../components/useAction';
import {
  AlertTriangle,
  Bell,
  Camera,
  Check,
  KeyRound,
  Laptop,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserX,
  Video,
  Volume2,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AttentionSettingsActions } from './AttentionSettings';
const AttentionSettings = lazy(() => import('./AttentionSettings').then((module) => ({ default: module.AttentionSettings })));
import type {
  DeviceRemovalResult,
  DeviceVerificationChallenge,
  MatrixSettingsSnapshot,
} from '../../matrix/settingsTypes';
import type { PushRegistrationResult } from '../../matrix/MatrixController';
import type { UserPreferences } from '../../settings/preferences';

export interface MatrixSettingsActions {
  attention?: AttentionSettingsActions;
  load: () => Promise<MatrixSettingsSnapshot>;
  verifyDevice: (deviceId: string, signal?: AbortSignal) => Promise<DeviceVerificationChallenge>;
  renameDevice: (deviceId: string, displayName: string) => Promise<void>;
  removeDevice: (deviceId: string, password?: string) => Promise<DeviceRemovalResult>;
  setIgnoredUsers: (userIds: string[]) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  setupRecovery: (passphrase: string, accountPassword: string) => Promise<string>;
  restoreRecovery: (recoveryKey: string) => Promise<number>;
  changePassword: (currentPassword: string, newPassword: string, logoutOtherDevices: boolean) => Promise<void>;
  deactivateAccount: (password: string, erase: boolean) => Promise<void>;
  previewMessageSound?: () => void;
  registerPushNotifications?: () => Promise<PushRegistrationResult>;
  unregisterPushNotifications?: () => Promise<void>;
}

interface MatrixSettingsPanelProps {
  preferences: UserPreferences;
  onPreferencesChange: (preferences: UserPreferences) => void;
  actions?: MatrixSettingsActions;
}

function formatLastSeen(timestamp?: number): string {
  if (!timestamp) return 'Last seen time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp);
}

export function MatrixSettingsPanel({
  preferences,
  onPreferencesChange,
  actions,
}: MatrixSettingsPanelProps) {
  const { busy, run } = useAction();
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [verificationWaiting, setVerificationWaiting] = useState(false);
  const verificationAbort = useRef<AbortController | null>(null);
  useDialogBusy(busy && !verificationWaiting);
  useEffect(() => () => verificationAbort.current?.abort(), []);
  const [confirmDeactivation, setConfirmDeactivation] = useState(false);
  const [confirmRemoval, setConfirmRemoval] = useState<string>();
  const [confirmingVerification, setConfirmingVerification] = useState(false);
  const [snapshot, setSnapshot] = useState<MatrixSettingsSnapshot>();
  const [loading, setLoading] = useState(Boolean(actions));
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});
  const [passwordDevice, setPasswordDevice] = useState<string>();
  const [accountPassword, setAccountPassword] = useState('');
  const [ignoredInput, setIgnoredInput] = useState('');
  const [recoveryPassphrase, setRecoveryPassphrase] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState<string>();
  const [existingRecoveryKey, setExistingRecoveryKey] = useState('');
  const [mediaDevices, setMediaDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [logoutOtherDevices, setLogoutOtherDevices] = useState(true);
  const [deactivationPassword, setDeactivationPassword] = useState('');
  const [deactivationConfirmation, setDeactivationConfirmation] = useState('');
  const [eraseAccountData, setEraseAccountData] = useState(false);
  const [verification, setVerification] = useState<{
    deviceId: string;
    challenge: DeviceVerificationChallenge;
  }>();

  const activeVerification = useRef(verification);
  useLayoutEffect(() => { activeVerification.current = verification; }, [verification]);
  useEffect(() => () => { activeVerification.current?.challenge.cancel(); }, []);

  const removalPasswordInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!passwordDevice || confirmRemoval) return;
    const frame = requestAnimationFrame(() => removalPasswordInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [passwordDevice, confirmRemoval]);

  const refresh = async () => {
    if (!actions) return;
    setLoading(true);
    setError(undefined);
    try {
      const loaded = await actions.load();
      setSnapshot(loaded);
      setDeviceNames(Object.fromEntries(loaded.devices.map((device) => [device.id, device.displayName])));
    } catch {
      setError('Aimtrix could not load account settings from the homeserver.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!actions) return;
    let active = true;
    void actions.load().then(
      (loaded) => {
        if (!active) return;
        setSnapshot(loaded);
        setDeviceNames(
          Object.fromEntries(loaded.devices.map((device) => [device.id, device.displayName])),
        );
        setLoading(false);
      },
      () => {
        if (!active) return;
        setError('Aimtrix could not load account settings from the homeserver.');
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [actions]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    void navigator.mediaDevices.enumerateDevices().then(setMediaDevices).catch(() => undefined);
  }, []);

  const deviceGroups = useMemo(
    () => ({
      audioinput: mediaDevices.filter((device) => device.kind === 'audioinput'),
      videoinput: mediaDevices.filter((device) => device.kind === 'videoinput'),
      audiooutput: mediaDevices.filter((device) => device.kind === 'audiooutput'),
    }),
    [mediaDevices],
  );

  const updatePreferences = (update: Partial<UserPreferences>) => {
    onPreferencesChange({ ...preferences, ...update });
  };

  const requestNotifications = (enabled: boolean) => run(async () => {
    if (!enabled) {
      if (actions?.unregisterPushNotifications) {
        try {
          await actions.unregisterPushNotifications();
        } catch {
          setError('The homeserver could not remove background notification delivery.');
          return;
        }
      }
      updatePreferences({ desktopNotifications: false });
      return;
    }
    if (actions?.registerPushNotifications) {
      const result = await actions.registerPushNotifications();
      if (result.status === 'denied' || result.status === 'unavailable' || result.status === 'error') {
        updatePreferences({ desktopNotifications: false });
        setError(result.message);
        return;
      }
      updatePreferences({ desktopNotifications: true });
      setNotice(result.message);
      return;
    }
    if (!('Notification' in window)) {
      setError('This browser does not support desktop notifications.');
      return;
    }
    const permission = await Notification.requestPermission();
    updatePreferences({ desktopNotifications: permission === 'granted' });
    if (permission !== 'granted') setError('Notification permission was not granted.');
  });

  const requestMediaDevices = () => run(async () => {
    setError(undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach((track) => track.stop());
      setMediaDevices(await navigator.mediaDevices.enumerateDevices());
      setNotice('Camera and microphone choices are ready.');
    } catch {
      setError('Camera or microphone permission was not granted.');
    }
  });

  const verifyDevice = (deviceId: string) => run(async () => {
    if (!actions) return;
    setError(undefined);
    const controller = new AbortController();
    verificationAbort.current = controller;
    setVerificationWaiting(true);
    setNotice('Accept verification on the other Matrix session, then compare the emoji.');
    try {
      const challenge = await actions.verifyDevice(deviceId, controller.signal);
      if (controller.signal.aborted) { challenge.cancel(); return; }
      setVerification({ deviceId, challenge });
      setNotice(undefined);
    } catch {
      if (!controller.signal.aborted) setError('Device verification was cancelled, timed out, or unsupported.');
    } finally { setVerificationWaiting(false); }
  });

  const renameDevice = (deviceId: string) => run(async () => {
    if (!actions) return;
    try {
      await actions.renameDevice(deviceId, deviceNames[deviceId] || 'Aimtrix Web');
      setNotice('Session name updated.');
      await refresh();
    } catch {
      setError('The session name could not be updated.');
    }
  });

  const removeDevice = (deviceId: string, password?: string) => run(async () => {
    if (!actions) return;
    setError(undefined);
    try {
      const result = await actions.removeDevice(deviceId, password);
      if (result === 'password-required') {
        setPasswordDevice(deviceId);
        setNotice('Enter your Matrix password to sign out this device.');
        return;
      }
      setPasswordDevice(undefined);
      setAccountPassword('');
      setNotice('The Matrix session was signed out.');
      await refresh();
    } catch {
      throw new Error('The homeserver did not accept that session removal.');
    }
  });

  const addIgnoredUser = () => run(async () => {
    if (!actions || !snapshot || !ignoredInput.trim()) return;
    const userId = ignoredInput.trim();
    if (!/^@[^:]+:.+$/.test(userId)) {
      setError('Enter a full Matrix ID such as @name:example.com.');
      return;
    }
    try {
      await actions.setIgnoredUsers([...snapshot.ignoredUsers, userId]);
      setIgnoredInput('');
      await refresh();
    } catch {
      setError('The ignored-user list could not be updated.');
    }
  });

  const removeIgnoredUser = (userId: string) => run(async () => {
    if (!actions || !snapshot) return;
    try {
      await actions.setIgnoredUsers(snapshot.ignoredUsers.filter((ignored) => ignored !== userId));
      await refresh();
    } catch {
      setError('The ignored-user list could not be updated.');
    }
  });

  const restoreRecovery = () => run(async () => {
    if (!actions || !existingRecoveryKey.trim()) return;
    setError(undefined);
    setNotice('Restoring encrypted room keys…');
    try {
      const imported = await actions.restoreRecovery(existingRecoveryKey);
      setExistingRecoveryKey('');
      setNotice(`Recovery complete. Imported ${imported} room keys.`);
      await refresh();
    } catch {
      setError('That recovery key could not unlock this account’s encrypted backup.');
    }
  });

  const setupRecovery = () => run(async () => {
    if (!actions) return;
    setError(undefined);
    try {
      const key = await actions.setupRecovery(recoveryPassphrase, recoveryPassword);
      setRecoveryKey(key);
      setRecoveryPassword('');
      setNotice('Encryption recovery and key backup are ready. Store this key safely.');
      await refresh();
    } catch {
      setError('Recovery setup failed. Confirm your account password and try again.');
    }
  });

  if (!actions) {
    return <p className="settings-demo-note">Matrix account settings require a real signed-in session.</p>;
  }

  return (
    <div className="matrix-settings-panel">
      <fieldset className="interaction-fields" disabled={busy}>
      <div className="settings-section-heading settings-heading-with-action">
        <div>
          <h2>Matrix and security</h2>
          <p>Account, encryption, sessions, privacy, notifications, and call devices.</p>
        </div>
        <button className="aqua-button" type="button" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      {loading ? <p className="settings-loading" role="status">Loading homeserver settings…</p> : null}
      {error ? <p className="settings-error" role="alert">{error}</p> : null}
      {notice ? <p className="settings-success" role="status"><Check size={14} /> {notice}</p> : null}

      {busy ? <p role="status">Working with your homeserver…</p> : null}
      {snapshot ? (
        <>
          <section className="matrix-settings-group">
            <header><ShieldCheck size={17} /><div><h3>Account and homeserver</h3><p>Your active Matrix identity.</p></div></header>
            <dl className="settings-definition-list">
              <div><dt>Matrix ID</dt><dd>{snapshot.server.userId}</dd></div>
              <div><dt>Server name</dt><dd>{snapshot.server.serverName}</dd></div>
              <div><dt>Homeserver API</dt><dd>{snapshot.server.homeserverUrl}</dd></div>
              <div><dt>Current device</dt><dd>{snapshot.server.deviceId}</dd></div>
              <div><dt>Local storage</dt><dd>History is kept in memory; encryption keys persist in IndexedDB</dd></div>
              <div><dt>Client API</dt><dd>{snapshot.server.versions.at(-1) || 'Unknown'}</dd></div>
              <div><dt>MatrixRTC focus</dt><dd>{snapshot.server.rtcFoci.join(', ') || 'Not advertised; direct calls use Matrix VoIP/TURN'}</dd></div>
            </dl>
            <label className="settings-file-button aqua-button">
              <Camera size={14} /> Change profile picture
              <input
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void run(() => actions.uploadAvatar(file).then(() => {
                    setNotice('Profile picture updated.');
                    void refresh();
                  }).catch(() => setError('Profile picture upload failed.')));
                }}
              />
            </label>
          </section>

          <section className="matrix-settings-group">
            <header><KeyRound size={17} /><div><h3>Encryption recovery</h3><p>Cross-signing, secret storage, and room-key backup.</p></div></header>
            <div className="security-status-grid">
              <span className={snapshot.security.encryptionReady ? 'is-ready' : ''}>E2EE <b>{snapshot.security.encryptionReady ? 'Ready' : 'Unavailable'}</b></span>
              <span className={snapshot.security.crossSigningReady ? 'is-ready' : ''}>Cross-signing <b>{snapshot.security.crossSigningReady ? 'Ready' : 'Needs setup'}</b></span>
              <span className={snapshot.security.secretStorageReady ? 'is-ready' : ''}>Secret storage <b>{snapshot.security.secretStorageReady ? 'Ready' : 'Needs setup'}</b></span>
              <span className={snapshot.security.keyBackupEnabled ? 'is-ready' : ''}>Key backup <b>{snapshot.security.keyBackupEnabled ? `v${snapshot.security.keyBackupVersion}` : 'Needs setup'}</b></span>
            </div>
            <div className="recovery-setup">
              <strong>Restore existing recovery</strong>
              <p>Use the recovery key from an existing verified Matrix client. It is held only in memory for this session.</p>
              <input type="password" value={existingRecoveryKey} placeholder="Recovery key" onChange={(event) => setExistingRecoveryKey(event.target.value)} />
              <button className="aqua-button" type="button" onClick={() => void restoreRecovery()} disabled={!existingRecoveryKey.trim()}>Restore encrypted room keys</button>
            </div>
            {!snapshot.security.secretStorageReady ? (
              <div className="recovery-setup">
                <p>Creating new recovery storage can replace incomplete recovery metadata. Use this only if no other verified client can restore the account.</p>
                <input type="password" value={recoveryPassphrase} placeholder="New recovery passphrase" onChange={(event) => setRecoveryPassphrase(event.target.value)} />
                <input type="password" value={recoveryPassword} aria-label="Current Matrix password" placeholder="Current Matrix password" onChange={(event) => setRecoveryPassword(event.target.value)} />
                <button className="aqua-button" type="button" onClick={() => void setupRecovery()} disabled={!recoveryPassphrase || !recoveryPassword}>Set up recovery</button>
              </div>
            ) : null}
            {recoveryKey ? (
              <div className="recovery-key-output">
                <strong>Save this recovery key now</strong>
                <code>{recoveryKey}</code>
                <button className="aqua-button" type="button" onClick={() => void navigator.clipboard.writeText(recoveryKey)}>Copy recovery key</button>
              </div>
            ) : null}
          </section>

          <section className="matrix-settings-group">
            <header><Laptop size={17} /><div><h3>Sessions and devices</h3><p>Rename this client or sign out sessions you no longer recognize.</p></div></header>
            <div className="device-list">
              {snapshot.devices.map((device) => (
                <div className="device-card" key={device.id}>
                  <div className="device-card__icon"><Laptop size={19} /></div>
                  <div className="device-card__body">
                    <input value={deviceNames[device.id] ?? device.displayName} onChange={(event) => setDeviceNames((current) => ({ ...current, [device.id]: event.target.value }))} aria-label={`Name for ${device.id}`} />
                    <span>{device.current ? 'This device' : formatLastSeen(device.lastSeenAt)} · {device.verified ? 'Verified' : 'Unverified'}</span>
                    <small>{device.userAgent || device.id}</small>
                    {passwordDevice === device.id ? (
                      <div className="device-password-row">
                        <input ref={removalPasswordInput} type="password" value={accountPassword} aria-label="Matrix password" placeholder="Matrix password" onChange={(event) => setAccountPassword(event.target.value)} />
                        <button className="aqua-button" type="button" onClick={() => void removeDevice(device.id, accountPassword).catch(() => setError('The homeserver did not accept that session removal.'))} disabled={!accountPassword}>Confirm sign out</button>
                      </div>
                    ) : null}
                  </div>
                  <div className="device-card__actions">
                    {!device.current && !device.verified ? <button type="button" onClick={() => void verifyDevice(device.id)}><ShieldCheck size={13} /> Verify</button> : null}
                    <button type="button" onClick={() => void renameDevice(device.id)}>Save name</button>
                    {!device.current ? <button className="is-danger" type="button" onClick={() => setConfirmRemoval(device.id)}><Trash2 size={13} /> Sign out</button> : null}
                  </div>
                </div>
              ))}
            </div>

          </section>

          <section className="matrix-settings-group">
            <header><Bell size={17} /><div><h3>Notifications and message privacy</h3><p>Background delivery and local notification behavior for this Aimtrix installation.</p></div></header>
            <label className="settings-toggle-row"><span><strong>Background notifications</strong><small>Use Matrix push rules and privacy-safe event identifiers when a gateway is configured; otherwise this is foreground-only.</small></span><input type="checkbox" checked={preferences.desktopNotifications} onChange={(event) => void requestNotifications(event.target.checked)} /></label>
            <label className="settings-toggle-row"><span><strong>Message sounds</strong><small>Play an original Aimtrix tone for new messages.</small></span><input type="checkbox" checked={preferences.notificationSounds} onChange={(event) => updatePreferences({ notificationSounds: event.target.checked })} /></label>
            <label className="settings-range-row"><Volume2 size={15} /><span>Sound volume</span><input type="range" min="0" max="1" step="0.05" value={preferences.soundVolume} onChange={(event) => updatePreferences({ soundVolume: Number(event.target.value) })} /></label>
            {actions?.previewMessageSound ? (
              <button className="text-button sound-preview-button" type="button" onClick={() => actions.previewMessageSound?.()}><Play size={13} /> Preview message sound</button>
            ) : null}
            {actions.attention ? <><button className="aqua-button" type="button" aria-expanded={attentionOpen} onClick={() => setAttentionOpen((value) => !value)}>Notification rules and delivery</button>{attentionOpen ? <Suspense fallback={<p role="status">Loading notification controls…</p>}><AttentionSettings actions={actions.attention} /></Suspense> : null}</> : null}
            <label className="settings-toggle-row"><span><strong>Send read receipts</strong><small>Let rooms know when you have read messages. When off, read tracking stays private. Older servers can save your conversation position but may not support private thread reads.</small></span><input type="checkbox" checked={preferences.sendReadReceipts} onChange={(event) => updatePreferences({ sendReadReceipts: event.target.checked })} /></label>
            <label className="settings-toggle-row"><span><strong>Send typing notifications</strong><small>Show other people while you are composing.</small></span><input type="checkbox" checked={preferences.sendTypingNotifications} onChange={(event) => updatePreferences({ sendTypingNotifications: event.target.checked })} /></label>
          </section>

          <section className="matrix-settings-group">
            <header><UserX size={17} /><div><h3>Ignored users</h3><p>Messages and invitations from these Matrix IDs are hidden.</p></div></header>
            <div className="ignored-user-list">
              {snapshot.ignoredUsers.map((userId) => <div key={userId}><code>{userId}</code><button type="button" onClick={() => void removeIgnoredUser(userId)}>Unignore</button></div>)}
              {!snapshot.ignoredUsers.length ? <p>No ignored users.</p> : null}
            </div>
            <div className="ignored-user-add"><input value={ignoredInput} placeholder="@name:example.com" onChange={(event) => setIgnoredInput(event.target.value)} /><button className="aqua-button" type="button" onClick={() => void addIgnoredUser()}>Ignore user</button></div>
          </section>

          <section className="matrix-settings-group">
            <header><Video size={17} /><div><h3>Voice, video, and media</h3><p>Devices and bandwidth behavior used by calls and animated content.</p></div></header>
            <button className="aqua-button" type="button" onClick={() => void requestMediaDevices()}><Camera size={14} /> Grant or refresh device access</button>
            <div className="media-device-grid">
              <label>Microphone<select value={preferences.microphoneId} onChange={(event) => updatePreferences({ microphoneId: event.target.value })}><option value="">System default</option>{deviceGroups.audioinput.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
              <label>Camera<select value={preferences.cameraId} onChange={(event) => updatePreferences({ cameraId: event.target.value })}><option value="">System default</option>{deviceGroups.videoinput.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
              <label>Speaker<select value={preferences.speakerId} onChange={(event) => updatePreferences({ speakerId: event.target.value })}><option value="">System default</option>{deviceGroups.audiooutput.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Speaker ${index + 1}`}</option>)}</select></label>
            </div>
            <label className="settings-toggle-row"><span><strong>Autoplay animated media</strong><small>Allow GIFs and animated stickers to play automatically.</small></span><input type="checkbox" checked={preferences.autoplayMedia} onChange={(event) => updatePreferences({ autoplayMedia: event.target.checked })} /></label>
            <label className="settings-toggle-row"><span><strong>Data saver</strong><small>Prefer thumbnails and avoid eager media downloads.</small></span><input type="checkbox" checked={preferences.dataSaver} onChange={(event) => updatePreferences({ dataSaver: event.target.checked })} /></label>
          </section>

          <section className="matrix-settings-group account-danger-zone">
            <header><AlertTriangle size={17} /><div><h3>Password and account</h3><p>Security-sensitive Matrix account actions.</p></div></header>
            <form onSubmit={(event) => {
              event.preventDefault();
              void run(() => actions.changePassword(currentPassword, newPassword, logoutOtherDevices).then(() => {
                setCurrentPassword('');
                setNewPassword('');
                setNotice('Matrix password changed.');
              }).catch(() => setError('The homeserver did not accept the password change.')));
            }}>
              <strong>Change password</strong>
              <input type="password" autoComplete="current-password" value={currentPassword} aria-label="Current Matrix password" placeholder="Current Matrix password" onChange={(event) => setCurrentPassword(event.target.value)} />
              <input type="password" autoComplete="new-password" value={newPassword} aria-label="New Matrix password" placeholder="New Matrix password" onChange={(event) => setNewPassword(event.target.value)} />
              <label className="settings-toggle-row"><span><strong>Sign out other devices</strong><small>Recommended after a compromised password.</small></span><input type="checkbox" checked={logoutOtherDevices} onChange={(event) => setLogoutOtherDevices(event.target.checked)} /></label>
              <button className="aqua-button" type="submit" disabled={!currentPassword || newPassword.length < 8}>Change password</button>
            </form>
            <details>
              <summary>Deactivate Matrix account</summary>
              <div className="deactivation-form">
                <p>This is permanent. Aimtrix cannot reactivate the account or restore erased server data.</p>
                <input type="password" value={deactivationPassword} aria-label="Current Matrix password" placeholder="Current Matrix password" onChange={(event) => setDeactivationPassword(event.target.value)} />
                <input value={deactivationConfirmation} aria-label="Type DEACTIVATE" placeholder="Type DEACTIVATE" onChange={(event) => setDeactivationConfirmation(event.target.value)} />
                <label className="settings-toggle-row"><span><strong>Request erasure</strong><small>Ask the homeserver to erase account data where supported.</small></span><input type="checkbox" checked={eraseAccountData} onChange={(event) => setEraseAccountData(event.target.checked)} /></label>
                <button className="aqua-button is-danger" type="button" disabled={!deactivationPassword || deactivationConfirmation !== 'DEACTIVATE'} onClick={() => {
                  setConfirmDeactivation(true);
                }}>Permanently deactivate account</button>
              </div>
            </details>
          </section>
        </>
      ) : null}
      </fieldset>
      {verificationWaiting ? <button className="aqua-button" onClick={() => { verificationAbort.current?.abort(); setNotice('Verification cancelled.'); }}>Cancel verification</button> : null}
            {verification ? (
              <Dialog className="verification-challenge" aria-label="Compare verification emoji" onClose={() => { verificationAbort.current?.abort(); verification.challenge.cancel(); setConfirmingVerification(false); setVerification(undefined); }}>
                <strong>Do these emoji match on both devices?</strong>
                <p>Only confirm when the same seven emoji appear in the same order.</p>
                <div>{verification.challenge.emoji.map(([symbol, name]) => <span key={`${symbol}-${name}`} title={name}><b>{symbol}</b><small>{name}</small></span>)}</div>
                <footer>
                  <button className="aqua-button" type="button" data-initial-focus onClick={() => { verificationAbort.current?.abort(); verification.challenge.cancel(); setConfirmingVerification(false); setVerification(undefined); }}>They do not match</button>
                  <button className="aqua-button aqua-button--primary" type="button" disabled={confirmingVerification} onClick={() => { if (confirmingVerification) return; const controller = verificationAbort.current; setConfirmingVerification(true); void verification.challenge.confirm().then(() => { if (controller !== verificationAbort.current || controller?.signal.aborted) return; setVerification(undefined); setNotice('Device verified.'); void refresh(); }).catch(() => { if (controller === verificationAbort.current && !controller?.signal.aborted) setError('Verification did not complete.'); }).finally(() => { if (controller === verificationAbort.current) setConfirmingVerification(false); }); }}>They match</button>
                </footer>
                {confirmingVerification ? <p role="status">Confirming verification…</p> : null}
                {error ? <p role="alert">{error}</p> : null}
              </Dialog>
            ) : null}
      {confirmRemoval ? <ConfirmDialog title="Sign out this device?" description="This ends the selected Matrix session. Make sure its encryption keys are backed up before continuing." actionLabel="Sign out device" onClose={() => setConfirmRemoval(undefined)} onConfirm={() => removeDevice(confirmRemoval)} /> : null}
      {confirmDeactivation ? <ConfirmDialog title="Permanently deactivate this account?" description="This cannot be undone. Aimtrix cannot reactivate the account or restore erased server data." actionLabel="Deactivate account" onClose={() => setConfirmDeactivation(false)} onConfirm={() => actions.deactivateAccount(deactivationPassword, eraseAccountData)} /> : null}
    </div>
  );
}
