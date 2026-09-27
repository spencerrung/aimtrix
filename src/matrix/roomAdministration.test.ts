import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { MatrixController } from './MatrixController';
import { aclAllowsServer, normalizeServerList, validLocalAlias } from './roomAdministration';

describe('room administration validation', () => {
  it('keeps the local server reachable and only accepts its own aliases', () => {
    expect(normalizeServerList('*.test, example.test\n*.test')).toEqual(['*.test', 'example.test']);
    expect(aclAllowsServer('example.test', ['*'], ['*.blocked.test'])).toBe(true);
    expect(aclAllowsServer('node.example.test', ['*.example.test'], [])).toBe(true);
    expect(aclAllowsServer('example.test', ['*'], ['example.test'])).toBe(false);
    expect(validLocalAlias('#welcome:example.test', 'example.test')).toBe(true);
    expect(validLocalAlias('#welcome:other.test', 'example.test')).toBe(false);
    expect(validLocalAlias('#welcome:other:example.test', 'example.test')).toBe(false);
  });
});

function fixture() {
  let directoryVisibility = 'private';
  const state = new Map<string, Record<string, unknown>>([
    ['m.room.create|', { room_version: '10' }],
    ['m.room.join_rules|', { join_rule: 'invite' }],
    ['m.room.history_visibility|', { history_visibility: 'shared' }],
    ['m.room.guest_access|', { guest_access: 'forbidden' }],
    ['m.room.canonical_alias|', { alias: '#welcome:example.test' }],
    ['m.room.server_acl|', { allow: ['*'], deny: [], allow_ip_literals: true }],
    ['m.space.child|!room:test', { via: ['example.test'], suggested: false, order: 'a' }],
  ]);
  const event = (type: string, key = '') => state.has(`${type}|${key}`)
    ? { getContent: () => state.get(`${type}|${key}`), getStateKey: () => key }
    : undefined;
  const room = {
    roomId: '!room:test', getMyMembership: () => 'join', getType: () => undefined,
    currentState: { getStateEvents: event, maySendStateEvent: vi.fn().mockReturnValue(true) },
  } as unknown as Room;
  const space = {
    roomId: '!space:test', getMyMembership: () => 'join', getType: () => 'm.space',
    currentState: { getStateEvents: event, maySendStateEvent: vi.fn().mockReturnValue(true) },
  } as unknown as Room;
  const subspace = {
    roomId: '!subspace:test', getMyMembership: () => 'join', getType: () => 'm.space',
    currentState: { getStateEvents: event, maySendStateEvent: vi.fn().mockReturnValue(true) },
  } as unknown as Room;
  const client = {
    getRoom: (id: string) => id === '!room:test' ? room : id === '!space:test' ? space : id === '!subspace:test' ? subspace : undefined,
    getSafeUserId: () => '@self:example.test',
    getLocalAliases: vi.fn().mockResolvedValue({ aliases: ['#welcome:example.test'] }),
    getRoomDirectoryVisibility: vi.fn().mockImplementation(async () => ({ visibility: directoryVisibility })),
    getCapabilities: vi.fn().mockResolvedValue({ 'm.room_versions': { default: '11', available: { '11': 'stable' } } }),
    getStateEvent: vi.fn().mockImplementation(async (_id: string, type: string, key: string) => state.get(`${type}|${key}`) ?? {}),
    getRoomIdForAlias: vi.fn().mockResolvedValue({ room_id: '!room:test' }),
    createAlias: vi.fn().mockResolvedValue({}), deleteAlias: vi.fn().mockResolvedValue({}),
    setRoomDirectoryVisibility: vi.fn().mockImplementation(async (_id: string, visibility: string) => { directoryVisibility = visibility; return {}; }),
    upgradeRoom: vi.fn().mockResolvedValue({ replacement_room: '!replacement:test' }),
    sendStateEvent: vi.fn().mockImplementation(async (_id: string, type: string, content: Record<string, unknown>, key: string) => { state.set(`${type}|${key}`, content); return { event_id: '$updated' }; }),
  };
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  const internal = controller as unknown as { client: MatrixClient; sdk: typeof import('matrix-js-sdk'); activeSession: { serverName: string }; scheduleWorkspacePublish: () => void };
  internal.client = client as unknown as MatrixClient;
  internal.sdk = { Visibility: { Public: 'public', Private: 'private' } } as unknown as typeof import('matrix-js-sdk');
  internal.activeSession = { serverName: 'example.test' };
  internal.scheduleWorkspacePublish = vi.fn();
  return { controller, client, room, space, subspace, state };
}

