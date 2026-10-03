import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixRTCSessionEvent, type MatrixRTCSession } from 'matrix-js-sdk/lib/matrixrtc/index.js';
import { BaseKeyProvider, isE2EESupported, Room as LiveKitRoom, RoomEvent, Track, type Participant } from 'livekit-client';
import E2EEWorker from 'livekit-client/e2ee-worker?worker&inline';
import type { GroupCallParticipant, GroupCallSummary } from './viewModels';
import { authorizeGroupCall, discoverGroupCallTransport } from './groupCallTransport';

class MatrixMediaKeys extends BaseKeyProvider {
  public constructor() { super({ ratchetWindowSize: 10, keyringSize: 256 }); }

  public async receive(bytes: Uint8Array<ArrayBuffer>, index: number, identity: string): Promise<void> {
    const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits', 'deriveKey']);
    this.onSetEncryptionKey(material, identity, index);
  }
}

function trackStream(participant: Participant, source: Track.Source): MediaStream | undefined {
  const publication = participant.getTrackPublication(source);
  if (!publication?.track || publication.isMuted || !publication.isEncrypted) return;
  const track = publication.track.mediaStreamTrack;
  let stream = streamByTrack.get(track);
  if (!stream) { stream = new MediaStream([track]); streamByTrack.set(track, stream); }
  return stream;
}

const streamByTrack = new WeakMap<MediaStreamTrack, MediaStream>();

export class GroupCallEngine {
  private readonly abort = new AbortController();
  private room?: LiveKitRoom;
  private rtcSession?: MatrixRTCSession;
  private worker?: Worker;
  private readonly receivedMediaKeys = new Set<string>();
  private readonly missingKeyTimers = new Map<string, number>();
  private keyListener?: (bytes: Uint8Array<ArrayBuffer>, index: number, member: { userId: string; deviceId: string }, backendIdentity: string) => void;
  private state: GroupCallSummary;
  private disposed = false;
  private releasing?: Promise<void>;

  public constructor(
    private readonly client: MatrixClient,
    roomId: string,
    private readonly changed: (summary: GroupCallSummary) => void,
  ) {
    this.state = { roomId, state: 'joining', encrypted: false, microphoneMuted: true, videoMuted: true, screensharing: false, participants: [] };
    this.changed(this.state);
  }

  public get summary(): GroupCallSummary { return this.state; }

  private publish(update: Partial<GroupCallSummary> = {}): void {
    if (this.disposed) return;
    const room = this.room;
    const participants: GroupCallParticipant[] = [];
    if (room) for (const [participant, local] of [[room.localParticipant, true], ...Array.from(room.remoteParticipants.values(), (value) => [value, false] as const)] as Array<readonly [Participant, boolean]>) {
      participants.push({
        id: participant.identity,
        name: participant.name || (local ? 'You' : participant.identity),
        speaking: participant.isSpeaking,
        encrypted: participant.isEncrypted,
        microphoneMuted: !participant.isMicrophoneEnabled,
        videoStream: trackStream(participant, Track.Source.Camera),
        screenStream: trackStream(participant, Track.Source.ScreenShare),
        audioStream: local ? undefined : trackStream(participant, Track.Source.Microphone),
        local,
      });
    }
    this.state = {
      ...this.state,
      ...update,
      participants,
      encrypted: Boolean(room?.isE2EEEnabled) && participants.every((participant) => participant.encrypted),
      microphoneMuted: room ? !room.localParticipant.isMicrophoneEnabled : this.state.microphoneMuted,
      videoMuted: room ? !room.localParticipant.isCameraEnabled : this.state.videoMuted,
      screensharing: Boolean(room?.localParticipant.isScreenShareEnabled),
      audioPlaybackBlocked: Boolean(room && !room.canPlaybackAudio),
    };
    this.changed(this.state);
  }

  private readonly onRoomChange = (): void => this.publish();
  private readonly onReconnecting = (): void => this.publish({ state: 'reconnecting' });
  private readonly onReconnected = (): void => this.publish({ state: 'connected' });
  private readonly onDisconnected = (): void => {
    if (this.disposed || this.abort.signal.aborted) return;
    this.publish({ state: 'error', error: 'The call disconnected. Leave and try joining again.' });
    this.abort.abort();
    void this.release();
  };
  private failEncryption(): void {
    if (this.disposed || this.abort.signal.aborted) return;
    this.publish({ state: 'error', error: 'Call media encryption failed. Leave this call and try again.' });
    this.abort.abort();
    void this.release();
  }
  private readonly onEncryptionError = (error?: Error, participant?: Participant): void => {
    const identity = participant?.identity;
    // LiveKit can receive an encrypted remote frame before the Matrix to-device
    // key arrives. Keep the remote track encrypted while that key is in flight.
    if (error?.message.startsWith('MissingKey:') && identity && identity !== this.room?.localParticipant.identity) {
      if (this.receivedMediaKeys.has(identity) || this.missingKeyTimers.has(identity)) return;
      this.missingKeyTimers.set(identity, window.setTimeout(() => {
        this.missingKeyTimers.delete(identity);
        if (!this.receivedMediaKeys.has(identity)) this.failEncryption();
      }, 15_000));
      return;
    }
    this.failEncryption();
  };
  private readonly onMembershipError = (): void => {
    if (this.disposed || this.abort.signal.aborted) return;
    this.publish({ state: 'error', error: 'The Matrix room could not accept your call membership. Check room permissions and try again.' });
    this.abort.abort();
    void this.release();
  };

