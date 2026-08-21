import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return (
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) ||
    standaloneNavigator.standalone === true
  );
}

function isIos(): boolean {
  const userAgent = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent>();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const ios = isIos();

  useEffect(() => {
    if (isStandalone()) return;
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  if (dismissed || isStandalone() || (!deferredPrompt && !ios)) return null;

  const install = async () => {
    if (ios) {
      setExpanded((current) => !current);
      return;
    }
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(undefined);
    if (choice.outcome === 'accepted') setDismissed(true);
  };

  return (
    <aside
      className="install-prompt"
      aria-label="Install Aimtrix"
      style={{
        position: 'fixed',
        zIndex: 100,
        right: 18,
        bottom: 'calc(18px + env(safe-area-inset-bottom, 0px) + 74px)',
        display: 'flex',
        width: 'min(540px, calc(100vw - 36px))',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 14,
        padding: '11px 12px',
        color: 'var(--text)',
        border: '1px solid var(--border-strong)',
        borderRadius: 9,
        background: 'var(--surface-raised)',
        boxShadow: '0 14px 40px rgba(20,35,46,0.36)',
      }}
    >
      <div style={{ display: 'grid', minWidth: 0, gap: 2 }}>
        <strong>Install Aimtrix</strong>
        <small>Keep your Matrix workspace one tap away.</small>
        {expanded ? (
          <p>In Safari, tap Share, then Add to Home Screen. Aimtrix will open in its own window.</p>
        ) : null}
      </div>
      <div style={{ display: 'flex', flex: '0 0 auto', alignItems: 'center', gap: 7 }}>
        <button className="text-button" type="button" onClick={() => setDismissed(true)}>Later</button>
        <button className="aqua-button aqua-button--primary" type="button" onClick={() => void install()}>
          {ios ? (expanded ? 'Hide help' : 'How to install') : 'Install'}
        </button>
      </div>
    </aside>
  );
}
