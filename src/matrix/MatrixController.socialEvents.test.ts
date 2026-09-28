import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { MatrixController } from './MatrixController';
import { POLL_END, POLL_RESPONSE, POLL_START, POLL_TEXT } from './polls';

function fixture(encrypted = false) {
  const pollContent = { [POLL_TEXT]: 'Lunch?\n1. Soup\n2. Salad', [POLL_START]: {
    question: { [POLL_TEXT]: 'Lunch?' }, kind: 'org.matrix.msc3381.poll.disclosed', max_selections: 1,
    answers: [{ id: 'a', [POLL_TEXT]: 'Soup' }, { id: 'b', [POLL_TEXT]: 'Salad' }],
  } };
  const event = (id: string, type: string, sender: string, content: Record<string, unknown>, timestamp: number) => ({
    getId: () => id, getType: () => type, getSender: () => sender, getContent: () => content, getTs: () => timestamp,
    isRedacted: () => false, isDecryptionFailure: () => false,
  }) as unknown as MatrixEvent;
  const root = event('$poll', POLL_START, '@author:test', pollContent, 1);
  const relation = { 'm.relates_to': { rel_type: 'm.reference', event_id: '$poll' } };
  const vote = event('$vote', POLL_RESPONSE, '@self:test', { ...relation, [POLL_RESPONSE]: { answers: ['a'] } }, 2);
  const end = event('$end', POLL_END, '@author:test', { ...relation, [POLL_END]: {}, [POLL_TEXT]: 'Poll ended' }, 3);
  const room = {
    roomId: '!room:test', getMyMembership: () => 'join', hasEncryptionStateEvent: () => encrypted,
    hasPendingEvent: () => false, getEventForTxnId: () => undefined, findEventById: () => root, getThread: () => undefined,
    currentState: { maySendEvent: () => true, maySendRedactionForEvent: () => false },
  } as unknown as Room;
  const client = {
    getRoom: () => room, getCrypto: vi.fn().mockReturnValue({ isEncryptionEnabledInRoom: vi.fn().mockResolvedValue(false) }),
    getSafeUserId: () => '@self:test', makeTxnId: () => 'transaction',
    sendEvent: vi.fn().mockResolvedValue({ event_id: '$sent' }),
    decryptEventIfNeeded: vi.fn().mockResolvedValue(undefined),
    relations: vi.fn().mockResolvedValue({ originalEvent: root, events: [vote, end] }),
  };
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  const internal = controller as unknown as { client: MatrixClient; sdk: unknown; scheduleWorkspacePublish: () => void };
  internal.client = client as unknown as MatrixClient;
  internal.sdk = { EventType: { RoomMessage: 'm.room.message' }, MsgType: { Location: 'm.location' } };
  internal.scheduleWorkspacePublish = vi.fn();
  return { controller, client, room, root, vote };
}

describe('social event sends and reads', () => {
  it('sends a static location with a legacy fallback and thread relation', async () => {
    const { controller, client } = fixture();
    await controller.sendLocation('!room:test', 40.7128, -74.006, 'Meeting spot', '$root');
    expect(client.sendEvent).toHaveBeenCalledWith('!room:test', '$root', 'm.room.message', expect.objectContaining({
      msgtype: 'm.location', geo_uri: 'geo:40.7128,-74.006', 'm.location': { uri: 'geo:40.7128,-74.006', description: 'Meeting spot' },
      'm.relates_to': expect.objectContaining({ rel_type: 'm.thread', event_id: '$root' }),
    }), 'transaction');
  });

  it('does not send either new event when encryption is unavailable', async () => {
    const { controller, client } = fixture(true);
    client.getCrypto.mockReturnValue(undefined);
    await expect(controller.sendLocation('!room:test', 40, -74)).rejects.toThrow();
    await expect(controller.sendPoll('!room:test', 'Lunch?', ['Soup', 'Salad'], true)).rejects.toThrow();
    expect(client.sendEvent).not.toHaveBeenCalled();
  });

  it('sends a poll using the unstable Matrix type and reads validated relations', async () => {
    const { controller, client } = fixture();
    await controller.sendPoll('!room:test', 'Lunch?', ['Soup', 'Salad'], true);
    expect(client.sendEvent).toHaveBeenCalledWith('!room:test', POLL_START, expect.objectContaining({ [POLL_START]: expect.any(Object) }), 'transaction');
    await expect(controller.loadPoll('!room:test', '$poll')).resolves.toMatchObject({
      definition: { question: 'Lunch?' }, results: { counts: { a: 1, b: 0 }, closed: true, ownAnswers: ['a'] },
    });
  });

  it('ends an older poll even when its root is absent from the local timeline', async () => {
    const { controller, client, room, root, vote } = fixture();
    vi.spyOn(room, 'findEventById').mockReturnValue(undefined);
    vi.spyOn(room.currentState, 'maySendRedactionForEvent').mockReturnValue(true);
    client.relations.mockResolvedValue({ originalEvent: root, events: [vote] });
    await controller.endPoll('!room:test', '$poll');
    expect(client.sendEvent).toHaveBeenCalledWith('!room:test', POLL_END, expect.objectContaining({ [POLL_END]: {}, [POLL_TEXT]: expect.any(String) }), 'transaction');
  });
});