  private attachRoom(room: LiveKitRoom): void {
    for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantEncryptionStatusChanged]) {
      room.on(event, this.onRoomChange);
    }
    room.on(RoomEvent.AudioPlaybackStatusChanged, this.onRoomChange);
    room.on(RoomEvent.Reconnecting, this.onReconnecting);
    room.on(RoomEvent.Reconnected, this.onReconnected);
    room.on(RoomEvent.Disconnected, this.onDisconnected);
    room.on(RoomEvent.EncryptionError, this.onEncryptionError);
  }

  public async join(video: boolean, devices: { microphoneId: string; cameraId: string }, microphoneEnabled: boolean): Promise<void> {
    let phase: 'browser' | 'room' | 'transport' | 'authorization' | 'worker' | 'membership' | 'key' | 'connection' | 'encryption' | 'microphone' | 'camera' = 'browser';
    try {
      if (!isE2EESupported()) throw new Error('Encrypted group calling is not supported by this browser.');
      phase = 'room';
      const matrixRoom = this.client.getRoom(this.state.roomId);
      if (!matrixRoom || matrixRoom.getMyMembership() !== 'join') throw new Error('Join this Matrix room before starting a group call.');
      phase = 'transport';
      const session = this.client.matrixRTC.getRoomSession(matrixRoom);
      const transport = await discoverGroupCallTransport(this.client, session);
      if (!transport) throw new Error('This homeserver has no supported MatrixRTC LiveKit service.');
      const userId = this.client.getSafeUserId();
      const deviceId = this.client.getDeviceId();
      if (!deviceId) throw new Error('A Matrix device is required for encrypted group calls.');
      const identity = { userId, deviceId, memberId: `${userId}:${deviceId}` };
      phase = 'authorization';
      const authorization = await authorizeGroupCall(this.client, transport, identity, this.state.roomId, this.abort.signal);
      if (this.abort.signal.aborted) return;

      phase = 'worker';
      const keys = new MatrixMediaKeys();
      this.worker = new E2EEWorker();
      const room = new LiveKitRoom({ encryption: { keyProvider: keys, worker: this.worker } });
      this.room = room;
      this.attachRoom(room);
      this.rtcSession = session;
      let ownKeyReady!: () => void;
      const ownKey = new Promise<void>((resolve) => { ownKeyReady = resolve; });
      const keyChanged = (bytes: Uint8Array<ArrayBuffer>, index: number, member: { userId: string; deviceId: string }, backendIdentity: string): void => {
        void keys.receive(bytes, index, backendIdentity).then(() => {
          this.receivedMediaKeys.add(backendIdentity);
          window.clearTimeout(this.missingKeyTimers.get(backendIdentity));
          this.missingKeyTimers.delete(backendIdentity);
          if (member.userId === userId && member.deviceId === deviceId) ownKeyReady();
        }).catch(() => this.failEncryption());
      };
      this.keyListener = keyChanged;
      session.on(MatrixRTCSessionEvent.EncryptionKeyChanged, keyChanged);
      session.on(MatrixRTCSessionEvent.MembershipManagerError, this.onMembershipError);
      session.reemitEncryptionKeys();
      phase = 'membership';
      session.joinRTCSession(identity, [transport], transport, { manageMediaKeys: true, callIntent: video ? 'video' : 'audio' });
      if (this.abort.signal.aborted) return;
      phase = 'key';
      let keyTimer!: number;
      let keyAbort!: () => void;
      try {
        await Promise.race([ownKey, new Promise<never>((_, reject) => {
          keyTimer = window.setTimeout(() => reject(new Error('The group call media key was not ready.')), 30_000);
          keyAbort = () => reject(new DOMException('The call was cancelled.', 'AbortError'));
          this.abort.signal.addEventListener('abort', keyAbort, { once: true });
          if (this.abort.signal.aborted) keyAbort();
        })]);
      } finally {
        window.clearTimeout(keyTimer);
        this.abort.signal.removeEventListener('abort', keyAbort);
      }
      if (this.abort.signal.aborted) return;
      phase = 'connection';
      await room.connect(authorization.url, authorization.jwt);
      if (this.abort.signal.aborted) { await this.release(); return; }
      phase = 'encryption';
      await room.setE2EEEnabled(true);
      if (this.abort.signal.aborted) { await this.release(); return; }
      // LiveKit acknowledges setE2EEEnabled before its worker reports the local
      // encryption state. Wait for that report before enabling capture.
      if (!room.isE2EEEnabled) await new Promise<void>((resolve, reject) => {
        const finish = (error?: Error): void => {
          window.clearTimeout(timer);
          room.off(RoomEvent.ParticipantEncryptionStatusChanged, changed);
          this.abort.signal.removeEventListener('abort', aborted);
          if (error) reject(error); else resolve();
        };
        const changed = (): void => { if (room.isE2EEEnabled) finish(); };
        const aborted = (): void => finish(new Error('The call was cancelled.'));
        const timer = window.setTimeout(() => finish(new Error('The group call could not enable media encryption.')), 10_000);
        room.on(RoomEvent.ParticipantEncryptionStatusChanged, changed);
        this.abort.signal.addEventListener('abort', aborted, { once: true });
        changed();
      });
      if (this.abort.signal.aborted) { await this.release(); return; }
      phase = 'microphone';
      if (microphoneEnabled) await room.localParticipant.setMicrophoneEnabled(true, devices.microphoneId ? { deviceId: { exact: devices.microphoneId } } : undefined);
      if (this.abort.signal.aborted) { await this.release(); return; }
      phase = 'camera';
      if (video) await room.localParticipant.setCameraEnabled(true, devices.cameraId ? { deviceId: { exact: devices.cameraId } } : undefined);
      if (this.abort.signal.aborted) { await this.release(); return; }
      this.publish({ state: 'connected' });
    } catch (cause) {
      const message = {
        browser: 'This browser does not support encrypted group calls.',
        room: 'Join this Matrix room before starting a group call.',
        transport: 'This homeserver has no compatible group call transport.',
        authorization: 'The group call authorization service could not issue a token.',
        worker: 'The media encryption worker could not start.',
        membership: 'The MatrixRTC membership could not be created.',
        key: 'The group call media key was not ready.',
        connection: 'The group call could not connect to its media server.',
        encryption: 'The group call could not enable media encryption.',
        microphone: 'The selected microphone could not be opened.',
        camera: 'The selected camera could not be opened.',
      }[phase];
      await this.release();
      if (!this.disposed && !this.abort.signal.aborted) this.publish({ state: 'error', error: message });
      throw new Error(this.state.state === 'error' && this.state.error ? this.state.error : message, { cause });
    }
  }

  public async setMicrophoneMuted(muted: boolean, microphoneId = ''): Promise<void> {
    if (this.abort.signal.aborted || !this.room?.isE2EEEnabled) throw new Error('Encrypted group calling is unavailable.');
    await this.room.localParticipant.setMicrophoneEnabled(!muted, !muted && microphoneId ? { deviceId: { exact: microphoneId } } : undefined);
    this.publish();
  }

  public async setVideoMuted(muted: boolean, cameraId = ''): Promise<void> {
    if (this.abort.signal.aborted || !this.room?.isE2EEEnabled) throw new Error('Encrypted group calling is unavailable.');
    await this.room.localParticipant.setCameraEnabled(!muted, !muted && cameraId ? { deviceId: { exact: cameraId } } : undefined);
    this.publish();
  }

  public async setScreensharing(enabled: boolean): Promise<void> {
    if (this.abort.signal.aborted || !this.room?.isE2EEEnabled) throw new Error('Encrypted group calling is unavailable.');
    await this.room.localParticipant.setScreenShareEnabled(enabled);
    this.publish();
  }

  public async setDevices(devices: { microphoneId: string; cameraId: string }): Promise<void> {
    if (!this.room) return;
    if (devices.microphoneId) await this.room.switchActiveDevice('audioinput', devices.microphoneId);
    if (devices.cameraId) await this.room.switchActiveDevice('videoinput', devices.cameraId);
    this.publish();
  }

  public async enableAudio(): Promise<void> {
    await this.room?.startAudio();
    this.publish();
  }

  private release(): Promise<void> { return this.releasing ??= this.releaseOnce(); }

  private async releaseOnce(): Promise<void> {
    for (const timer of this.missingKeyTimers.values()) window.clearTimeout(timer);
    this.missingKeyTimers.clear();
    this.receivedMediaKeys.clear();
    const session = this.rtcSession;
    if (session && this.keyListener) session.off(MatrixRTCSessionEvent.EncryptionKeyChanged, this.keyListener);
    session?.off(MatrixRTCSessionEvent.MembershipManagerError, this.onMembershipError);
    this.keyListener = undefined;
    this.rtcSession = undefined;
    const room = this.room;
    this.room = undefined;
    if (room) await room.disconnect().catch(() => undefined);
    if (session?.isJoined()) await session.leaveRoomSession(5000).catch(() => undefined);
    this.worker?.terminate();
    this.worker = undefined;
  }

  public async leave(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    await this.release();
  }
}
