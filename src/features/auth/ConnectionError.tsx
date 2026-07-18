import { RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { BrandMark } from '../../components/BrandMark';

interface ConnectionErrorProps {
  message: string;
  onRetry: () => void;
  onForget: () => void;
}

export function ConnectionError({ message, onRetry, onForget }: ConnectionErrorProps) {
  return (
    <main className="login-stage">
      <section className="login-window connection-error" aria-labelledby="connection-title">
        <header className="login-window__titlebar">
          <span className="login-window__title">Connection Assistant</span>
        </header>
        <BrandMark compact />
        <WifiOff size={34} aria-hidden="true" />
        <h1 id="connection-title">Couldn’t reach your buddy list</h1>
        <p>{message}</p>
        <div className="connection-error__actions">
          <button className="aqua-button aqua-button--primary" type="button" onClick={onRetry}>
            <RefreshCw size={16} /> Try again
          </button>
          <button className="aqua-button" type="button" onClick={onForget}>
            <Trash2 size={16} /> Use another account
          </button>
        </div>
      </section>
    </main>
  );
}
