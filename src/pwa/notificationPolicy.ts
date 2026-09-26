import '../../public/notification-policy.js';

export interface LocalNotificationPolicy {
  pauseUntil: number;
  quietHours: { enabled: boolean; startMinute: number; endMinute: number };
}
export interface NotificationContext { owner: string; policy: LocalNotificationPolicy }
export interface NotificationMetadata { owner?: string; policy?: LocalNotificationPolicy; seen?: NotificationSeen[] }
export interface NotificationSeen { id: string; at: number }
declare global {
  var aimtrixNotificationPolicy: {
    transaction<T>(change: (state?: NotificationMetadata) => {state: NotificationMetadata; result: T}): Promise<T>;
    normalize(value: unknown): LocalNotificationPolicy;
    paused(policy: unknown, now?: number): boolean;
    claim(seen: NotificationSeen[], id: string | undefined, now?: number): { accepted: boolean; seen: NotificationSeen[] };
  };
}
export const normalizeNotificationPolicy = globalThis.aimtrixNotificationPolicy.normalize;
export const notificationsPaused = globalThis.aimtrixNotificationPolicy.paused;
export const claimNotification = globalThis.aimtrixNotificationPolicy.claim;

/** One platform instance owns the current account generation, never its identity. */
export class NotificationGuard {
  private context?: NotificationContext;
  private seen: NotificationSeen[] = [];
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private persistent = false) {}
  setContext = (context: NotificationContext): Promise<void> => {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(context.owner)) return Promise.resolve();
    if (this.context?.owner !== context.owner) this.seen = [];
    this.context = { owner: context.owner, policy: normalizeNotificationPolicy(context.policy) };
    const next = this.context;
    if (!this.persistent) return Promise.resolve();
    const saved = this.pending.catch(() => undefined).then(() => globalThis.aimtrixNotificationPolicy.transaction((state) => ({
      state: { owner: next.owner, policy: next.policy, seen: state?.owner === next.owner ? state.seen : [] }, result: undefined,
    })));
    // Keep future updates usable after a storage failure, while the caller must
    // receive that failure instead of claiming background quiet hours are saved.
    this.pending = saved.catch(() => undefined);
    return saved.then(() => undefined);
  };
  clearContext = (owner: string): Promise<void> => {
    if (this.context?.owner !== owner) return Promise.resolve();
    this.context = undefined; this.seen = [];
    if (!this.persistent) return Promise.resolve();
    const cleared = this.pending.catch(() => undefined).then(() => globalThis.aimtrixNotificationPolicy.transaction((state) => ({
      state: state?.owner === owner ? {} : state ?? {}, result: undefined,
    })));
    this.pending = cleared.catch(() => undefined);
    return cleared.then(() => undefined);
  };
  isCurrent = async (owner: string): Promise<boolean> => {
    if (this.context?.owner !== owner) return false;
    if (this.persistent) {
      await this.pending;
      try { return await globalThis.aimtrixNotificationPolicy.transaction((state) => ({ state: state ?? {}, result: state?.owner === owner })) && this.context?.owner === owner; }
      catch { /* Foreground context checks still work when optional metadata storage is denied. */ }
    }
    return this.context?.owner === owner;
  };
  canDeliver = async (owner: string): Promise<boolean> =>
    await this.isCurrent(owner) && !notificationsPaused(this.context?.policy);
  accept = async (eventId?: string): Promise<string | undefined> => {
    const context = this.context;
    if (!context || notificationsPaused(context.policy)) return undefined;
    await this.pending;
    if (this.context?.owner !== context.owner || notificationsPaused(this.context.policy)) return undefined;
    const id = eventId ? `${context.owner}:${eventId}` : undefined;
    if (this.persistent) {
      try {
        const accepted = await globalThis.aimtrixNotificationPolicy.transaction((state) => {
          if (state?.owner !== context.owner || notificationsPaused(state.policy)) return { state: state ?? {}, result: false };
          const claimed = claimNotification(state.seen ?? [], id);
          return { state: { ...state, seen: claimed.seen }, result: claimed.accepted };
        });
        return accepted && this.context?.owner === context.owner && !notificationsPaused(this.context.policy) ? context.owner : undefined;
      } catch { /* Bounded in-memory dedup remains available without IndexedDB. */ }
    }
    const claimed = claimNotification(this.seen, id); this.seen = claimed.seen;
    return claimed.accepted && this.context?.owner === context.owner ? context.owner : undefined;
  };
}
