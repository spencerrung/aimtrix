import { createRoot } from 'react-dom/client';
import App from './App';
import { watchServiceWorker } from './features/pwa/registerServiceWorker';
import { getAimtrixPlatform } from './platform/aimtrixPlatform';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Aimtrix root element is missing.');

const platform = getAimtrixPlatform();
void platform.deepLinks.prepare().catch(() => undefined).finally(() => createRoot(root).render(<App />));

if (platform.capabilities.serviceWorker && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(watchServiceWorker).catch(() => undefined);
  });
}
