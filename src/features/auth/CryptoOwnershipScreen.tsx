import { useEffect, useRef } from 'react';
import { BrandMark } from '../../components/BrandMark';

export function CryptoOwnershipScreen({ unavailable = false, canTakeover = false, error, onRetry, onTakeover }: {
  unavailable?: boolean;
  canTakeover?: boolean;
  error?: string;
  onRetry: () => Promise<void>;
  onTakeover: () => Promise<void>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <main className="login-stage"><section className="login-window connection-error" aria-labelledby="crypto-ownership-title">
    <header className="login-window__titlebar"><span className="login-window__title">Encrypted Storage Assistant</span></header>
    <BrandMark compact />
    <h1 id="crypto-ownership-title" tabIndex={-1} ref={heading}>{unavailable ? 'This browser cannot safely open encrypted storage' : 'This account is open in another window'}</h1>
    <p>{unavailable ? 'Aimtrix needs browser support for exclusive storage access. Use an updated browser with Web Locks support, on HTTPS or localhost.' : 'Only one Aimtrix tab or installed app can use this account’s encryption keys at a time in this browser profile.'}</p>
    {!unavailable ? <p>{canTakeover ? 'Use this window asks the other window to stop safely before opening your account here. If it cannot respond, close it and retry.' : 'Close the other Aimtrix tab or installed app, then retry here.'} Your encryption keys and saved drafts stay on this device.</p> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <div className="connection-error__actions">
      <button className="aqua-button" type="button" onClick={() => void onRetry()}>Retry here</button>
      {!unavailable && canTakeover ? <button className="aqua-button aqua-button--primary" type="button" onClick={() => void onTakeover()}>Use this window</button> : null}
    </div>
  </section></main>;
}
