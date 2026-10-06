import { useEffect, useState } from 'react';
import { getAimtrixPlatform } from '../../platform/aimtrixPlatform';

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
  const native = getAimtrixPlatform().capabilities.platform !== 'browser';
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent>();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return Number(localStorage.getItem('aimtrix.install-dismissed-until')) > Date.now(); } catch { return false; }
  });
  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem('aimtrix.install-dismissed-until', String(Date.now() + 7 * 24 * 60 * 60 * 1000)); } catch { /* Storage may be unavailable. */ }
  };
  const ios = isIos();

  useEffect(() => {
    if (native) return;
    if (isStandalone()) return;
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, [native]);

  if (native) return null;
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
      className="install-prompt app-notice"
      aria-label="Install Aimtrix"

    >
      <div className="app-notice-copy">
        <strong>Install Aimtrix</strong>
        <small>Keep your Matrix workspace one tap away.</small>
        {expanded ? (
          <p>In Safari, tap Share, then Add to Home Screen. Aimtrix will open in its own window.</p>
        ) : null}
      </div>
      <div className="app-notice-actions">
        <button className="text-button" type="button" onClick={dismiss}>Later</button>
        <button className="aqua-button aqua-button--primary" type="button" aria-expanded={ios ? expanded : undefined} onClick={() => void install()}>
          {ios ? (expanded ? 'Hide help' : 'How to install') : 'Install'}
        </button>
      </div>
    </aside>
  );
}
