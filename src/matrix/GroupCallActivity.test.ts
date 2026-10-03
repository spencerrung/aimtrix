import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { MatrixRTCSessionEvent, MatrixRTCSessionManagerEvents } from 'matrix-js-sdk/lib/matrixrtc/index.js';
import type { MatrixClient } from 'matrix-js-sdk';
import { GroupCallActivity } from './GroupCallActivity';

vi.mock('./groupCallTransport', () => ({ discoverGroupCallTransport: vi.fn().mockResolvedValue({ type: 'livekit', livekit_service_url: 'https://rtc.example.test' }) }));

describe('group call activity', () => {
  it('publishes room membership counts and releases every listener on stop', async () => {
    const manager = new EventEmitter();
    const session = Object.assign(new EventEmitter(), { memberships: [{}, {}] });
    const changed = vi.fn();
    const client = {
      matrixRTC: Object.assign(manager, { getActiveRoomSession: () => session }),
      getRooms: () => [{ roomId: '!room:example.test' }],
    } as unknown as MatrixClient;
    const activity = new GroupCallActivity(client, changed);
    await activity.start();
    expect(activity.available).toBe(true);
    expect(activity.rooms).toEqual({ '!room:example.test': 2 });
    session.memberships = [{}];
    session.emit(MatrixRTCSessionEvent.MembershipsChanged);
    expect(activity.rooms).toEqual({ '!room:example.test': 1 });
    manager.emit(MatrixRTCSessionManagerEvents.SessionEnded, '!room:example.test');
    expect(activity.rooms).toEqual({});
    manager.emit(MatrixRTCSessionManagerEvents.SessionStarted, '!second:example.test', session);
    expect(activity.rooms).toEqual({ '!second:example.test': 1 });
    activity.stop();
    const count = changed.mock.calls.length;
    session.emit(MatrixRTCSessionEvent.MembershipsChanged);
    manager.emit(MatrixRTCSessionManagerEvents.SessionStarted, '!third:example.test', session);
    expect(changed).toHaveBeenCalledTimes(count);
    expect(manager.listenerCount(MatrixRTCSessionManagerEvents.SessionStarted)).toBe(0);
    expect(session.listenerCount(MatrixRTCSessionEvent.MembershipsChanged)).toBe(0);
  });
});
