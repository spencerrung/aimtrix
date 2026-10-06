import { afterEach, expect, it, vi } from 'vitest';
import { watchServiceWorker } from './registerServiceWorker';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it('throttles foreground checks and announces waiting workers without activating them', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const postMessage = vi.fn();
  const registration = Object.assign(new EventTarget(), { update: vi.fn().mockResolvedValue(undefined), waiting: { postMessage }, installing: null });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
  const announce = vi.fn();
  window.addEventListener('aimtrix-update-ready', announce);
  const stop = watchServiceWorker(registration as unknown as ServiceWorkerRegistration);
  try {
    expect(announce).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    await Promise.resolve(); await Promise.resolve();
    expect(registration.update).toHaveBeenCalledOnce();
    vi.setSystemTime(60000);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalledTimes(2);
    expect(postMessage).not.toHaveBeenCalled();
    stop();
    vi.setSystemTime(120000);
    window.dispatchEvent(new Event('focus'));
    expect(registration.update).toHaveBeenCalledTimes(2);
  } finally { stop(); window.removeEventListener('aimtrix-update-ready', announce); }
});

it('ignores hidden pages and tolerates offline update errors', async () => {
  const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const registration = Object.assign(new EventTarget(), { update: vi.fn().mockRejectedValue(new Error('offline')), waiting: null, installing: null });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
  const stop = watchServiceWorker(registration as unknown as ServiceWorkerRegistration);
  try {
    window.dispatchEvent(new Event('focus'));
    expect(registration.update).not.toHaveBeenCalled();
    visible.mockReturnValue('visible');
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve(); await Promise.resolve();
    expect(registration.update).toHaveBeenCalledOnce();
  } finally { stop(); }
});

it('observes an installation that began before registration resolved', () => {
  const worker = Object.assign(new EventTarget(), { state: 'installing' });
  const registration = Object.assign(new EventTarget(), { update: vi.fn(), waiting: null as unknown, installing: worker });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
  const announce = vi.fn();
  window.addEventListener('aimtrix-update-ready', announce);
  const stop = watchServiceWorker(registration as unknown as ServiceWorkerRegistration);
  try {
    expect(announce).not.toHaveBeenCalled();
    worker.state = 'installed';
    registration.waiting = worker;
    worker.dispatchEvent(new Event('statechange'));
    expect(announce).toHaveBeenCalledOnce();
    expect(announce.mock.calls[0][0].detail).toBe(worker);
  } finally { stop(); window.removeEventListener('aimtrix-update-ready', announce); }
});
