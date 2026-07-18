import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
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

    expect(client.setRoomName).toHaveBeenCalledWith('!room:test', 'Aqua');
    expect(client.setRoomTopic).toHaveBeenCalledWith('!room:test', 'Hello');
    expect(client.invite).toHaveBeenCalledWith('!room:test', '@friend:test');
    expect(client.kick).toHaveBeenCalled();
    expect(client.ban).toHaveBeenCalled();
    expect(client.unban).toHaveBeenCalled();
    expect(client.setPowerLevel).toHaveBeenCalledWith('!room:test', '@friend:test', 50);
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

  it('writes a room mute push rule through the homeserver', async () => {
    const setRoomMutePushRule = vi.fn().mockResolvedValue(undefined);
    const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
    inject(controller, { setRoomMutePushRule } as Partial<MatrixClient>);

    await controller.setRoomMuted('!quiet:test', true);

    expect(setRoomMutePushRule).toHaveBeenCalledWith('global', '!quiet:test', true);
  });
});
