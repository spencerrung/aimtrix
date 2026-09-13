import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event.js';
import { EventStatus } from 'matrix-js-sdk/lib/models/event-status.js';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { defaultProfilePersonalization } from '../settings/profilePersonalization';
import { MatrixController } from './MatrixController';
import { MessageSendError } from './messageDelivery';
import type { HistoryView } from './RoomHistory';
import type { AimtrixPlatform } from '../platform/platform';

type ControllerInternals = {
  client?: MatrixClient;
  sdk?: typeof import('matrix-js-sdk');
  snapshotCache: { roomVersions: Map<string, number>; localEvents: Map<string, Map<string, MatrixEvent>>; history: Map<string, HistoryView> };
  connection: 'connecting' | 'online' | 'catching-up' | 'offline';
  attachThreadListeners: (room: unknown) => void;
  notifyForMessage: (event: unknown, room: unknown) => void;
  playMessageTone: () => void;
  handleDecrypted: (event: unknown) => void;
  handleTimeline: (event: MatrixEvent, room: Room, toStart: boolean, removed: boolean) => void;
  migrateLegacyRootSpaceOrder: () => void;
  scheduleWorkspacePublish: () => void;
};

function inject(
  controller: MatrixController,
  client: Partial<MatrixClient>,
  sdk: unknown = {},
) {
  const internals = controller as unknown as ControllerInternals;
  client.makeTxnId ??= () => 'synthetic-transaction';
  client.setRoomReadMarkers ??= vi.fn().mockResolvedValue({});
  internals.client = client as MatrixClient;
  internals.sdk = sdk as typeof import('matrix-js-sdk');
}

function pushPlatform(subscription?: {
  endpoint: string;
  provider?: 'web' | 'native';
  pushKey?: string;
  keys: { auth?: string; p256dh?: string };
}, options: { permission?: NotificationPermission; requestPermission?: NotificationPermission } = {}): AimtrixPlatform {
  return {
    capabilities: { push: true },
    lifecycle: { isHidden: () => true, subscribe: vi.fn().mockReturnValue(() => undefined) },
    deepLinks: {
      prepare: vi.fn().mockResolvedValue(undefined),
      ssoRedirectUrl: vi.fn().mockReturnValue('https://aimtrix.example.test/'),
      currentUrl: vi.fn().mockReturnValue(new URL('https://aimtrix.example.test/')),
      replacePath: vi.fn(),
      openRoute: vi.fn(),
      navigate: vi.fn(),
      focus: vi.fn(),
    },
    notifications: {
      supported: true,
      permission: options.permission ?? 'granted',
      requestPermission: vi.fn().mockResolvedValue(options.requestPermission ?? 'granted'),
      show: vi.fn(),
    },
    push: {
      supported: true,
      provider: subscription?.provider ?? 'web',
      getSubscription: vi.fn().mockResolvedValue(subscription),
      subscribe: vi.fn().mockResolvedValue(subscription ?? {
        endpoint: 'https://push.example.test/subscription',
        keys: { auth: 'auth-key', p256dh: 'p256dh-key' },
      }),
      unsubscribe: vi.fn().mockResolvedValue(true),
    },
  } as unknown as AimtrixPlatform;
}

