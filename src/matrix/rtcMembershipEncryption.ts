import type { MatrixClient } from 'matrix-js-sdk';
import { EventType } from 'matrix-js-sdk/lib/@types/event.js';
import { MembershipManagerEvent } from 'matrix-js-sdk/lib/matrixrtc/IMembershipManager.js';
import { Status } from 'matrix-js-sdk/lib/matrixrtc/types.js';
import type { MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/MatrixRTCSession.js';

type EncryptionPolicy = (event: { getType(): string; getRoomId(): string }, room: unknown) => Promise<boolean>;
type ClientPolicy = { shouldEncryptEventForRoom: EncryptionPolicy };
type Pending = { session: MatrixRTCSession; listener: (previous: Status, next: Status) => void };
type State = { client: MatrixClient; policy: ClientPolicy; original: EncryptionPolicy; owned: boolean; rooms: Map<string, Set<symbol>>; pending: Map<symbol, Pending> };
const policies = new WeakMap<MatrixClient, State>();

function release(state: State, roomId: string, owner: symbol): void {
  const owners = state.rooms.get(roomId);
  if (!owners?.has(owner)) return;
  const pending = state.pending.get(owner);
  if (pending) pending.session.off(MembershipManagerEvent.StatusChanged, pending.listener);
  state.pending.delete(owner);
  owners.delete(owner);
  if (owners.size === 0) state.rooms.delete(roomId);
  if (state.rooms.size) return;
  if (policies.get(state.client) !== state) return;
  if (state.owned) state.policy.shouldEncryptEventForRoom = state.original;
  else delete (state.policy as { shouldEncryptEventForRoom?: EncryptionPolicy }).shouldEncryptEventForRoom;
  policies.delete(state.client);
}

export function allowClearRtcMembership(client: MatrixClient, roomId: string): { release(): void; retainUntilDisconnected(session: MatrixRTCSession): void } {
  let state = policies.get(client);
  if (!state) {
    const policy = client as unknown as ClientPolicy;
    const original = policy.shouldEncryptEventForRoom;
    if (typeof original !== 'function') throw new Error('The Matrix SDK cannot send clear RTC membership.');
    state = { client, policy, original, owned: Object.prototype.hasOwnProperty.call(policy, 'shouldEncryptEventForRoom'), rooms: new Map(), pending: new Map() };
    const current = state;
    policy.shouldEncryptEventForRoom = (event, room) => event.getType() === EventType.RTCMembership && current.rooms.has(event.getRoomId())
      ? Promise.resolve(false) : original.call(client, event, room);
    policies.set(client, state);
  }
  const current = state;
  const owner = Symbol('rtc-membership');
  const owners = current.rooms.get(roomId) ?? new Set<symbol>();
  owners.add(owner);
  current.rooms.set(roomId, owners);
  const done = (): void => release(current, roomId, owner);
  return {
    release: done,
    retainUntilDisconnected(session) {
      const disconnected = (): boolean => session.membershipStatus === Status.Disconnected;
      if (disconnected()) { done(); return; }
      const listener = (_previous: Status, next: Status): void => { if (next === Status.Disconnected) done(); };
      current.pending.set(owner, { session, listener });
      session.on(MembershipManagerEvent.StatusChanged, listener);
      if (disconnected()) done();
    },
  };
}

export function clearRtcMembershipPolicy(client: MatrixClient): void {
  const state = policies.get(client);
  if (!state) return;
  for (const [owner, pending] of state.pending) {
    pending.session.off(MembershipManagerEvent.StatusChanged, pending.listener);
    state.pending.delete(owner);
  }
  state.rooms.clear();
  if (state.owned) state.policy.shouldEncryptEventForRoom = state.original;
  else delete (state.policy as { shouldEncryptEventForRoom?: EncryptionPolicy }).shouldEncryptEventForRoom;
  policies.delete(client);
}
