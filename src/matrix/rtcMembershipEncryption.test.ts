import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import type { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession.js';
import { MembershipManagerEvent } from 'matrix-js-sdk/lib/matrixrtc/IMembershipManager.js';
import { Status } from 'matrix-js-sdk/lib/matrixrtc/types.js';
import { allowClearRtcMembership, clearRtcMembershipPolicy } from './rtcMembershipEncryption';

type Policy = (event: { getType(): string; getRoomId(): string }, room: unknown) => Promise<boolean>;
const event = (type: string, roomId = '!room:example.test') => ({ getType: () => type, getRoomId: () => roomId });

function fixture() {
  const original = vi.fn<Policy>(async () => true);
  const policy = { shouldEncryptEventForRoom: original };
  const client = policy as unknown as MatrixClient;
  const session = Object.assign(new EventEmitter(), { membershipStatus: Status.Disconnecting }) as unknown as MatrixRTCSession & EventEmitter;
  return { client, policy, original, session };
}

describe('sticky RTC membership encryption policy', () => {
  it('shares one wrapper across calls and waits for a timed-out leave scheduler to stop', async () => {
    const { client, policy, original, session } = fixture();
    const first = allowClearRtcMembership(client, '!room:example.test');
    const wrapper = policy.shouldEncryptEventForRoom;
    first.retainUntilDisconnected(session);
    const second = allowClearRtcMembership(client, '!room:example.test');
    expect(policy.shouldEncryptEventForRoom).toBe(wrapper);
    second.release();
    expect(await policy.shouldEncryptEventForRoom(event('org.matrix.msc4143.rtc.member'), {})).toBe(false);
    expect(await policy.shouldEncryptEventForRoom(event('m.room.message'), {})).toBe(true);
    expect(await policy.shouldEncryptEventForRoom(event('org.matrix.msc4143.rtc.member', '!other:example.test'), {})).toBe(true);
    expect(session.listenerCount(MembershipManagerEvent.StatusChanged)).toBe(1);
    Object.assign(session, { membershipStatus: Status.Disconnected });
    session.emit(MembershipManagerEvent.StatusChanged, Status.Disconnecting, Status.Disconnected);
    expect(policy.shouldEncryptEventForRoom).toBe(original);
    expect(session.listenerCount(MembershipManagerEvent.StatusChanged)).toBe(0);
    first.release(); // A late duplicate release must not touch a subsequent lease.
    const third = allowClearRtcMembership(client, '!room:example.test');
    expect(await policy.shouldEncryptEventForRoom(event('org.matrix.msc4143.rtc.member'), {})).toBe(false);
    third.release();
    expect(policy.shouldEncryptEventForRoom).toBe(original);
  });

  it('removes pending listeners and restores policy when the client stops', async () => {
    const { client, policy, original, session } = fixture();
    const lease = allowClearRtcMembership(client, '!room:example.test');
    lease.retainUntilDisconnected(session);
    clearRtcMembershipPolicy(client);
    expect(policy.shouldEncryptEventForRoom).toBe(original);
    expect(session.listenerCount(MembershipManagerEvent.StatusChanged)).toBe(0);
    lease.release();
    expect(policy.shouldEncryptEventForRoom).toBe(original);
  });
});
