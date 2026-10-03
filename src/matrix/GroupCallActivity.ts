import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixRTCSessionEvent, MatrixRTCSessionManagerEvents, type MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/index.js';
import { discoverGroupCallTransport } from './groupCallTransport';

export class GroupCallActivity {
  private readonly counts = new Map<string, number>();
  private readonly listeners = new Map<string, { session: MatrixRTCSession; changed: () => void }>();
  private stopped = false;
  public available = false;

  public constructor(private readonly client: MatrixClient, private readonly changed: () => void) {}

  public get rooms(): Record<string, number> { return Object.fromEntries(this.counts); }

  private watch(roomId: string, session: MatrixRTCSession): void {
    if (this.listeners.has(roomId)) return;
    const changed = () => {
      if (this.stopped) return;
      if (session.memberships.length) this.counts.set(roomId, session.memberships.length);
      else this.counts.delete(roomId);
      this.changed();
    };
    session.on(MatrixRTCSessionEvent.MembershipsChanged, changed);
    this.listeners.set(roomId, { session, changed });
    changed();
  }

  private readonly onStarted = (roomId: string, session: MatrixRTCSession): void => this.watch(roomId, session);
  private readonly onEnded = (roomId: string): void => {
    const listener = this.listeners.get(roomId);
    if (listener) listener.session.off(MatrixRTCSessionEvent.MembershipsChanged, listener.changed);
    this.listeners.delete(roomId);
    this.counts.delete(roomId);
    this.changed();
  };

  public async start(): Promise<void> {
    this.client.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionStarted, this.onStarted);
    this.client.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionEnded, this.onEnded);
    for (const room of this.client.getRooms()) {
      const active = this.client.matrixRTC.getActiveRoomSession(room);
      if (active?.memberships.length) this.watch(room.roomId, active);
    }
    const available = Boolean(await discoverGroupCallTransport(this.client).catch(() => undefined));
    if (!this.stopped) { this.available = available; this.changed(); }
  }

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.client.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionStarted, this.onStarted);
    this.client.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionEnded, this.onEnded);
    for (const { session, changed } of this.listeners.values()) session.off(MatrixRTCSessionEvent.MembershipsChanged, changed);
    this.listeners.clear();
    this.counts.clear();
    this.available = false;
  }
}
