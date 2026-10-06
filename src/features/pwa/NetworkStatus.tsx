import { useEffect, useState } from 'react';

export function NetworkStatus() {
  const [online, setOnline] = useState(() => navigator.onLine);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    let restoreTimer: number | undefined;
    const handleOffline = () => {
      setOnline(false);
      setRestored(false);
    };
    const handleOnline = () => {
      setOnline(true);
      setRestored(true);
      window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => setRestored(false), 2400);
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      window.clearTimeout(restoreTimer);
    };
  }, []);

  if (online && !restored) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      className="app-notice network-notice"
    >
      <div className="app-notice-copy"><strong>{online ? 'Connection restored' : 'You’re offline'}</strong>
      <small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)' }}>
        {online ? 'Aimtrix is reconnecting to Matrix.' : 'Aimtrix will reconnect; Matrix history may be unavailable until the connection returns.'}
      </small></div>
    </aside>
  );
}
