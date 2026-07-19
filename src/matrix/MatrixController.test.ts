import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { defaultProfilePersonalization } from '../settings/profilePersonalization';
import { MatrixController } from './MatrixController';

type ControllerInternals = {
  client?: MatrixClient;
  sdk?: typeof import('matrix-js-sdk');
};

function inject(
  controller: MatrixController,
  client: Partial<MatrixClient>,
  sdk: unknown = {},
) {
  const internals = controller as unknown as ControllerInternals;
  internals.client = client as MatrixClient;
  internals.sdk = sdk as typeof import('matrix-js-sdk');
}

describe('MatrixController protocol integration', () => {
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
    );

    expect(progress).toHaveBeenCalledWith(4, 4);
    expect(sendMessage).toHaveBeenCalledWith(
      '!room:test',
      expect.objectContaining({
        msgtype: 'm.file',
        body: 'notes.txt',
        url: 'mxc://test/file',
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

  it('validates profile banners and returns their Matrix media URI', async () => {
    const uploadContent = vi.fn().mockResolvedValue({ content_uri: 'mxc://test/banner' });
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, { uploadContent } as Partial<MatrixClient>);

    await expect(controller.uploadProfileBanner(new File(['bad'], 'banner.svg', { type: 'image/svg+xml' }))).rejects.toThrow(/PNG/);
    await expect(controller.uploadProfileBanner(new File(['image'], 'banner.png', { type: 'image/png' }))).resolves.toBe('mxc://test/banner');
    expect(uploadContent).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ includeFilename: false }));
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
    const lastEvent = { getId: () => '$latest:test' };
    const room = {
      getLiveTimeline: () => ({ getEvents: () => [lastEvent] }),
      getReadReceiptForUserId: vi.fn().mockReturnValue(null),
    };
    const client = {
      getRoom: vi.fn().mockReturnValue(room),
      getSafeUserId: () => '@me:test',
      sendReadReceipt: vi.fn().mockResolvedValue({}),
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>);

    await controller.markRoomRead('!room:test');
    await controller.markRoomRead('!room:test');
    await controller.markRoomRead('!room:test');

    expect(client.sendReadReceipt).toHaveBeenCalledTimes(1);
    expect(client.sendReadReceipt).toHaveBeenCalledWith(lastEvent);
  });

  it('skips the receipt when the server already has us at the latest event', async () => {
    const lastEvent = { getId: () => '$latest:test' };
    const room = {
      getLiveTimeline: () => ({ getEvents: () => [lastEvent] }),
      getReadReceiptForUserId: vi.fn().mockReturnValue({ eventId: '$latest:test' }),
    };
    const client = {
      getRoom: vi.fn().mockReturnValue(room),
      getSafeUserId: () => '@me:test',
      sendReadReceipt: vi.fn().mockResolvedValue({}),
    };
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, client as unknown as Partial<MatrixClient>);

    await controller.markRoomRead('!room:test');

    expect(client.sendReadReceipt).not.toHaveBeenCalled();
  });
});