describe('MatrixController protocol integration', () => {
  const deliverySdk = {
    EventType: { RoomMessage: 'm.room.message' },
    MsgType: { Text: 'm.text' },
    RelationType: { Replace: 'm.replace' },
  };
  function deliveryFixture(encrypted = false) {
    const events = new Map<string, MatrixEvent>();
    const transactions = new Map<string, MatrixEvent>();
    const room = {
      roomId: '!room:test',
      hasEncryptionStateEvent: () => encrypted,
      getEventForTxnId: (txn: string) => transactions.get(txn),
      findEventById: (id: string) => events.get(id),
      getPendingEvents: () => { throw new Error('Chronological rooms do not have a detached pending list.'); },
    } as unknown as Room;
    const client = {
      getRoom: vi.fn().mockReturnValue(room),
      getSafeUserId: () => '@self:test',
      getCrypto: vi.fn().mockReturnValue({}),
      makeTxnId: vi.fn().mockReturnValue('delivery-transaction'),
      sendMessage: vi.fn().mockResolvedValue({ event_id: '$accepted:test' }),
      sendEvent: vi.fn().mockResolvedValue({ event_id: '$accepted:test' }),
      resendEvent: vi.fn().mockResolvedValue({ event_id: '$accepted:test' }),
      cancelPendingEvent: vi.fn(),
      stopClient: vi.fn(),
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>, deliverySdk);
    const publish = vi.spyOn(controller as unknown as ControllerInternals, 'scheduleWorkspacePublish').mockImplementation(() => undefined);
    const add = (status: EventStatus | null = EventStatus.NOT_SENT, sender = '@self:test', txn = 'delivery-transaction') => {
      const event = new MatrixEvent({ event_id: '~local:test', room_id: room.roomId, sender, type: encrypted ? 'm.room.encrypted' : 'm.room.message', content: encrypted
        ? { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'synthetic-ciphertext' }
        : { msgtype: 'm.text', body: 'Synthetic message' } });
      event.setTxnId(txn); event.setStatus(status);
      events.set(event.getId()!, event); transactions.set(txn, event);
      return event;
    };
    return { controller, room, client, events, transactions, add, publish };
  }

  it.each(['message', 'reply', 'edit'] as const)('tracks a retained %s local echo when a non-Matrix error rejects the initial send', async (kind) => {
    const fixture = deliveryFixture();
    const reject = () => { fixture.add(); return Promise.reject(new Error('Synthetic error without an event property')); };
    fixture.client.sendMessage.mockImplementation(reject);
    fixture.client.sendEvent.mockImplementation(reject);
    const pending = kind === 'message' ? fixture.controller.sendMessage('!room:test', 'Synthetic draft')
      : kind === 'reply' ? fixture.controller.sendReply('!room:test', 'Synthetic draft', { id: '$root:test', senderId: '@peer:test', body: 'Synthetic root' })
        : fixture.controller.editMessage('!room:test', '$original:test', 'Synthetic draft');
    await expect(pending).rejects.toMatchObject({ name: 'MessageSendError', localEchoRetained: true });
    expect((kind === 'message' ? fixture.client.sendMessage : fixture.client.sendEvent).mock.calls[0].at(-1)).toBe('delivery-transaction');
  });

  it('preserves the original draft if preparation fails without a local echo', async () => {
    const fixture = deliveryFixture();
    fixture.client.sendMessage.mockRejectedValue(new Error('Synthetic preparation failure'));
    await expect(fixture.controller.sendMessage('!room:test', 'Synthetic draft')).rejects.toEqual(new MessageSendError(false));
  });

  it.each(['message', 'reply', 'edit'] as const)('refuses an encrypted %s without crypto even when no inline emoji is used', async (kind) => {
    const fixture = deliveryFixture(true);
    fixture.client.getCrypto.mockReturnValue(undefined);
    const pending = kind === 'message' ? fixture.controller.sendMessage('!room:test', 'Synthetic draft')
      : kind === 'reply' ? fixture.controller.sendReply('!room:test', 'Synthetic draft', { id: '$root:test', senderId: '@peer:test', body: 'Synthetic root' })
        : fixture.controller.editMessage('!room:test', '$original:test', 'Synthetic draft');
    await expect(pending).rejects.toMatchObject({ localEchoRetained: false });
    expect(fixture.client.sendMessage).not.toHaveBeenCalled(); expect(fixture.client.sendEvent).not.toHaveBeenCalled();
  });

  it('recognizes remote acceptance before an initial request rejection after the transaction index is removed', async () => {
    const fixture = deliveryFixture();
    let reject!: (error: Error) => void;
    fixture.client.sendMessage.mockImplementation(() => { fixture.add(EventStatus.SENDING); return new Promise((_, fail) => { reject = fail; }); });
    const sending = fixture.controller.sendMessage('!room:test', 'Synthetic draft');
    await vi.waitFor(() => expect(fixture.client.sendMessage).toHaveBeenCalled());
    const event = fixture.transactions.get('delivery-transaction')!;
    event.handleRemoteEcho({ ...event.event, event_id: '$accepted:test' });
    fixture.transactions.clear();
    reject(new Error('Synthetic lost response'));
    await expect(sending).resolves.toBeUndefined();
    expect(event.status).toBeNull();
  });

  it('preserves the original thread context of a replacement event', async () => {
    const fixture = deliveryFixture();
    const original = fixture.add(null);
    original.setThreadId('$thread-root:test');
    await fixture.controller.editMessage('!room:test', original.getId()!, 'Synthetic correction');
    expect(fixture.client.sendEvent).toHaveBeenCalledWith('!room:test', '$thread-root:test', 'm.room.message', expect.objectContaining({
      'm.relates_to': { rel_type: 'm.replace', event_id: original.getId() },
    }), 'delivery-transaction');
  });

  it('retries the same encrypted SDK event and transaction while rejecting duplicate retries', async () => {
    const fixture = deliveryFixture(true);
    const event = fixture.add();
    const content = event.getWireContent();
    let finish!: () => void;
    fixture.client.resendEvent.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ event_id: '$accepted:test' }); }));
    const pending = fixture.controller.retryMessage('!room:test', event.getId()!);
    await expect(fixture.controller.retryMessage('!room:test', event.getId()!)).rejects.toThrow('already being retried');
    await expect(fixture.controller.cancelMessage('!room:test', event.getId()!)).rejects.toThrow('being retried');
    expect(fixture.client.resendEvent).toHaveBeenCalledExactlyOnceWith(event, fixture.room);
    finish(); await pending;
    expect(event.getTxnId()).toBe('delivery-transaction'); expect(event.getWireContent()).toBe(content);
    expect(fixture.client.sendEvent).not.toHaveBeenCalled(); expect(fixture.client.sendMessage).not.toHaveBeenCalled();
  });

  it('does not report a failed retry when the remote echo arrived before a lost response', async () => {
    const fixture = deliveryFixture(true); const event = fixture.add();
    fixture.client.resendEvent.mockImplementation(async () => { event.handleRemoteEcho({ ...event.event, event_id: '$accepted:test' }); throw new Error('Synthetic lost response'); });
    await expect(fixture.controller.retryMessage('!room:test', event.getId()!)).resolves.toBeUndefined();
  });

  it('keeps a thread local echo recoverable when the SDK omits it from every timeline', async () => {
    const fixture = deliveryFixture();
    let event!: MatrixEvent;
    fixture.client.sendEvent.mockImplementation(() => {
      event = fixture.add();
      event.setThreadId('$thread-root:test');
      fixture.events.clear();
      return Promise.reject(new Error('Synthetic thread rejection'));
    });
    await expect(fixture.controller.sendReply('!room:test', 'Synthetic reply', {
      id: '$thread-root:test', threadRootId: '$thread-root:test', senderId: '@peer:test', body: 'Synthetic root',
    })).rejects.toMatchObject({ localEchoRetained: true });
    const cache = (fixture.controller as unknown as ControllerInternals).snapshotCache.localEvents;
    expect(cache.get('!room:test')?.get('delivery-transaction')).toBe(event);
    expect(fixture.room.findEventById(event.getId()!)).toBeUndefined();
    fixture.client.resendEvent.mockRejectedValue(new Error('Synthetic retry rejection'));
    await expect(fixture.controller.retryMessage('!room:test', event.getId()!)).rejects.toThrow('Retry could not be confirmed');
    expect(fixture.client.resendEvent).toHaveBeenCalledExactlyOnceWith(event, fixture.room);
    fixture.client.cancelPendingEvent.mockImplementation(() => { event.setStatus(EventStatus.CANCELLED); });
    await fixture.controller.cancelMessage('!room:test', event.getId()!);
    expect(cache.size).toBe(0);
    expect(event.status).toBe(EventStatus.CANCELLED);
  });

  it('removes supplemental echoes on remote acceptance and clears them on shutdown', async () => {
    const fixture = deliveryFixture();
    let event!: MatrixEvent;
    fixture.client.sendMessage.mockImplementation(() => {
      event = fixture.add();
      fixture.events.clear();
      return Promise.reject(new Error('Synthetic rejection'));
    });
    await expect(fixture.controller.sendMessage('!room:test', 'Synthetic draft')).rejects.toMatchObject({ localEchoRetained: true });
    const cache = (fixture.controller as unknown as ControllerInternals).snapshotCache.localEvents;
    fixture.client.resendEvent.mockImplementation(async () => {
      event.handleRemoteEcho({ ...event.event, event_id: '$accepted:test' });
      fixture.events.set(event.getId()!, event);
      return { event_id: '$accepted:test' };
    });
    await fixture.controller.retryMessage('!room:test', event.getId()!);
    expect(cache.size).toBe(0);
    await expect(fixture.controller.sendMessage('!room:test', 'Another synthetic draft')).rejects.toMatchObject({ localEchoRetained: true });
    expect(cache.size).toBe(1);
    (fixture.controller as unknown as ControllerInternals).sdk = undefined;
    fixture.controller.shutdown();
    expect(cache.size).toBe(0);
  });

  it('keeps an accepted first thread reply until an SDK timeline takes ownership', async () => {
    const fixture = deliveryFixture();
    let event!: MatrixEvent;
    fixture.client.sendEvent.mockImplementation(() => {
      event = fixture.add();
      event.setThreadId('$thread-root:test');
      fixture.events.clear();
      return Promise.reject(new Error('Synthetic first thread rejection'));
    });
    await expect(fixture.controller.sendReply('!room:test', 'Synthetic first reply', {
      id: '$thread-root:test', threadRootId: '$thread-root:test', senderId: '@peer:test', body: 'Synthetic root',
    })).rejects.toMatchObject({ localEchoRetained: true });
    fixture.client.resendEvent.mockImplementation(async () => {
      event.handleRemoteEcho({ ...event.event, event_id: '$accepted-thread:test' });
      fixture.transactions.clear();
      return { event_id: '$accepted-thread:test' };
    });
    await fixture.controller.retryMessage('!room:test', event.getId()!);
    const internals = fixture.controller as unknown as ControllerInternals;
    const cache = internals.snapshotCache.localEvents;
    expect(event.status).toBeNull();
    expect(fixture.room.findEventById(event.getId()!)).toBeUndefined();
    expect(cache.get('!room:test')?.get('delivery-transaction')).toBe(event);
    fixture.events.set(event.getId()!, event);
    internals.handleTimeline(event, fixture.room, false, false);
    expect(cache.size).toBe(0);
  });

  it.each([EventStatus.QUEUED, EventStatus.ENCRYPTING, EventStatus.SENDING, EventStatus.SENT, EventStatus.CANCELLED, null])('does not retry or cancel event status %s', async (status) => {
    const fixture = deliveryFixture(); const event = fixture.add(status);
    await expect(fixture.controller.retryMessage('!room:test', event.getId()!)).rejects.toThrow('no longer available');
    await expect(fixture.controller.cancelMessage('!room:test', event.getId()!)).rejects.toThrow('no longer available');
    expect(fixture.client.resendEvent).not.toHaveBeenCalled(); expect(fixture.client.cancelPendingEvent).not.toHaveBeenCalled();
  });

  it('rejects another sender or a missing transaction, and cancels only the original failed SDK event', async () => {
    const fixture = deliveryFixture(true); const peerEvent = fixture.add(EventStatus.NOT_SENT, '@peer:test');
    await expect(fixture.controller.retryMessage('!room:test', peerEvent.getId()!)).rejects.toThrow('no longer available');
    const noTransaction = fixture.add(EventStatus.NOT_SENT, '@self:test', '');
    await expect(fixture.controller.cancelMessage('!room:test', noTransaction.getId()!)).rejects.toThrow('no longer available');
    const own = fixture.add(); fixture.client.getCrypto.mockReturnValue(undefined);
    await expect(fixture.controller.retryMessage('!room:test', own.getId()!)).rejects.toMatchObject({ localEchoRetained: false });
    await fixture.controller.cancelMessage('!room:test', own.getId()!);
    expect(fixture.client.cancelPendingEvent).toHaveBeenCalledExactlyOnceWith(own);
  });

  it('does not publish an old retry completion into a replacement session', async () => {
    const fixture = deliveryFixture(); const event = fixture.add();
    let finish!: () => void;
    fixture.client.resendEvent.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ event_id: '$accepted:test' }); }));
    const pending = fixture.controller.retryMessage('!room:test', event.getId()!);
    (fixture.controller as unknown as ControllerInternals).sdk = undefined;
    fixture.controller.shutdown();
    inject(fixture.controller, { getRoom: vi.fn().mockReturnValue(fixture.room) }, deliverySdk);
    finish(); await expect(pending).rejects.toThrow('Retry could not be confirmed');
    expect(fixture.publish).not.toHaveBeenCalled();
  });

  it('exposes bounded directional history actions and clears their selections on shutdown', async () => {
    const fixture = deliveryFixture();
    const events = Array.from({ length: 300 }, (_, index) => new MatrixEvent({
      event_id: `$history-${index}`, room_id: fixture.room.roomId, sender: '@self:test', type: 'm.room.message',
      content: { msgtype: 'm.text', body: `Synthetic history ${index}` },
    }));
    const timeline = { getEvents: () => events, getBaseIndex: () => 0, getNeighbouringTimeline: () => null, getPaginationToken: () => null };
    Object.assign(fixture.room, {
      getMyMembership: () => 'join', getLiveTimeline: () => timeline,
      getUnfilteredTimelineSet: () => ({ getTimelineForEvent: () => timeline }),
    });
    Object.assign(fixture.client, { decryptEventIfNeeded: vi.fn().mockResolvedValue(undefined), isInitialSyncComplete: () => true });
    const history = (fixture.controller as unknown as ControllerInternals).snapshotCache.history;
    await fixture.controller.openRoomHistory(fixture.room.roomId);
    expect(history.get(fixture.room.roomId)?.events[0].getId()).toBe('$history-50');
    fixture.controller.setHistoryDetached(fixture.room.roomId, true);
    await fixture.controller.loadRoomHistory(fixture.room.roomId);
    expect(history.get(fixture.room.roomId)?.events[0].getId()).toBe('$history-0');
    await fixture.controller.loadRoomHistory(fixture.room.roomId, 'forward');
    expect(history.get(fixture.room.roomId)?.events[0].getId()).toBe('$history-50');
    await fixture.controller.returnToLive(fixture.room.roomId);
    expect(history.get(fixture.room.roomId)?.state.mode).toBe('live');
    (fixture.controller as unknown as ControllerInternals).sdk = undefined;
    fixture.controller.shutdown();
    expect(history.size).toBe(0);
  });

  it('sends intentional mentions with portable Matrix HTML and Unicode emoji', async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, {
      getRoom: () => ({ roomId: '!room:test', hasEncryptionStateEvent: () => false, getEventForTxnId: () => undefined }),
      sendMessage,
    } as unknown as Partial<MatrixClient>, {
      MsgType: { Text: 'm.text' },
    });

    await controller.sendMessage('!room:test', '@Mara 👩🏽‍💻 ship it', [{
      userId: '@mara:test',
      label: 'Mara',
    }]);

    expect(sendMessage).toHaveBeenCalledWith('!room:test', {
      msgtype: 'm.text',
      body: '@Mara 👩🏽‍💻 ship it',
      format: 'org.matrix.custom.html',
      formatted_body: '<p><a href="https://matrix.to/#/%40mara%3Atest">@Mara</a> 👩🏽‍💻 ship it</p>',
      'm.mentions': { user_ids: ['@mara:test'] },
    }, 'synthetic-transaction');
  });

  it('uploads selected custom emoji and sends one rich text event', async () => {
    const uploadContent = vi.fn().mockResolvedValue({ content_uri: 'mxc://test/bufo' });
    const sendMessage = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
      blob: () => Promise.resolve(new Blob(['png'], { type: 'image/png' })),
    }));
    try {
      const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
      inject(controller, {
        getRoom: () => ({ roomId: '!room:test', hasEncryptionStateEvent: () => false, getEventForTxnId: () => undefined }),
        uploadContent,
        sendMessage,
      } as unknown as Partial<MatrixClient>, {
        MsgType: { Text: 'm.text' },
      });

      await controller.sendMessage('!room:test', 'ugh :bufo-wave:', [], [{
        shortcode: ':bufo-wave:',
        id: 'bufo-wave',
        name: 'Bufo wave',
        src: '/emoji/bufo-wave.png',
      }]);

      expect(uploadContent).toHaveBeenCalledWith(expect.any(Blob), {
        name: 'bufo-wave.png',
        type: 'image/png',
        includeFilename: false,
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith('!room:test', {
        msgtype: 'm.text',
        body: 'ugh :bufo-wave:',
        format: 'org.matrix.custom.html',
        formatted_body: '<p>ugh <img data-mx-emoticon src="mxc://test/bufo" alt=":bufo-wave:" title=":bufo-wave:" height="32"></p>',
      }, 'synthetic-transaction');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps mention metadata inside standard Matrix replacement content', async () => {
    const sendEvent = vi.fn().mockResolvedValue({});
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, { sendEvent, getRoom: () => ({ roomId: '!room:test', hasEncryptionStateEvent: () => false, getEventForTxnId: () => undefined, findEventById: () => undefined }) } as unknown as Partial<MatrixClient>, {
      EventType: { RoomMessage: 'm.room.message' },
      MsgType: { Text: 'm.text' },
      RelationType: { Replace: 'm.replace' },
    });

    await controller.editMessage('!room:test', '$original:test', '@Mara corrected', [{
      userId: '@mara:test',
      label: 'Mara',
    }]);

    expect(sendEvent).toHaveBeenCalledWith('!room:test', 'm.room.message', expect.objectContaining({
      body: '* @Mara corrected',
      'm.mentions': { user_ids: ['@mara:test'] },
      'm.relates_to': { rel_type: 'm.replace', event_id: '$original:test' },
      'm.new_content': expect.objectContaining({
        body: '@Mara corrected',
        'm.mentions': { user_ids: ['@mara:test'] },
        formatted_body: expect.stringContaining('https://matrix.to/#/%40mara%3Atest'),
      }),
    }), 'synthetic-transaction');
  });
  it('ignores crypto-store decryptions that are not in a loaded room timeline', () => {
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    const internals = controller as unknown as ControllerInternals;
    const scheduleWorkspacePublish = vi.fn();
    internals.scheduleWorkspacePublish = scheduleWorkspacePublish;
    inject(controller, { getRoom: vi.fn().mockReturnValue(undefined) });

    internals.handleDecrypted({
      getId: () => '$stored:test',
      getRoomId: () => '!old:test',
    });

    expect(scheduleWorkspacePublish).not.toHaveBeenCalled();
    expect(internals.snapshotCache.roomVersions.has('!old:test')).toBe(false);
  });

  it('publishes a decrypted event that belongs to a loaded room timeline', () => {
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    const internals = controller as unknown as ControllerInternals;
    const scheduleWorkspacePublish = vi.fn();
    internals.scheduleWorkspacePublish = scheduleWorkspacePublish;
    const event = {
      getId: () => '$visible:test',
      getRoomId: () => '!room:test',
    };
    inject(controller, {
      getRoom: vi.fn().mockReturnValue({ findEventById: vi.fn().mockReturnValue(event) }),
    });

    internals.handleDecrypted(event);

    expect(scheduleWorkspacePublish).toHaveBeenCalledOnce();
    expect(internals.snapshotCache.roomVersions.get('!room:test')).toBe(1);
  });

  it('registers an event-id-only web pusher without forwarding message content', async () => {
    const config = structuredClone(defaultRuntimeConfig);
    config.push = {
      gatewayUrl: 'https://push.example.test/_matrix/push/v1/notify',
      appId: 'dev.example.aimtrix',
      webPush: { applicationServerKey: 'public-vapid-key' },
    };
    const setPusher = vi.fn().mockResolvedValue({});
    const controller = new MatrixController(config, pushPlatform());
    inject(controller, { setPusher });

    const result = await controller.registerPushNotifications();

    expect(result.status).toBe('registered');
    expect(setPusher).toHaveBeenCalledWith(expect.objectContaining({
      app_id: 'dev.example.aimtrix',
      append: true,
      data: {
        format: 'event_id_only',
        url: 'https://push.example.test/_matrix/push/v1/notify',
        endpoint: 'https://push.example.test/subscription',
        events_only: true,
        only_last_per_room: true,
        auth: 'auth-key',
      },
    }));
    expect(setPusher.mock.calls[0][0].data).not.toHaveProperty('content');
  });

  it('removes the Matrix pusher before unsubscribing the browser subscription', async () => {
    const config = structuredClone(defaultRuntimeConfig);
    config.push = {
      gatewayUrl: 'https://push.example.test/_matrix/push/v1/notify',
      appId: 'dev.example.aimtrix',
      webPush: { applicationServerKey: 'public-vapid-key' },
    };
    const removePusher = vi.fn().mockResolvedValue({});
    const platform = pushPlatform({
      endpoint: 'https://push.example.test/subscription',
      keys: { p256dh: 'p256dh-key' },
    });
    const controller = new MatrixController(config, platform);
    inject(controller, { removePusher });

    await controller.unregisterPushNotifications();

    expect(removePusher).toHaveBeenCalledWith('p256dh-key', 'dev.example.aimtrix');
    expect(platform.push.unsubscribe).toHaveBeenCalledOnce();
  });

  it('still clears the provider subscription when homeserver pusher removal fails', async () => {
    const config = structuredClone(defaultRuntimeConfig);
    config.push = {
      gatewayUrl: 'https://push.example.test/_matrix/push/v1/notify',
      appId: 'dev.example.aimtrix',
      webPush: { applicationServerKey: 'public-vapid-key' },
    };
    const platform = pushPlatform({
      endpoint: 'https://push.example.test/subscription',
      keys: { p256dh: 'p256dh-key' },
    });
    const controller = new MatrixController(config, platform);
    inject(controller, { removePusher: vi.fn().mockRejectedValue(new Error('homeserver unavailable')) });

    await expect(controller.unregisterPushNotifications()).rejects.toThrow('homeserver unavailable');
    expect(platform.push.unsubscribe).toHaveBeenCalledOnce();
  });

  it('registers a native provider token without web subscription fields', async () => {
    const config = structuredClone(defaultRuntimeConfig);
    config.push = {
      gatewayUrl: 'https://push.example.test/_matrix/push/v1/notify',
      appId: 'dev.alucard.aimtrix',
    };
    const setPusher = vi.fn().mockResolvedValue({});
    const platform = pushPlatform({
      endpoint: '',
      provider: 'native',
      pushKey: 'native-provider-token',
      keys: {},
    });
    const controller = new MatrixController(config, platform);
    inject(controller, { setPusher });

    const result = await controller.registerPushNotifications();

    expect(result.status).toBe('registered');
    expect(setPusher).toHaveBeenCalledWith(expect.objectContaining({
      pushkey: 'native-provider-token',
      data: {
        format: 'event_id_only',
        url: 'https://push.example.test/_matrix/push/v1/notify',
        events_only: true,
        only_last_per_room: true,
      },
    }));
  });

  it('removes a native Matrix pusher after restoring its provider token', async () => {
    const config = structuredClone(defaultRuntimeConfig);
    config.push = {
      gatewayUrl: 'https://push.example.test/_matrix/push/v1/notify',
      appId: 'dev.alucard.aimtrix',
    };
    const removePusher = vi.fn().mockResolvedValue({});
    const platform = pushPlatform({
      endpoint: '',
      provider: 'native',
      pushKey: 'native-provider-token',
      keys: {},
    });
    const controller = new MatrixController(config, platform);
    inject(controller, { removePusher });

    await controller.unregisterPushNotifications();

    expect(removePusher).toHaveBeenCalledWith('native-provider-token', 'dev.alucard.aimtrix');
    expect(platform.push.unsubscribe).toHaveBeenCalledOnce();
  });

  it('reports denied permission without touching the Matrix pusher', async () => {
    const platform = pushPlatform(undefined, { permission: 'default', requestPermission: 'denied' });
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig), platform);
    const setPusher = vi.fn();
    inject(controller, { setPusher });

    const result = await controller.registerPushNotifications();

    expect(result).toEqual({ status: 'denied', message: 'Notification permission was not granted.' });
    expect(setPusher).not.toHaveBeenCalled();
  });

  it('cleans up a newly-created provider subscription when the homeserver rejects it', async () => {
    const config = structuredClone(defaultRuntimeConfig);
    config.push = {
      gatewayUrl: 'https://push.example.test/_matrix/push/v1/notify',
      appId: 'dev.alucard.aimtrix',
      webPush: { applicationServerKey: 'public-vapid-key' },
    };
    const platform = pushPlatform();
    const controller = new MatrixController(config, platform);
    inject(controller, { setPusher: vi.fn().mockRejectedValue(new Error('provider rejected')) });

    const result = await controller.registerPushNotifications();

    expect(result.status).toBe('error');
    expect(platform.push.unsubscribe).toHaveBeenCalledOnce();
  });

  it('removes pushers associated with a device after deleting that device', async () => {
    const config = structuredClone(defaultRuntimeConfig);
    config.push = {
      gatewayUrl: 'https://push.example.test/_matrix/push/v1/notify',
      appId: 'dev.alucard.aimtrix',
    };
    const controller = new MatrixController(config);
    const internals = controller as unknown as ControllerInternals & {
      activeSession: { userId: string; deviceId: string };
    };
    internals.activeSession = { userId: '@alex:example.com', deviceId: 'CURRENT' };
    const removePusher = vi.fn().mockResolvedValue(undefined);
    inject(controller, {
      deleteDevice: vi.fn().mockResolvedValue(undefined),
      getPushers: vi.fn().mockResolvedValue({ pushers: [
        { app_id: 'dev.alucard.aimtrix', device_id: 'OTHER', pushkey: 'stale-token' },
        { app_id: 'other.app', device_id: 'OTHER', pushkey: 'other-token' },
      ] }),
      removePusher,
    });

    await expect(controller.removeDevice('OTHER')).resolves.toBe('removed');

    expect(removePusher).toHaveBeenCalledWith('stale-token', 'dev.alucard.aimtrix');
  });

  it('only plays a message tone for Matrix events allowed by push rules', () => {
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    const playMessageTone = vi.fn();
    const internals = controller as unknown as ControllerInternals;
    internals.playMessageTone = playMessageTone;
    internals.connection = 'online';
    inject(controller, {
      getPushActionsForEvent: vi.fn().mockReturnValue({ notify: false }),
      getRoomPushRule: vi.fn(),
    });

    internals.notifyForMessage(
      { getType: () => 'm.room.message' },
      { roomId: '!room:test' },
    );

    expect(playMessageTone).not.toHaveBeenCalled();
  });

  it('plays a message tone when Matrix push rules notify', () => {
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    const playMessageTone = vi.fn();
    const internals = controller as unknown as ControllerInternals;
    internals.playMessageTone = playMessageTone;
    internals.connection = 'online';
    inject(controller, {
      getPushActionsForEvent: vi.fn().mockReturnValue({ notify: true }),
      getRoomPushRule: vi.fn(),
    });

    internals.notifyForMessage(
      { getType: () => 'm.room.message' },
      { roomId: '!room:test' },
    );

    expect(playMessageTone).toHaveBeenCalledOnce();
  });

  it('keeps native foreground notification content generic and routes its tap', () => {
    const platform = pushPlatform();
    platform.capabilities.platform = 'android';
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig), platform);
    const internals = controller as unknown as ControllerInternals & {
      notificationPreferences: { desktopNotifications: boolean; notificationSounds: boolean; soundVolume: number };
    };
    internals.notificationPreferences = {
      desktopNotifications: true,
      notificationSounds: true,
      soundVolume: 0.55,
    };
    inject(controller, {
      getPushActionsForEvent: vi.fn().mockReturnValue({ notify: true }),
      getRoomPushRule: vi.fn(),
    });
    internals.connection = 'online';
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });

    internals.notifyForMessage(
      {
        getType: () => 'm.room.message',
        getContent: () => ({ body: 'private room content' }),
      },
      { roomId: '!room:test', name: 'Private room' },
    );

    const show = platform.notifications.show as ReturnType<typeof vi.fn>;
    expect(show).toHaveBeenCalledWith(expect.objectContaining({
      body: 'New Matrix activity',
      silent: false,
    }));
    const request = show.mock.calls[0][0] as { onClick: () => void };
    request.onClick();
    expect(platform.deepLinks.openRoute).toHaveBeenCalledWith({ roomId: '!room:test' });
    expect(platform.deepLinks.focus).toHaveBeenCalledOnce();
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  });

  it('sends a readable Matrix notice with the Aimtrix nudge marker', async () => {
    const sendEvent = vi.fn().mockResolvedValue({});
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, {
      getRoom: () => ({ hasEncryptionStateEvent: () => false } as unknown as import('matrix-js-sdk').Room),
      sendEvent,
    }, { EventType: { RoomMessage: 'm.room.message' }, MsgType: { Notice: 'm.notice' } });

    await controller.sendNudge('!room:test');

    expect(sendEvent).toHaveBeenCalledWith('!room:test', 'm.room.message', {
      msgtype: 'm.notice',
      body: 'Sent a nudge.',
      'dev.alucard.aimtrix.nudge.v1': { version: 1 },
    });
  });

  it('republishes when the SDK creates a thread after the timeline event', () => {
    const listeners = new Map<string, (thread: { room: { roomId: string } }) => void>();
    const room = {
      roomId: '!room:test',
      on: vi.fn((event: string, listener: (thread: { room: { roomId: string } }) => void) => {
        listeners.set(event, listener);
      }),
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, {} as Partial<MatrixClient>, {
      ThreadEvent: {
        New: 'Thread.new',
        Update: 'Thread.update',
        NewReply: 'Thread.newReply',
        Delete: 'Thread.delete',
      },
    });

    (controller as unknown as ControllerInternals).attachThreadListeners(room);
    listeners.get('Thread.new')?.({ room });

    expect((controller as unknown as ControllerInternals).snapshotCache.roomVersions.get('!room:test')).toBe(1);
  });

  it('writes standard room state and moderation operations', async () => {
    const client = {
      setRoomName: vi.fn().mockResolvedValue({}),
      setRoomTopic: vi.fn().mockResolvedValue({}),
      invite: vi.fn().mockResolvedValue({}),
      kick: vi.fn().mockResolvedValue({}),
      ban: vi.fn().mockResolvedValue({}),
      unban: vi.fn().mockResolvedValue({}),
      setPowerLevel: vi.fn().mockResolvedValue({}),
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client);

    await controller.updateRoomDetails('!room:test', { name: ' Aqua ', topic: ' Hello ' });
    await controller.inviteToRoom('!room:test', '@friend:test');
    await controller.removeRoomMember('!room:test', '@friend:test', 'kick');
    await controller.removeRoomMember('!room:test', '@friend:test', 'ban');
    await controller.removeRoomMember('!room:test', '@friend:test', 'unban');
    await controller.setRoomMemberPower('!room:test', '@friend:test', 50);
    await controller.setRoomMemberPower('!room:test', '@decorator:test', 25);

    expect(client.setRoomName).toHaveBeenCalledWith('!room:test', 'Aqua');
    expect(client.setRoomTopic).toHaveBeenCalledWith('!room:test', 'Hello');
    expect(client.invite).toHaveBeenCalledWith('!room:test', '@friend:test');
    expect(client.kick).toHaveBeenCalled();
    expect(client.ban).toHaveBeenCalled();
    expect(client.unban).toHaveBeenCalled();
    expect(client.setPowerLevel).toHaveBeenCalledWith('!room:test', '@friend:test', 50);
    expect(client.setPowerLevel).toHaveBeenCalledWith('!room:test', '@decorator:test', 25);
  });

  it('sends thread replies through the Matrix SDK thread overload', async () => {
    const sendEvent = vi.fn().mockResolvedValue({});
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, { sendEvent, getRoom: () => ({ roomId: '!room:test', hasEncryptionStateEvent: () => false, getEventForTxnId: () => undefined }) } as unknown as Partial<MatrixClient>, {
      EventType: { RoomMessage: 'm.room.message' },
      MsgType: { Text: 'm.text' },
    });

    await controller.sendReply('!room:test', 'Absolutely, @Mara.', {
      id: '$reply-to:test',
      senderId: '@mara:test',
      body: 'Ship it?',
      threadRootId: '$root:test',
    }, [{ userId: '@mara:test', label: 'Mara' }]);

    expect(sendEvent).toHaveBeenCalledWith(
      '!room:test',
      '$root:test',
      'm.room.message',
      expect.objectContaining({
        msgtype: 'm.text',
        'm.mentions': { user_ids: ['@mara:test'] },
        formatted_body: expect.stringMatching(/^<mx-reply>.*<\/mx-reply><p>Absolutely, <a href="https:\/\/matrix\.to\/#\/%40mara%3Atest">@Mara<\/a>\.<\/p>$/),
        'm.relates_to': { 'm.in_reply_to': { event_id: '$reply-to:test' } },
      }),
      'synthetic-transaction',
    );
  });

  it('marks the latest thread event read without advancing the main timeline', async () => {
    const latest = { getId: () => '$thread-reply:test', getRoomId: () => '!room:test', threadRootId: '$root:test' };
    const authedRequest = vi.fn().mockResolvedValue({});
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, {
      getRoom: () => ({ hasPendingEvent: () => false, getThread: () => ({ events: [latest] }), setThreadUnreadNotificationCount: vi.fn() } as unknown as import('matrix-js-sdk').Room),
      http: { authedRequest } as unknown as MatrixClient['http'],
    });

    await controller.markThreadRead('!room:test', '$root:test');

    expect(authedRequest).toHaveBeenCalledWith('POST', '/rooms/!room%3Atest/receipt/m.read/%24thread-reply%3Atest', undefined, { thread_id: '$root:test' });
  });

  it('uploads an unencrypted attachment and sends a Matrix file event', async () => {
    const progress = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue({});
    const uploadContent = vi.fn().mockImplementation(async (_file: Blob, options: { progressHandler?: (value: { loaded: number; total: number }) => void }) => {
      options.progressHandler?.({ loaded: 4, total: 4 });
      return { content_uri: 'mxc://test/file' };
    });
    const client = {
      getRoom: vi.fn().mockReturnValue({ hasEncryptionStateEvent: () => false }),
      uploadContent,
      sendMessage,
    };
    const sdk = {
      MsgType: { Image: 'm.image', Video: 'm.video', Audio: 'm.audio', File: 'm.file' },
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client, sdk);

    await controller.uploadAttachment(
      '!room:test',
      new File(['data'], 'notes.txt', { type: 'text/plain' }),
      progress,
      undefined,
      'typescript',
    );

    expect(progress).toHaveBeenCalledWith(4, 4);
    expect(sendMessage).toHaveBeenCalledWith(
      '!room:test',
      expect.objectContaining({
        msgtype: 'm.file',
        body: 'notes.txt',
        url: 'mxc://test/file',
        'dev.alucard.aimtrix.code.v1': { language: 'typescript' },
      }),
    );
  });

  it('fetches SVG stickers from the original media endpoint instead of an unsupported thumbnail', async () => {
    const mxcUrlToHttp = vi.fn().mockReturnValue('https://matrix.test/media');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }),
    ));
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn().mockReturnValue('blob:sticker'),
      configurable: true,
    });
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, {
      getAccessToken: () => 'token',
      mxcUrlToHttp,
    } as unknown as Partial<MatrixClient>);

    await expect(
      controller.resolveMedia('mxc://test/sticker', 320, undefined, 'image/svg+xml'),
    ).resolves.toBe('blob:sticker');
    expect(mxcUrlToHttp).toHaveBeenCalledWith('mxc://test/sticker', undefined, undefined, undefined, false, true, true);

    await controller.resolveMedia('mxc://test/photo', 320, undefined, 'image/png');
    expect(mxcUrlToHttp).toHaveBeenCalledWith('mxc://test/photo', 320, 320, 'crop', false, true, true);
    vi.unstubAllGlobals();
  });

  it('encrypts sticker media in encrypted rooms and keeps plaintext uploads out of them', async () => {
    const sendEvent = vi.fn().mockResolvedValue({});
    const uploadContent = vi.fn().mockResolvedValue({ content_uri: 'mxc://test/encrypted-sticker' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<svg/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } }),
    ));
    const room = { hasEncryptionStateEvent: () => true };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, {
      getRoom: vi.fn().mockReturnValue(room),
      uploadContent,
      sendEvent,
    } as unknown as Partial<MatrixClient>, {
      EventType: { Sticker: 'm.sticker' },
    });

    await controller.sendSticker('!room:test', { id: 'lol', name: 'Laughing bubble', src: '/stickers/aqua/lol.svg' });

    expect(uploadContent).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ type: 'application/octet-stream' }),
    );
    const [roomId, type, content] = sendEvent.mock.calls[0] as unknown as [string, string, {
      body: string;
      url?: string;
      file?: { url?: string; key?: { k?: string } };
      info?: { mimetype?: string };
    }];
    expect(roomId).toBe('!room:test');
    expect(type).toBe('m.sticker');
    expect(content.body).toBe('Laughing bubble');
    expect(content.info?.mimetype).toBe('image/svg+xml');
    expect(content.url).toBeUndefined();
    expect(content.file?.url).toBe('mxc://test/encrypted-sticker');
    expect(content.file?.key?.k).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it('uploads custom PNG emoji with matching portable sticker metadata', async () => {
    const uploadContent = vi.fn().mockResolvedValue({ content_uri: 'mxc://test/bufo' });
    const sendEvent = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['png'], { type: 'image/png' })),
    }));
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, {
      getRoom: () => ({ hasEncryptionStateEvent: () => false }),
      uploadContent,
      sendEvent,
    } as unknown as Partial<MatrixClient>, {
      EventType: { Sticker: 'm.sticker' },
    });

    await controller.sendSticker('!room:test', {
      id: 'bufo-wave',
      name: 'Bufo wave',
      src: '/emoji/bufo-wave.png',
    });

    expect(uploadContent).toHaveBeenCalledWith(expect.any(Blob), {
      name: 'bufo-wave.png',
      type: 'image/png',
      includeFilename: false,
    });
    expect(sendEvent).toHaveBeenCalledWith('!room:test', 'm.sticker', expect.objectContaining({
      body: 'Bufo wave',
      url: 'mxc://test/bufo',
      info: expect.objectContaining({ mimetype: 'image/png' }),
    }));
    vi.unstubAllGlobals();
  });

  it('persists Matrix space child order with standard state events', async () => {
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const childEvents = new Map([
      ['!one:test', { getContent: () => ({ via: ['test'], suggested: true }) }],
      ['!two:test', { getContent: () => ({ via: ['test'] }) }],
    ]);
    const space = {
      getType: () => 'm.space',
      currentState: {
        maySendStateEvent: () => true,
        getStateEvents: (_type: string, stateKey: string) => childEvents.get(stateKey),
      },
    };
    const client = {
      getRoom: vi.fn((roomId: string) => roomId === '!space:test' ? space : undefined),
      getSafeUserId: () => '@you:test',
      sendStateEvent,
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>, {
      EventType: { SpaceChild: 'm.space.child', SpaceParent: 'm.space.parent' },
    });

    await controller.reorganizeSpaceChildren({
      childId: '!two:test',
      sourceSpaceId: '!space:test',
      targetSpaceId: '!space:test',
      sourceChildIds: ['!two:test', '!one:test'],
      targetChildIds: ['!two:test', '!one:test'],
    });

    expect(sendStateEvent).toHaveBeenNthCalledWith(
      1,
      '!space:test',
      'm.space.child',
      { via: ['test'], order: '000000' },
      '!two:test',
    );
    expect(sendStateEvent).toHaveBeenNthCalledWith(
      2,
      '!space:test',
      'm.space.child',
      { via: ['test'], suggested: true, order: '000001' },
      '!one:test',
    );
  });

  it('persists top-level spaces with standard MSC3230 room account data', async () => {
    const setRoomAccountData = vi.fn().mockResolvedValue({});
    const room = (roomId: string, name: string, parentId?: string) => ({
      roomId,
      name,
      getType: () => 'm.space',
      getMyMembership: () => 'join',
      getLiveTimeline: () => ({ getEvents: () => [] }),
      getThreads: () => [],
      getMember: () => ({ powerLevel: 100 }),
      getMembers: () => [],
      getJoinedMembers: () => [],
      getUnreadNotificationCount: () => 0,
      getRoomUnreadNotificationCount: () => 0,
      getEventReadUpTo: () => null,
      getLastActiveTimestamp: () => 0,
      getDefaultRoomName: () => name,
      getMxcAvatarUrl: () => undefined,
      getAccountData: () => undefined,
      currentState: {
        getStateEvents: (type: string, stateKey?: string) => {
          if (stateKey !== undefined) return undefined;
          if (type !== 'm.space.parent' || !parentId) return [];
          return [{
            getStateKey: () => parentId,
            getContent: () => ({ via: ['test'] }),
            isRedacted: () => false,
          }];
        },
        maySendStateEvent: () => true,
      },
    });
    const spaces = [
      room('!one:test', 'One'),
      room('!nested:test', 'Nested', '!one:test'),
      room('!two:test', 'Two'),
    ];
    const client = {
      getSafeUserId: () => '@you:test',
      getUser: () => null,
      getAccountData: () => undefined,
      getVisibleRooms: () => spaces,
      getRooms: () => spaces,
      getRoom: (roomId: string) => spaces.find((space) => space.roomId === roomId),
      getRoomPushRule: () => undefined,
      setRoomAccountData,
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>, {
      EventType: { SpaceOrder: 'org.matrix.msc3230.space_order' },
    });

    await controller.reorderRootSpaces(['!two:test', '!one:test']);

    expect(setRoomAccountData).toHaveBeenNthCalledWith(
      1,
      '!two:test',
      'org.matrix.msc3230.space_order',
      { order: '000000' },
    );
    expect(setRoomAccountData).toHaveBeenNthCalledWith(
      2,
      '!one:test',
      'org.matrix.msc3230.space_order',
      { order: '000001' },
    );
    expect(setRoomAccountData).toHaveBeenCalledTimes(2);
  });

  it('migrates the legacy private root order to standard room account data once', async () => {
    const setRoomAccountData = vi.fn().mockResolvedValue({});
    const room = (roomId: string) => ({
      roomId,
      getType: () => 'm.space',
      getMyMembership: () => 'join',
      getAccountData: () => undefined,
      currentState: { getStateEvents: () => [] },
    });
    const spaces = [room('!one:test'), room('!two:test')];
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, {
      getRooms: () => spaces,
      getRoom: (roomId: string) => spaces.find((space) => space.roomId === roomId),
      getAccountData: (type: string) => type === 'dev.alucard.aimtrix.space_order.v1'
        ? { getContent: () => ({ order: ['!two:test', '!one:test'] }) }
        : undefined,
      setRoomAccountData,
    } as unknown as Partial<MatrixClient>, {
      EventType: { SpaceOrder: 'org.matrix.msc3230.space_order' },
    });

    const internals = controller as unknown as ControllerInternals;
    internals.migrateLegacyRootSpaceOrder();
    internals.migrateLegacyRootSpaceOrder();

    await vi.waitFor(() => expect(setRoomAccountData).toHaveBeenCalledTimes(2));
    expect(setRoomAccountData).toHaveBeenNthCalledWith(
      1,
      '!two:test',
      'org.matrix.msc3230.space_order',
      { order: '000000' },
    );
    expect(setRoomAccountData).toHaveBeenNthCalledWith(
      2,
      '!one:test',
      'org.matrix.msc3230.space_order',
      { order: '000001' },
    );
  });

  it('validates profile banners and returns their Matrix media URI', async () => {
    const uploadContent = vi.fn().mockResolvedValue({ content_uri: 'mxc://test/banner' });
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, { uploadContent } as Partial<MatrixClient>);

    await expect(controller.uploadProfileBanner(new File(['bad'], 'banner.svg', { type: 'image/svg+xml' }))).rejects.toThrow(/PNG/);
    await expect(controller.uploadProfileBanner(new File(['image'], 'banner.png', { type: 'image/png' }))).resolves.toBe('mxc://test/banner');
    expect(uploadContent).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ includeFilename: false }));
  });

  it('reports explicit profile save failures and prevents an older queued save overwriting retry', async () => {
    vi.useFakeTimers();
    try {
      const setAccountData = vi.fn().mockRejectedValueOnce(new Error('synthetic denial')).mockResolvedValue({});
      const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
      inject(controller, { getAccountData: vi.fn(), setAccountData } as unknown as Partial<MatrixClient>);
      controller.loadProfilePersonalization();
      controller.saveProfilePersonalization({ ...defaultProfilePersonalization, bio: 'Earlier synthetic draft' });
      const next = { ...defaultProfilePersonalization, bio: 'Current synthetic draft' };
      await expect(controller.updateProfilePersonalization(next)).rejects.toThrow('synthetic denial');
      await expect(controller.updateProfilePersonalization(next)).resolves.toBeUndefined();
      await vi.advanceTimersByTimeAsync(1000);
      expect(setAccountData).toHaveBeenCalledTimes(2);
      expect(setAccountData).toHaveBeenLastCalledWith('dev.alucard.aimtrix.profile.v1', expect.objectContaining({ bio: next.bio }));
    } finally { vi.useRealTimers(); }
  });

  it('loads and privately saves strictly parsed profile decorations', async () => {
    vi.useFakeTimers();
    try {
      const setAccountData = vi.fn().mockResolvedValue({});
      const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
      inject(controller, {
        getAccountData: vi.fn().mockReturnValue({ getContent: () => ({ bannerPreset: 'lagoon', bio: 'Hello!' }) }),
        setAccountData,
      } as unknown as Partial<MatrixClient>);

      expect(controller.loadProfilePersonalization()).toMatchObject({ bannerPreset: 'lagoon', bio: 'Hello!' });
      controller.saveProfilePersonalization({ ...defaultProfilePersonalization, bio: 'Private page' });
      await vi.advanceTimersByTimeAsync(500);

      expect(setAccountData).toHaveBeenCalledWith(
        'dev.alucard.aimtrix.profile.v1',
        expect.objectContaining({ bio: 'Private page', bannerPreset: 'sky' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('orders explicit profile saves after an in-flight initial fallback', async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const setAccountData = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue({});
      const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
      inject(controller, { getAccountData: vi.fn(), setAccountData } as unknown as Partial<MatrixClient>);
      controller.loadProfilePersonalization();
      controller.saveProfilePersonalization(defaultProfilePersonalization);
      await vi.advanceTimersByTimeAsync(500);
      const save = controller.updateProfilePersonalization({ ...defaultProfilePersonalization, bannerPreset: 'twilight' });
      await Promise.resolve(); expect(setAccountData).toHaveBeenCalledTimes(1);
      finish(); await save;
      expect(setAccountData).toHaveBeenLastCalledWith('dev.alucard.aimtrix.profile.v1', expect.objectContaining({ bannerPreset: 'twilight' }));
    } finally { vi.useRealTimers(); }
  });

  it('never applies a queued profile fallback to a replacement Matrix client', async () => {
    vi.useFakeTimers();
    try {
      const oldWrite = vi.fn(); const replacementWrite = vi.fn();
      const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
      inject(controller, { getAccountData: vi.fn(), setAccountData: oldWrite } as unknown as Partial<MatrixClient>);
      controller.loadProfilePersonalization(); controller.saveProfilePersonalization(defaultProfilePersonalization);
      inject(controller, { setAccountData: replacementWrite } as unknown as Partial<MatrixClient>);
      await vi.advanceTimersByTimeAsync(500);
      expect(oldWrite).not.toHaveBeenCalled(); expect(replacementWrite).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it('writes shared backgrounds and power-level-backed decorator policy', async () => {
    const sendStateEvent = vi.fn().mockResolvedValue({});
    const room = {
      currentState: {
        maySendStateEvent: vi.fn().mockReturnValue(true),
        getStateEvents: vi.fn().mockReturnValue({
          getContent: () => ({ users_default: 0, state_default: 50, events: { 'm.room.name': 50 } }),
        }),
      },
    };
    const client = {
      getRoom: vi.fn().mockReturnValue(room),
      getSafeUserId: () => '@admin:test',
      sendStateEvent,
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>, {
      EventType: { RoomPowerLevels: 'm.room.power_levels' },
    });

    await controller.setRoomBackground('!room:test', { preset: 'blue-lagoon' }, false);
    await controller.setRoomBackgroundPolicy('!room:test', 'decorators');

    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:test',
      'dev.alucard.aimtrix.room_background.v1',
      { preset: 'blue-lagoon' },
      '',
    );
    expect(sendStateEvent).toHaveBeenCalledWith(
      '!room:test',
      'm.room.power_levels',
      expect.objectContaining({
        events: expect.objectContaining({
          'm.room.name': 50,
          'dev.alucard.aimtrix.room_background.v1': 25,
        }),
      }),
      '',
    );
  });

  it('stores each DM backdrop in private account data', async () => {
    const setAccountData = vi.fn().mockResolvedValue({});
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, {
      getAccountData: vi.fn().mockReturnValue({ getContent: () => ({ rooms: {} }) }),
      setAccountData,
    } as unknown as Partial<MatrixClient>);

    await controller.setRoomBackground('!dm:test', { preset: 'soft-twilight' }, true);

    expect(setAccountData).toHaveBeenCalledWith(
      'dev.alucard.aimtrix.direct_backgrounds.v1',
      { rooms: { '!dm:test': { preset: 'soft-twilight' } } },
    );
  });

  it('writes a room mute push rule through the homeserver', async () => {
    const setRoomMutePushRule = vi.fn().mockResolvedValue(undefined);
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, { setRoomMutePushRule } as Partial<MatrixClient>);

    await controller.setRoomMuted('!quiet:test', true);

    expect(setRoomMutePushRule).toHaveBeenCalledWith('global', '!quiet:test', true);
  });

  it('sends a read receipt only once per latest event', async () => {
    const lastEvent = { getId: () => '$latest:test', getRoomId: () => '!room:test' };
    const room = {
      hasPendingEvent: () => false,
      getLiveTimeline: () => ({ getEvents: () => [lastEvent] }),
      getReadReceiptForUserId: vi.fn().mockReturnValue(null),
      getRoomUnreadNotificationCount: vi.fn().mockReturnValue(3),
      setUnreadNotificationCount: vi.fn(),
    };
    const client = {
      getRoom: vi.fn().mockReturnValue(room),
      getSafeUserId: () => '@me:test',
      http: { authedRequest: vi.fn().mockResolvedValue({}) },
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>);

    await controller.markRoomRead('!room:test');
    await controller.markRoomRead('!room:test');
    await controller.markRoomRead('!room:test');

    expect(client.http.authedRequest).toHaveBeenCalledTimes(1);
    expect(client.http.authedRequest).toHaveBeenCalledWith('POST', '/rooms/!room%3Atest/receipt/m.read/%24latest%3Atest', undefined, { thread_id: 'main' });
  });

  it('ignores newer thread replies when advancing the main timeline receipt', async () => {
    const mainEvent = { getId: () => '$main:test', getRoomId: () => '!room:test' };
    const threadEvent = { getId: () => '$thread:test', threadRootId: '$root:test' };
    const room = {
      hasPendingEvent: () => false,
      getLiveTimeline: () => ({ getEvents: () => [mainEvent, threadEvent] }),
      getReadReceiptForUserId: vi.fn().mockReturnValue(null),
      getRoomUnreadNotificationCount: vi.fn().mockReturnValue(2),
      setUnreadNotificationCount: vi.fn(),
    };
    const client = {
      getRoom: vi.fn().mockReturnValue(room),
      getSafeUserId: () => '@me:test',
      http: { authedRequest: vi.fn().mockResolvedValue({}) },
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>, {
      inMainTimelineForReceipt: (event: { threadRootId?: string }) => !event.threadRootId,
    });

    await controller.markRoomRead('!room:test');

    expect(client.http.authedRequest).toHaveBeenCalledWith('POST', '/rooms/!room%3Atest/receipt/m.read/%24main%3Atest', undefined, { thread_id: 'main' });
  });

  it('clears main unread counts only after the receipt round trip succeeds', async () => {
    const lastEvent = { getId: () => '$latest:test', getRoomId: () => '!room:test' };
    const room = {
      hasPendingEvent: () => false,
      getLiveTimeline: () => ({ getEvents: () => [lastEvent] }),
      getReadReceiptForUserId: vi.fn().mockReturnValue(null),
      getRoomUnreadNotificationCount: vi.fn().mockReturnValue(3),
      setUnreadNotificationCount: vi.fn(),
    };
    const client = {
      getRoom: vi.fn().mockReturnValue(room),
      getSafeUserId: () => '@me:test',
      http: { authedRequest: vi.fn().mockResolvedValue({}) },
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>);

    const receipt = controller.markRoomRead('!room:test');

    expect(room.setUnreadNotificationCount).not.toHaveBeenCalled();
    await receipt;
    expect(room.setUnreadNotificationCount).toHaveBeenCalledWith('total', 0);
    expect(room.setUnreadNotificationCount).toHaveBeenCalledWith('highlight', 0);
  });

  it('preserves unread counts and allows retry when sending the receipt fails', async () => {
    const lastEvent = { getId: () => '$latest:test', getRoomId: () => '!room:test' };
    const room = {
      hasPendingEvent: () => false,
      getLiveTimeline: () => ({ getEvents: () => [lastEvent] }),
      getReadReceiptForUserId: vi.fn().mockReturnValue(null),
      getRoomUnreadNotificationCount: vi.fn((type: string) => type === 'total' ? 5 : 2),
      setUnreadNotificationCount: vi.fn(),
    };
    const client = {
      getRoom: vi.fn().mockReturnValue(room),
      getSafeUserId: () => '@me:test',
      http: { authedRequest: vi.fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({}) },
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>);

    await expect(controller.markRoomRead('!room:test')).rejects.toThrow('offline');
    expect(room.setUnreadNotificationCount).not.toHaveBeenCalled();
    await controller.markRoomRead('!room:test');

    expect(room.setUnreadNotificationCount).toHaveBeenCalledWith('total', 0);
    expect(room.setUnreadNotificationCount).toHaveBeenCalledWith('highlight', 0);
    expect(client.http.authedRequest).toHaveBeenCalledTimes(2);
  });

  it('skips the receipt when the server already has us at the latest event', async () => {
    const lastEvent = { getId: () => '$latest:test', getRoomId: () => '!room:test' };
    const room = {
      hasPendingEvent: () => false,
      getLiveTimeline: () => ({ getEvents: () => [lastEvent] }),
      getReadReceiptForUserId: vi.fn().mockReturnValue({ eventId: '$latest:test' }),
      getRoomUnreadNotificationCount: vi.fn().mockReturnValue(3),
      setUnreadNotificationCount: vi.fn(),
    };
    const client = {
      getRoom: vi.fn().mockReturnValue(room),
      getSafeUserId: () => '@me:test',
      http: { authedRequest: vi.fn().mockResolvedValue({}) },
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>);

    await controller.markRoomRead('!room:test');

    expect(client.http.authedRequest).not.toHaveBeenCalled();
  });
});
