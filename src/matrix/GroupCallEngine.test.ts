import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixRTCSessionEvent } from 'matrix-js-sdk/lib/matrixrtc/index.js';
import { MembershipManagerEvent } from 'matrix-js-sdk/lib/matrixrtc/IMembershipManager.js';
import { Status } from 'matrix-js-sdk/lib/matrixrtc/types.js';

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  authorize: vi.fn(),
  discover: vi.fn(),
  room: undefined as undefined | EventEmitter,
  connectGate: undefined as undefined | Promise<void>,
  deferE2EE: false,
  completeE2EE: undefined as undefined | (() => void),
  rejectMembership: false,
}));

vi.mock('./groupCallTransport', () => ({ discoverGroupCallTransport: mocks.discover, authorizeGroupCall: mocks.authorize }));
vi.mock('livekit-client/e2ee-worker?worker&inline', () => ({ default: class { terminate() { mocks.events.push('worker-terminate'); } } }));
vi.mock('livekit-client', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeRoom extends EventEmitter {
    localParticipant = {
      identity: '@alice:example.test:DEVICE', name: 'Alice', isSpeaking: false, isEncrypted: true,
      isMicrophoneEnabled: false, isCameraEnabled: false, isScreenShareEnabled: false,
      getTrackPublication: () => undefined,
      setMicrophoneEnabled: vi.fn(async (enabled: boolean) => { mocks.events.push('microphone'); this.localParticipant.isMicrophoneEnabled = enabled; }),
      setCameraEnabled: vi.fn(async (enabled: boolean) => { mocks.events.push('camera'); this.localParticipant.isCameraEnabled = enabled; }),
      setScreenShareEnabled: vi.fn(async () => undefined),
    };
    remoteParticipants = new Map();
    isE2EEEnabled = false;
    canPlaybackAudio = true;
    connect = vi.fn(async () => { mocks.events.push('connect'); await mocks.connectGate; });
    setE2EEEnabled = vi.fn(async (enabled: boolean) => {
      mocks.events.push('e2ee');
      if (mocks.deferE2EE) mocks.completeE2EE = () => { this.isE2EEEnabled = enabled; this.emit('participant-encryption'); };
      else this.isE2EEEnabled = enabled;
    });
    disconnect = vi.fn(async () => { mocks.events.push('disconnect'); });
    constructor() { super(); mocks.room = this; }
  }
  return {
    Room: FakeRoom,
    BaseKeyProvider: class { onSetEncryptionKey() { mocks.events.push('key-import'); } },
    isE2EESupported: () => true,
    RoomEvent: { ParticipantConnected: 'participant-connected', ParticipantDisconnected: 'participant-disconnected', TrackSubscribed: 'track-subscribed', TrackUnsubscribed: 'track-unsubscribed', TrackUnpublished: 'track-unpublished', TrackMuted: 'track-muted', TrackUnmuted: 'track-unmuted', LocalTrackPublished: 'local-track-published', LocalTrackUnpublished: 'local-track-unpublished', ActiveSpeakersChanged: 'speakers', ParticipantEncryptionStatusChanged: 'participant-encryption', AudioPlaybackStatusChanged: 'audio-playback', Reconnecting: 'reconnecting', Reconnected: 'reconnected', Disconnected: 'disconnected', EncryptionError: 'encryption-error' },
    Track: { Source: { Camera: 'camera', ScreenShare: 'screen', Microphone: 'microphone' } },
  };
});

import { GroupCallEngine } from './GroupCallEngine';

function fixture(mode: 'compatibility' | 'matrix_2_0' = 'compatibility') {
  const session = Object.assign(new EventEmitter(), {
    reemitEncryptionKeys: vi.fn(),
    joinRTCSession: vi.fn(() => { queueMicrotask(() => session.emit(mocks.rejectMembership ? MatrixRTCSessionEvent.MembershipManagerError : MatrixRTCSessionEvent.EncryptionKeyChanged, ...(mocks.rejectMembership ? [new Error('private server detail')] : [new Uint8Array(32), 0, { userId: '@alice:example.test', deviceId: 'DEVICE' }, '@alice:example.test:DEVICE']))); }),
    isJoined: () => true,
    membershipStatus: Status.Connected,
    leaveRoomSession: vi.fn<() => Promise<boolean>>(async () => { mocks.events.push('membership-leave'); return true; }),
  });
  const client = {
    getRoom: () => ({ getMyMembership: () => 'join' }),
    matrixRTC: { getRoomSession: () => session },
    getSafeUserId: () => '@alice:example.test',
    getDeviceId: () => 'DEVICE',
    shouldEncryptEventForRoom: vi.fn(async () => true),
  } as unknown as MatrixClient;
  const changed = vi.fn();
  return { engine: new GroupCallEngine(client, '!room:example.test', changed, mode), session, changed, client };
}

