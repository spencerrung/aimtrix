// Synthetic settings/controller fixture; the worker and notification API are real.
import { createRoot } from 'react-dom/client';
import { AttentionSettings, type AttentionSettingsActions } from '../../src/features/settings/AttentionSettings';
import { createBrowserPlatform } from '../../src/platform/browserPlatform';
import { MatrixController } from '../../src/matrix/MatrixController';
import { defaultRuntimeConfig } from '../../src/config/runtimeConfig';
import '../../src/styles.css';

declare global { interface Window { localNoticeFixture: { failNext: boolean; constructorCalls: number; presented: number; notifications: () => Promise<Array<{ title: string; data: unknown }>>; close: () => Promise<void> } } }
async function mount() {
  await navigator.serviceWorker.register('/sw.js');
  const registration = await navigator.serviceWorker.ready;
  const NativeNotification = window.Notification;
  const state = window.localNoticeFixture = {
    failNext: true, constructorCalls: 0, presented: 0,
    notifications: async () => (await registration.getNotifications()).map((notice) => ({ title: notice.title, data: notice.data })),
    close: async () => { for (const notice of await registration.getNotifications()) notice.close(); },
  };
  Object.defineProperty(window, 'Notification', { configurable: true, value: class {
    static get permission() { return NativeNotification.permission; }
    static requestPermission() { return NativeNotification.requestPermission(); }
    constructor() { state.constructorCalls++; throw new TypeError('Synthetic Android constructor restriction'); }
  } });
  const getRegistration = navigator.serviceWorker.getRegistration.bind(navigator.serviceWorker);
  navigator.serviceWorker.getRegistration = async (...args) => {
    const current = await getRegistration(...args);
    if (!current) return undefined;
    return new Proxy(current, { get(target, property) {
      if (property === 'showNotification') return async (title: string, options?: NotificationOptions) => {
        if (state.failNext) { state.failNext = false; throw new Error('Synthetic presentation failure'); }
        await target.showNotification(title, options); state.presented++;
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  const platform = createBrowserPlatform();
  const policy = { pauseUntil: 0, quietHours: { enabled: false, startMinute: 1320, endMinute: 480 } };
  await platform.notifications.setContext?.({ owner: 'synthetic-owner-001', policy });
  const controller = new MatrixController(defaultRuntimeConfig, platform);
  (controller as unknown as { client: object }).client = {};
  const actions: AttentionSettingsActions = {
    load: async () => ({ rooms: [], keywords: [], doNotDisturb: false, threadRulesSupported: true, localPolicy: policy,
      health: { permission: platform.notifications.permission, background: 'Not configured for this synthetic test', subscription: 'Absent', pusher: 'Absent' } }),
    setRoom: async () => {}, setDoNotDisturb: async () => {}, addKeyword: async () => {}, removeKeyword: async () => {},
    setLocalPolicy: async () => {}, testNotification: () => controller.testNotification(),
  };
  createRoot(document.getElementById('root')!).render(<main style={{ maxWidth: 760, margin: 'auto', padding: 16 }}><h1>Notification settings</h1><AttentionSettings actions={actions} /></main>);
}
void mount();
