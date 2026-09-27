import { useEffect, useState } from 'react';
import type { MatrixSettingsSnapshot } from '../../matrix/settingsTypes';

interface Props {
  loadHealth?: () => Promise<MatrixSettingsSnapshot>;
  onStartChat: () => void;
  onCreateRoom: () => void;
  onRecovery: () => void;
}

export function FirstUseGuide({ loadHealth, onStartChat, onCreateRoom, onRecovery }: Props) {
  const [health, setHealth] = useState<MatrixSettingsSnapshot>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!loadHealth) return;
    let active = true;
    void loadHealth().then((value) => { if (active) setHealth(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [loadHealth]);
  const recoveryConfigured = health?.security.secretStorageReady && health.security.keyBackupEnabled;
  return <section className="first-use-guide" aria-labelledby="first-use-title">
    <div><span className="eyebrow">Your first conversation</span><h2 id="first-use-title">Your buddy list starts here</h2>
      <p>Start a private chat with someone’s full Matrix ID, or create a room and invite people. Both paths start encrypted.</p></div>
    <div className="first-use-guide__actions">
      <button className="aqua-button aqua-button--primary" type="button" onClick={onStartChat}>Start an encrypted chat</button>
      <button className="aqua-button" type="button" onClick={onCreateRoom}>Create an encrypted room</button>
    </div>
    <div className="first-use-guide__health">
      <strong>Account health</strong>
      {health ? <p>Encryption {health.security.encryptionReady ? 'ready' : 'unavailable'} · Recovery {recoveryConfigured ? 'configured on this account; keep your recovery key safe' : 'needs attention'}</p> : <p role="status">{error ? 'Account health could not be checked. Open Matrix and security settings to retry.' : 'Checking account health…'}</p>}
      {!recoveryConfigured ? <button type="button" onClick={onRecovery}>Set up or restore recovery</button> : null}
    </div>
  </section>;
}