describe('MatrixController room administration', () => {
  it('reads live state and checks a room access write against server readback', async () => {
    const { controller, client } = fixture();
    await expect(controller.getRoomAdministration('!room:test')).resolves.toMatchObject({
      localAliases: ['#welcome:example.test'], canonicalAlias: '#welcome:example.test',
      access: { joinRule: 'invite', historyVisibility: 'shared', guestAccess: 'forbidden' },
      upgradeVersion: '11',
    });
    await controller.setRoomAccess('!room:test', 'joinRule', 'knock');
    expect(client.sendStateEvent).toHaveBeenCalledWith('!room:test', 'm.room.join_rules', { join_rule: 'knock' }, '');
    await expect(controller.setRoomAccess('!room:test', 'joinRule', 'private')).rejects.toThrow('not supported');
  });

  it('keeps access controls available when optional alias and directory APIs are denied', async () => {
    const { controller, client } = fixture();
    client.getLocalAliases.mockRejectedValueOnce(new Error('M_FORBIDDEN'));
    client.getRoomDirectoryVisibility.mockRejectedValueOnce(new Error('M_FORBIDDEN'));
    await expect(controller.getRoomAdministration('!room:test')).resolves.toMatchObject({
      aliasesAvailable: false, directoryAvailable: false, access: { joinRule: 'invite' },
    });
  });

  it('refuses access changes without the state-event permission', async () => {
    const { controller, room, client } = fixture();
    vi.mocked(room.currentState.maySendStateEvent).mockReturnValue(false);
    await expect(controller.setRoomAccess('!room:test', 'joinRule', 'public')).rejects.toThrow('role');
    expect(client.sendStateEvent).not.toHaveBeenCalled();
  });

  it('validates aliases, directory, ACL and room upgrades', async () => {
    const { controller, client } = fixture();
    await expect(controller.createRoomAlias('!room:test', '#elsewhere:other.test')).rejects.toThrow('local alias');
    await controller.createRoomAlias('!room:test', '#new:example.test');
    await controller.setRoomCanonicalAlias('!room:test', '#welcome:example.test');
    await controller.setRoomDirectoryVisibility('!room:test', 'public');
    await expect(controller.setRoomServerAcl('!room:test', '*', 'example.test', true)).rejects.toThrow('allow your homeserver');
    await controller.setRoomServerAcl('!room:test', '*', 'blocked.test', false);
    expect(client.sendStateEvent).toHaveBeenCalledWith('!room:test', 'm.room.server_acl', { allow: ['*'], deny: ['blocked.test'], allow_ip_literals: false }, '');
    await expect(controller.upgradeRoom('!room:test')).resolves.toBe('!replacement:test');
  });

  it('preserves space-child metadata when toggling suggestions and removes its relation', async () => {
    const { controller, client, state } = fixture();
    await controller.setSpaceChildSuggested('!space:test', '!room:test', true);
    expect(state.get('m.space.child|!room:test')).toEqual({ via: ['example.test'], suggested: true, order: 'a' });
    await controller.removeSpaceChild('!space:test', '!room:test');
    expect(client.sendStateEvent).toHaveBeenLastCalledWith('!space:test', 'm.space.child', {}, '!room:test');
  });

  it('restores the child relation when removing a subspace parent link fails', async () => {
    const { controller, client, state } = fixture();
    state.set('m.space.child|!subspace:test', { via: ['example.test'], suggested: true });
    state.set('m.space.parent|!space:test', { via: ['example.test'] });
    client.sendStateEvent.mockImplementationOnce(async (_id: string, type: string, content: Record<string, unknown>, key: string) => {
      state.set(`${type}|${key}`, content); return { event_id: '$child' };
    }).mockRejectedValueOnce(new Error('M_FORBIDDEN'));
    await expect(controller.removeSpaceChild('!space:test', '!subspace:test')).rejects.toThrow('restored');
    expect(state.get('m.space.child|!subspace:test')).toEqual({ via: ['example.test'], suggested: true });
    expect(client.sendStateEvent).toHaveBeenCalledTimes(3);
  });
});
