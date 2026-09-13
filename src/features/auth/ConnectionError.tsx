import { RefreshCw, WifiOff } from 'lucide-react';
import { ForgetSessionButton } from './SessionRecovery';
import type { ConnectionIssue } from '../../matrix/MatrixController';
import { BrandMark } from '../../components/BrandMark';

interface ConnectionErrorProps {
  message: string;
  onRetry: () => void;
  onForget: () => Promise<void>;
  issue?: ConnectionIssue;
}

export function ConnectionError({ message, onRetry, onForget, issue }: ConnectionErrorProps) {
  return (
    <main className="login-stage">
      <section className="login-window connection-error" aria-labelledby="connection-title">
        <header className="login-window__titlebar">
          <span className="login-window__title">Connection Assistant</span>
        </header>
        <BrandMark compact />
        <WifiOff size={34} aria-hidden="true" />
        <h1 id="connection-title">{issue === 'storage' ? 'Encrypted storage needs attention' : issue === 'consent' ? 'Your homeserver needs your consent' : 'Couldn’t reach your buddy list'}</h1>
        <p>{message}</p>
        <div className="connection-error__actions">
          <button className="aqua-button aqua-button--primary" type="button" onClick={onRetry}>
            <RefreshCw size={16} /> Try again
          </button>
          <ForgetSessionButton onForget={onForget} />
        </div>
      </section>
    </main>
  );
}
