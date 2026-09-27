import { describe, expect, it, vi } from 'vitest';
import { MatrixEvent, type MatrixClient } from 'matrix-js-sdk';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { MatrixController } from './MatrixController';
import { SAVED_REFERENCES_EVENT } from './savedReferences';

function fixture() {
  const roomId = '!room:test';
  const event = new MatrixEvent({ event_id: '$message', room_id: roomId, sender: '@friend:test', type: 'm.room.message', content: { msgtype: 'm.text', body: 'Sensitive synthetic message' } });
  const room = { roomId, getMyMembership: vi.fn().mockReturnValue('join'), hasPendingEvent: vi.fn().mockReturnValue(false), findEventById: vi.fn().mockReturnValue(event) };
  const setAccountData = vi.fn().mockResolvedValue(undefined);
  const search = vi.fn().mockResolvedValue({ search_categories: { room_events: { results: [], count: 0 } } });
  const client = {
    getRoom: vi.fn().mockReturnValue(room), getRooms: vi.fn().mockReturnValue([room]), isRoomEncrypted: vi.fn().mockReturnValue(false),
    getAccountData: vi.fn().mockReturnValue(undefined), setAccountData, search,
    decryptEventIfNeeded: vi.fn().mockResolvedValue(undefined),
  };
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  Object.assign(controller, { client: client as unknown as MatrixClient, snapshot: { status: 'ready' } });
  return { controller, client, room, setAccountData, search };
}

describe('retrieval controller operations', () => {
  it('saves opaque references, then lets users remove them after room access is lost', async () => {
    const test = fixture();
    expect(await test.controller.toggleSavedReference('!room:test', '$message', true)).toHaveLength(1);
    expect(test.setAccountData).toHaveBeenCalledWith(SAVED_REFERENCES_EVENT, { items: [{ roomId: '!room:test', eventId: '$message', savedAt: expect.any(Number) }] });
    expect(JSON.stringify(test.setAccountData.mock.calls)).not.toContain('Sensitive synthetic message');
    test.room.getMyMembership.mockReturnValue('leave');
    expect(await test.controller.toggleSavedReference('!room:test', '$message', false)).toEqual([]);
  });

  it('keeps a concurrent account-data echo as the authoritative saved list', async () => {
    const test = fixture();
    let finishWrite: (() => void) | undefined;
    test.setAccountData.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const saving = test.controller.toggleSavedReference('!room:test', '$message', true);
    await vi.waitFor(() => expect(test.setAccountData).toHaveBeenCalledTimes(1));
    const other = { roomId: '!elsewhere:test', eventId: '$other', savedAt: 100 };
    const echo = new MatrixEvent({ type: SAVED_REFERENCES_EVENT, content: { items: [other] } });
    (test.controller as unknown as { handleAccountData: (event: MatrixEvent) => void }).handleAccountData(echo);
    finishWrite?.();
    expect(await saving).toEqual([other]);
    expect(test.controller.getSavedReferences()).toEqual([other]);
  });

  it('excludes encrypted rooms from server search and refuses a stale session', async () => {
    const test = fixture();
    test.client.isRoomEncrypted.mockReturnValue(true);
    expect(await test.controller.searchHistory({ term: 'hello' })).toMatchObject({ searchedRoomIds: [], hits: [] });
    expect(test.search).not.toHaveBeenCalled();
    Object.assign(test.controller, { client: undefined });
    await expect(test.controller.searchHistory({ term: 'hello' })).rejects.toThrow('Sign in');
  });
});
