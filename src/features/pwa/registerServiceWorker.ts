const UPDATE_INTERVAL_MS = 60_000;

/** Check returning tabs without activating a waiting worker or discarding drafts. */
export function watchServiceWorker(registration: ServiceWorkerRegistration): () => void {
  let lastCheck = -Infinity;
  let checking = false;
  const announce = () => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      window.dispatchEvent(new CustomEvent('aimtrix-update-ready', { detail: registration.waiting }));
    }
  };
  const update = () => {
    if (document.visibilityState !== 'visible') return;
    announce();
    if (checking || Date.now() - lastCheck < UPDATE_INTERVAL_MS) return;
    checking = true;
    lastCheck = Date.now();
    void registration.update().catch(() => undefined).finally(() => { checking = false; announce(); });
  };
  const onUpdateFound = () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => { if (worker.state === 'installed') announce(); });
  };
  announce();
  registration.addEventListener('updatefound', onUpdateFound);
  onUpdateFound(); // register() can resolve after installation has already begun.
  window.addEventListener('focus', update);
  window.addEventListener('online', update);
  document.addEventListener('visibilitychange', update);
  return () => {
    registration.removeEventListener('updatefound', onUpdateFound);
    window.removeEventListener('focus', update);
    window.removeEventListener('online', update);
    document.removeEventListener('visibilitychange', update);
  };
}
