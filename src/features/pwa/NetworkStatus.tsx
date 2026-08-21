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
      style={{
        position: 'fixed',
        zIndex: 100,
        top: 18,
        right: 18,
        maxWidth: 'min(430px, calc(100vw - 36px))',
        padding: '9px 12px',
        color: 'var(--text)',
        border: '1px solid var(--border-strong)',
        borderRadius: 8,
        background: 'var(--surface-raised)',
        boxShadow: '0 10px 30px rgba(20,35,46,0.3)',
      }}
    >
      <strong>{online ? 'Connection restored' : 'You’re offline'}</strong>
      <small style={{ display: 'block', marginTop: 2, color: 'var(--text-faint)' }}>
        {online ? 'Aimtrix is reconnecting to Matrix.' : 'Aimtrix will reconnect; Matrix history may be unavailable until the connection returns.'}
      </small>
    </aside>
  );
}
