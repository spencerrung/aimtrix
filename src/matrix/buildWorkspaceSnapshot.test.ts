import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import {
  buildWorkspaceSnapshot,
  createWorkspaceSnapshotCache,
} from './buildWorkspaceSnapshot';

function fakeEvent(
  type: string,
  content: Record<string, unknown>,
  id = '$event:test',
  sender = '@mara:test',
): MatrixEvent {
  return {
    getId: () => id,
    getSender: () => sender,
    getTs: () => 1000,
    getType: () => type,
    getContent: () => content,
    isRedacted: () => false,
    status: null,
  } as unknown as MatrixEvent;
}

function fakeClient(events: MatrixEvent[]): MatrixClient {
  const room = {
    roomId: '!room:test',
    name: 'Sticker Room',
    getMyMembership: () => 'join',
    getType: () => undefined,
    getLiveTimeline: () => ({ getEvents: () => events }),
    getMember: vi.fn().mockReturnValue(undefined),
    getMembers: () => [],
    getJoinedMembers: () => [],
    getUnreadNotificationCount: () => 0,
    getLastActiveTimestamp: () => 0,
    getDefaultRoomName: () => 'Sticker Room',
    getMxcAvatarUrl: () => undefined,
    hasEncryptionStateEvent: () => true,
    currentState: {
      getStateEvents: () => undefined,
      maySendStateEvent: () => false,
    },
  } as unknown as Room;

  return {
    getSafeUserId: () => '@me:test',
    getUser: () => null,
    getAccountData: () => undefined,
    getVisibleRooms: () => [room],
    getRoomPushRule: () => undefined,
  } as unknown as MatrixClient;
}

describe('buildWorkspaceSnapshot stickers', () => {
  it('renders plain stickers from their original Matrix media URL', () => {
    const client = fakeClient([
      fakeEvent('m.sticker', {
        body: 'Laughing bubble',
        url: 'mxc://test/sticker',
        info: { mimetype: 'image/svg+xml' },
      }),
    ]);

    const [message] = buildWorkspaceSnapshot(client, 'online').messagesByRoom['!room:test'];
    expect(message).toMatchObject({
      kind: 'sticker',
      body: 'Laughing bubble',
      mediaUrl: 'mxc://test/sticker',
      mimeType: 'image/svg+xml',
      encryptedFile: undefined,
    });
  });

  it('renders encrypted stickers from content.file with decryption metadata', () => {
    const client = fakeClient([
      fakeEvent('m.sticker', {
        body: 'Encrypted hello',
        file: {
          url: 'mxc://test/encrypted-sticker',
          key: { kty: 'oct', key_ops: ['encrypt', 'decrypt'], alg: 'A256CTR', k: 'key', ext: true },
          iv: 'iv',
          hashes: { sha256: 'hash' },
        },
        info: { mimetype: 'image/png' },
      }),
    ]);

    const [message] = buildWorkspaceSnapshot(client, 'online').messagesByRoom['!room:test'];
    expect(message).toMatchObject({
      kind: 'sticker',
      body: 'Encrypted hello',
      mediaUrl: 'mxc://test/encrypted-sticker',
      mimeType: 'image/png',
    });
    expect((message.encryptedFile as unknown as { url?: string })?.url).toBe('mxc://test/encrypted-sticker');
    expect(message.encryptedFile?.key.k).toBe('key');
  });
});

describe('buildWorkspaceSnapshot cache', () => {
  it('reuses message arrays when the room version and timeline are unchanged', () => {
    const client = fakeClient([
      fakeEvent('m.room.message', { msgtype: 'm.text', body: 'hello' }),
    ]);
    const cache = createWorkspaceSnapshotCache();
    const first = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    const second = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    expect(second.messagesByRoom['!room:test']).toBe(first.messagesByRoom['!room:test']);
  });

  it('rebuilds and keeps stable message identities when the room version bumps', () => {
    const events = [
      fakeEvent('m.room.message', { msgtype: 'm.text', body: 'hello' }, '$a:test'),
      fakeEvent('m.room.message', { msgtype: 'm.text', body: 'world' }, '$b:test'),
    ];
    const client = fakeClient(events);
    const cache = createWorkspaceSnapshotCache();
    const first = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    cache.roomVersions.set('!room:test', 1);
    events.push(fakeEvent('m.room.message', { msgtype: 'm.text', body: 'again' }, '$c:test'));
    const second = buildWorkspaceSnapshot(client, 'online', [], [], cache);
    const firstMessages = first.messagesByRoom['!room:test'];
    const secondMessages = second.messagesByRoom['!room:test'];
    expect(secondMessages).not.toBe(firstMessages);
    expect(secondMessages).toHaveLength(3);
    expect(secondMessages[0]).toBe(firstMessages[0]);
    expect(secondMessages[1]).toBe(firstMessages[1]);
  });
});