afterEach(() => { mocks.events.length = 0; mocks.room = undefined; mocks.connectGate = undefined; mocks.deferE2EE = false; mocks.completeE2EE = undefined; mocks.rejectMembership = false; vi.unstubAllGlobals(); });

describe('group call media lifecycle', () => {
  it('waits for a Matrix key and LiveKit E2EE before publishing local media, then releases both memberships', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: vi.fn(async () => ({})) } });
    mocks.discover.mockResolvedValue({ type: 'livekit', livekit_service_url: 'https://rtc.example.test' });
    mocks.authorize.mockResolvedValue({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' });
    const { engine, session } = fixture();
    await engine.join(true, { microphoneId: '', cameraId: '' }, true);
    expect(mocks.events).toEqual(['key-import', 'connect', 'e2ee', 'microphone', 'camera']);
    expect(engine.summary.state).toBe('connected');
    expect(engine.summary.encrypted).toBe(true);
    await engine.leave();
    expect(mocks.events.slice(-3)).toEqual(['disconnect', 'membership-leave', 'worker-terminate']);
    expect(session.listenerCount(MatrixRTCSessionEvent.EncryptionKeyChanged)).toBe(0);
  });

  it('pairs sticky RTC membership with modern token authorization', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: vi.fn(async () => ({})) } });
    mocks.discover.mockResolvedValue({ type: 'livekit', livekit_service_url: 'https://rtc.example.test' });
    mocks.authorize.mockResolvedValue({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' });
    const { engine, session, client } = fixture('matrix_2_0');
    await engine.join(false, { microphoneId: '', cameraId: '' }, false);
    expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ memberId: '@alice:example.test:DEVICE' }), '!room:example.test', expect.any(AbortSignal), 'matrix_2_0', 'm.call#ROOM');
    expect(session.joinRTCSession).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.objectContaining({ unstableSendStickyEvents: true, manageMediaKeys: true }));
    const policy = client as unknown as { shouldEncryptEventForRoom: (event: { getType(): string; getRoomId(): string }, room: unknown) => Promise<boolean> };
    const event = (type: string, roomId = '!room:example.test') => ({ getType: () => type, getRoomId: () => roomId });
    expect(await policy.shouldEncryptEventForRoom(event('org.matrix.msc4143.rtc.member'), {})).toBe(false);
    expect(await policy.shouldEncryptEventForRoom(event('m.room.message'), {})).toBe(true);
    expect(await policy.shouldEncryptEventForRoom(event('org.matrix.msc4143.rtc.member', '!other:example.test'), {})).toBe(true);
    await engine.leave();
    expect(await policy.shouldEncryptEventForRoom(event('org.matrix.msc4143.rtc.member'), {})).toBe(true);
  });

  it('keeps sticky leave retries clear after a timed-out leave and restores the policy when the scheduler stops', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: vi.fn(async () => ({})) } });
    mocks.discover.mockResolvedValue({ type: 'livekit', livekit_service_url: 'https://rtc.example.test' });
    mocks.authorize.mockResolvedValue({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' });
    const { engine, session, client } = fixture('matrix_2_0');
    session.leaveRoomSession.mockResolvedValue(false);
    await engine.join(false, { microphoneId: '', cameraId: '' }, false);
    const policy = client as unknown as { shouldEncryptEventForRoom: (event: { getType(): string; getRoomId(): string }, room: unknown) => Promise<boolean> };
    const member = { getType: () => 'org.matrix.msc4143.rtc.member', getRoomId: () => '!room:example.test' };
    const message = { getType: () => 'm.room.message', getRoomId: () => '!room:example.test' };
    await engine.leave();
    expect(await policy.shouldEncryptEventForRoom(member, {})).toBe(false);
    expect(await policy.shouldEncryptEventForRoom(message, {})).toBe(true);
    session.membershipStatus = Status.Disconnected;
    session.emit(MembershipManagerEvent.StatusChanged, Status.Disconnecting, Status.Disconnected);
    expect(await policy.shouldEncryptEventForRoom(member, {})).toBe(true);
    expect(session.listenerCount(MembershipManagerEvent.StatusChanged)).toBe(0);
  });

  it('disconnects and stops publication if encryption fails', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: vi.fn(async () => ({})) } });
    mocks.discover.mockResolvedValue({ type: 'livekit', livekit_service_url: 'https://rtc.example.test' });
    mocks.authorize.mockResolvedValue({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' });
    const { engine } = fixture();
    await engine.join(false, { microphoneId: '', cameraId: '' }, false);
    mocks.room?.emit('encryption-error');
    await vi.waitFor(() => expect(mocks.events).toContain('disconnect'));
    expect(engine.summary.state).toBe('error');
    await expect(engine.setMicrophoneMuted(false)).rejects.toThrow('unavailable');
  });

  it('keeps encrypted remote media joined while its Matrix key is in flight', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: vi.fn(async () => ({})) } });
    mocks.discover.mockResolvedValue({ type: 'livekit', livekit_service_url: 'https://rtc.example.test' });
    mocks.authorize.mockResolvedValue({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' });
    const { engine, session } = fixture();
    await engine.join(false, { microphoneId: '', cameraId: '' }, false);
    mocks.room?.emit('encryption-error', new Error('MissingKey: remote key pending'), { identity: '@bob:example.test:DEVICE' });
    expect(engine.summary.state).toBe('connected');
    session.emit(MatrixRTCSessionEvent.EncryptionKeyChanged, new Uint8Array(32), 0, { userId: '@bob:example.test', deviceId: 'DEVICE' }, '@bob:example.test:DEVICE');
    await vi.waitFor(() => expect(mocks.events.filter((event) => event === 'key-import')).toHaveLength(2));
    expect(engine.summary.state).toBe('connected');
    await engine.leave();
  });

  it('waits for the encryption worker acknowledgment before opening the microphone', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: vi.fn(async () => ({})) } });
    mocks.discover.mockResolvedValue({ type: 'livekit', livekit_service_url: 'https://rtc.example.test' });
    mocks.authorize.mockResolvedValue({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' });
    mocks.deferE2EE = true;
    const { engine } = fixture();
    const joining = engine.join(false, { microphoneId: '', cameraId: '' }, true);
    await vi.waitFor(() => expect(mocks.completeE2EE).toBeTypeOf('function'));
    expect(mocks.events).not.toContain('microphone');
    mocks.completeE2EE?.();
    await joining;
    expect(mocks.events).toContain('microphone');
    expect(engine.summary.encrypted).toBe(true);
    await engine.leave();
  });

  it('reports a rejected Matrix membership without exposing the server error or opening capture', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: vi.fn(async () => ({})) } });
    mocks.discover.mockResolvedValue({ type: 'livekit', livekit_service_url: 'https://rtc.example.test' });
    mocks.authorize.mockResolvedValue({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' });
    mocks.rejectMembership = true;
    const { engine, session } = fixture();
    await expect(engine.join(false, { microphoneId: '', cameraId: '' }, true)).rejects.toThrow('room permissions');
    expect(engine.summary.state).toBe('error');
    expect(engine.summary.error).toContain('room permissions');
    expect(engine.summary.error).not.toContain('private server detail');
    expect(mocks.events).not.toContain('microphone');
    expect(session.listenerCount(MatrixRTCSessionEvent.MembershipManagerError)).toBe(0);
  });

  it('leaves Matrix membership after a terminal SFU disconnect', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: vi.fn(async () => ({})) } });
    mocks.discover.mockResolvedValue({ type: 'livekit', livekit_service_url: 'https://rtc.example.test' });
    mocks.authorize.mockResolvedValue({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' });
    const { engine } = fixture();
    await engine.join(false, { microphoneId: '', cameraId: '' }, false);
    mocks.room?.emit('disconnected');
    await vi.waitFor(() => expect(mocks.events).toContain('membership-leave'));
    expect(engine.summary.state).toBe('error');
  });

  it('never publishes media after leaving during SFU connection', async () => {
    vi.stubGlobal('crypto', { subtle: { importKey: vi.fn(async () => ({})) } });
    mocks.discover.mockResolvedValue({ type: 'livekit', livekit_service_url: 'https://rtc.example.test' });
    mocks.authorize.mockResolvedValue({ url: 'wss://sfu.example.test', jwt: 'synthetic.jwt.value' });
    let connected!: () => void;
    mocks.connectGate = new Promise<void>((resolve) => { connected = resolve; });
    const { engine } = fixture();
    const joining = engine.join(true, { microphoneId: '', cameraId: '' }, true);
    await vi.waitFor(() => expect(mocks.events).toContain('connect'));
    await engine.leave();
    connected();
    await joining;
    expect(mocks.events).not.toContain('e2ee');
    expect(mocks.events).not.toContain('microphone');
    expect(mocks.events).not.toContain('camera');
  });
});
