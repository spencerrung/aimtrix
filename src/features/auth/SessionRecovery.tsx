import { useEffect, useRef, useState } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { BrandMark } from '../../components/BrandMark';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import type { ConnectionIssue, SessionRecovery as Recovery } from '../../matrix/MatrixController';
import './sessionRecovery.css';

export function ForgetSessionButton({ onForget, disabled = false }: { onForget: () => Promise<void>; disabled?: boolean }) {
  const [confirm, setConfirm] = useState(false);
  return <>
    <button className="aqua-button" type="button" disabled={disabled} onClick={() => setConfirm(true)}>Forget this session</button>
    {confirm ? <ConfirmDialog title="Forget this session and its keys?" description="This removes this session’s encryption keys and unsent drafts from this device. Messages that are not backed up may become unreadable here. Keep your recovery key before continuing. You can then sign in to another account." actionLabel="Forget session and keys" onConfirm={onForget} onClose={() => setConfirm(false)} /> : null}
  </>;
}

export function SessionRecoveryScreen({ recovery, error, onSignIn, onForget }: { recovery: Recovery; error?: string; onSignIn: () => Promise<void>; onForget: () => Promise<void> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(false);
  const signIn = async () => {
    setBusy(true); setActionError(false);
    try { await onSignIn(); } catch { setActionError(true); } finally { setBusy(false); }
  };
  return <main className="login-stage"><section className="login-window connection-error session-recovery" aria-labelledby="session-recovery-title">
    <header className="login-window__titlebar"><span className="login-window__title">Sign On Assistant</span></header>
    <BrandMark compact /><KeyRound size={34} aria-hidden="true" />
    <h1 id="session-recovery-title" tabIndex={-1} ref={heading}>Your Matrix session expired</h1>
    <p>Your session has expired. Conversations are hidden until you sign in again.</p>
    <p>{recovery.softLogout ? 'Your encryption keys are still on this device. Sign in to the same account to reconnect this session.' : 'Your encryption keys are still on this device. Your homeserver may require a new session; you may need your recovery key or another verified device to restore encrypted history.'}</p>
    <p className="session-recovery__note">Drafts saved on this device return when you sign in to the same account. Changes kept only in this tab may be lost on reload or SSO. Files need to be reattached after leaving this page.</p>
    {error || actionError ? <p className="form-error" role="alert">{error || 'Sign in could not be opened. Please try again.'}</p> : null}
    <div className="connection-error__actions"><button className="aqua-button aqua-button--primary" type="button" disabled={busy} onClick={() => void signIn()}>{busy ? 'Opening sign in…' : 'Sign in again'}</button><ForgetSessionButton onForget={onForget} disabled={busy} /></div>
  </section></main>;
}

export function ConnectionBanner({ issue, onRetry }: { issue: ConnectionIssue; onRetry: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const retry = async () => { setBusy(true); setFailed(false); try { await onRetry(); } catch { setFailed(true); } finally { setBusy(false); } };
  return <aside className="session-connection-banner" aria-label="Connection status">
    <p role="status">{issue === 'consent' ? 'Your homeserver needs your consent. Review its terms through your account page, then try again.' : issue === 'storage' ? 'Encrypted storage could not be opened. Check this device’s available storage and browser permissions, then try again.' : 'Connection interrupted. Your conversations and drafts are still here; new messages may be delayed.'}{failed ? ' Reconnection did not finish. Please try again.' : ''}</p>
    <button className="aqua-button" type="button" disabled={busy} onClick={() => void retry()}><RefreshCw size={14} aria-hidden="true" />{busy ? 'Retrying…' : 'Retry connection'}</button>
  </aside>;
}
