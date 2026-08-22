import { createRoot } from 'react-dom/client';
import App from './App';
import { getAimtrixPlatform } from './platform/aimtrixPlatform';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Aimtrix root element is missing.');

const platform = getAimtrixPlatform();
void platform.deepLinks.prepare().catch(() => undefined).finally(() => createRoot(root).render(<App />));

if (platform.capabilities.serviceWorker && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      const announceWaitingWorker = () => {
        if (registration.waiting && navigator.serviceWorker.controller) {
          window.dispatchEvent(new CustomEvent('aimtrix-update-ready', { detail: registration.waiting }));
        }
      };

      announceWaitingWorker();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            announceWaitingWorker();
          }
        });
      });
    });
  });
}
