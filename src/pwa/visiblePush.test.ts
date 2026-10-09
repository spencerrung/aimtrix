import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function worker(mode: 'normal' | 'paused' | 'duplicate' | 'signed-out' | 'storage-denied') {
  const listeners = new Map<string, (event: unknown) => void>();
  const notices: Array<{ title: string; options: NotificationOptions }> = [];
  const opened: string[] = [];
  const metadata = mode === 'signed-out' ? {} : { owner: 'synthetic-owner-001', policy: { pauseUntil: mode === 'paused' ? Date.now() + 60_000 : 0 },
    seen: mode === 'duplicate' ? [{ id: 'synthetic-owner-001:$event', at: Date.now() }] : [] };
  let state: unknown = metadata;
  const context = vm.createContext({ URL, Response, encodeURIComponent, Date, console,
    self: { location: { origin: 'https://aimtrix.example.test' }, addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
      registration: { showNotification: async (title: string, options: NotificationOptions) => { notices.push({ title, options }); } },
      clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } } },
    importScripts: () => {
      vm.runInContext(readFileSync('public/notification-policy.js', 'utf8'), context);
      context.aimtrixNotificationPolicy = { ...context.aimtrixNotificationPolicy, transaction: async (change: (value: unknown) => { state: unknown; result: unknown }) => {
        if (mode === 'storage-denied') throw new Error('Synthetic denied metadata');
        const next = change(state); state = next.state; return next.result;
      } };
    },
  });
  vm.runInContext(readFileSync('public/sw.js', 'utf8'), context);
  const emit = async (type: string, event: object) => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ ...event, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
  };
  return { notices, opened, emit };
}

describe('visible Web Push contract', () => {
  it.each(['paused', 'duplicate', 'signed-out', 'storage-denied'] as const)('presents a coalesced private fallback for %s deliveries', async (mode) => {
    const f = worker(mode);
    await f.emit('push', { data: { json: () => ({ room_id: '!room:example.test', event_id: '$event', body: 'Synthetic private body', owner: 'forged-owner' }) } });
    expect(f.notices).toHaveLength(1);
    expect(f.notices[0]).toMatchObject({ title: 'Aimtrix', options: { body: 'Open Aimtrix to check for updates.', tag: 'aimtrix-background-update', silent: true, renotify: false,
      data: { generic: true, url: '/' } } });
    expect(f.notices[0].options.data).not.toHaveProperty('owner');
    expect(JSON.stringify(f.notices)).not.toMatch(/!room|\$event|private body|forged-owner/);
    await f.emit('notificationclick', { notification: { data: f.notices[0].options.data, close: () => {} } });
    expect(f.opened).toEqual(['/']);
  });

  it('still displays each duplicate push while replacing the same generic notification', async () => {
    const f = worker('normal');
    const event = { data: { json: () => ({ room_id: '!room:example.test', event_id: '$event' }) } };
    await f.emit('push', event); await f.emit('push', event);
    expect(f.notices).toHaveLength(2);
    expect(f.notices[0].options.tag).toBe(f.notices[1].options.tag);
    expect(f.notices[0].options.data).toEqual({ owner: 'synthetic-owner-001', url: '/' });
    expect(f.notices[1].options.data).toEqual({ generic: true, url: '/' });
  });
});
