import { describe, expect, it, vi } from 'vitest';
import { MatrixEvent, RoomState, type MatrixClient } from 'matrix-js-sdk';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import { MatrixController } from './MatrixController';
import type { WorkspaceSnapshotCache } from './buildWorkspaceSnapshot';

const roomId = '!actions:test';
const userId = '@self:test';
const message = (id = '$original', msgtype = 'm.text', sender = userId) => new MatrixEvent({
  event_id: id, room_id: roomId, sender, type: 'm.room.message', content: { msgtype, body: 'Synthetic original' },
});
function fixture() {
  const events = new Map<string, MatrixEvent>();
  const original = message(); events.set(original.getId()!, original);
  const state = new RoomState(roomId);
  state.setStateEvents([new MatrixEvent({ room_id: roomId, type: 'm.room.create', state_key: '', sender: '@creator:test', content: { room_version: '10', creator: '@creator:test' } })]);
  state.setStateEvents([new MatrixEvent({ room_id: roomId, type: 'm.room.member', state_key: userId, sender: userId, content: { membership: 'join' } })]);
  let revision = 0;
  const power = (events: Record<string, number>, level = 10, redact = 50) => state.setStateEvents([new MatrixEvent({
    room_id: roomId, type: 'm.room.power_levels', state_key: '', event_id: `$levels-${++revision}`, sender: userId,
    content: { users: { [userId]: level }, events, events_default: 0, state_default: 50, redact },
  })]);
  power({ 'm.room.pinned_events': 5 });
  const room = {
    roomId, currentState: state, getMyMembership: vi.fn().mockReturnValue('join'), hasPendingEvent: () => false,
    hasEncryptionStateEvent: vi.fn().mockReturnValue(false), findEventById: (id: string) => events.get(id), getEventForTxnId: () => undefined,
  };
  const client = {
    getRoom: vi.fn().mockReturnValue(room), getSafeUserId: () => userId, getCrypto: vi.fn().mockReturnValue({}),
    decryptEventIfNeeded: vi.fn<(event: MatrixEvent) => Promise<void>>().mockResolvedValue(undefined), fetchRoomEvent: vi.fn().mockResolvedValue(original.event),
    getEventMapper: () => (raw: MatrixEvent['event']) => new MatrixEvent(raw), makeTxnId: () => 'synthetic-transaction',
    sendEvent: vi.fn().mockResolvedValue({ event_id: '$sent' }), sendStateEvent: vi.fn().mockResolvedValue({ event_id: '$state' }), redactEvent: vi.fn().mockResolvedValue({ event_id: '$removed' }),
  };
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  const internal = controller as unknown as {
    client?: MatrixClient; sdk: unknown; snapshotCache: WorkspaceSnapshotCache; scheduleWorkspacePublish: () => void;
    uploadInlineEmotes: () => Promise<[]>;
  };
  internal.client = client as unknown as MatrixClient;
  internal.sdk = { EventType: { RoomMessage: 'm.room.message', RoomPinnedEvents: 'm.room.pinned_events', Reaction: 'm.reaction' }, RelationType: { Replace: 'm.replace', Annotation: 'm.annotation' } };
  internal.scheduleWorkspacePublish = vi.fn();
  internal.uploadInlineEmotes = vi.fn().mockResolvedValue([]);
  return { controller, internal, client, room, events, original, power };
}

describe('message action authorization and detached event ownership', () => {
  it.each(['m.text', 'm.notice', 'm.emote'])('edits owned cached %s without changing its message kind or constructing SDK threads', async (msgtype) => {
    const test = fixture();
    const original = message('$cached', msgtype);
    original.setThreadId('$root');
    test.internal.snapshotCache.threadHistory.set('$root', { roomId, rootId: '$root', rootStatus: 'found', events: [original], state: { mode: 'context', revision: 1, canLoadOlder: false, canLoadNewer: false } });
    await test.controller.editMessage(roomId, '$cached', 'Synthetic correction');
    expect(test.client.fetchRoomEvent).not.toHaveBeenCalled();
    expect(test.client.sendEvent).toHaveBeenCalledWith(roomId, '$root', 'm.room.message', expect.objectContaining({
      msgtype, 'm.new_content': expect.objectContaining({ msgtype, body: 'Synthetic correction' }),
      'm.relates_to': { rel_type: 'm.replace', event_id: '$cached' },
    }), 'synthetic-transaction');
  });

  it('resolves and decrypts a restored edit target before validating ownership and sending', async () => {
    const test = fixture(); test.events.clear();
    test.client.fetchRoomEvent.mockResolvedValueOnce({ ...test.original.event, type: 'm.room.encrypted', content: {} });
    test.client.decryptEventIfNeeded.mockImplementation(async (event) => {
      vi.spyOn(event, 'getType').mockReturnValue('m.room.message');
      vi.spyOn(event, 'getOriginalContent').mockReturnValue({ msgtype: 'm.notice', body: 'Synthetic decrypted original' });
    });
    await test.controller.editMessage(roomId, '$original', 'Correction');
    expect(test.client.fetchRoomEvent).toHaveBeenCalledExactlyOnceWith(roomId, '$original');
    expect(test.client.sendEvent.mock.calls[0][2]).toMatchObject({ msgtype: 'm.notice' });
  });

  it.each(['sender', 'media', 'pending', 'redacted', 'wire-permission', 'crypto'] as const)('refuses an edit with invalid %s before uploading inline assets', async (condition) => {
    const test = fixture();
    if (condition === 'sender') test.events.set('$original', message('$original', 'm.text', '@peer:test'));
    if (condition === 'media') test.events.set('$original', message('$original', 'm.image'));
    if (condition === 'pending') Object.assign(test.original, { status: 'sent' });
    if (condition === 'redacted') vi.spyOn(test.original, 'isRedacted').mockReturnValue(true);
    if (condition === 'wire-permission') { test.room.hasEncryptionStateEvent.mockReturnValue(true); test.power({ 'm.room.encrypted': 90 }); }
    if (condition === 'crypto') { test.room.hasEncryptionStateEvent.mockReturnValue(true); test.client.getCrypto.mockReturnValue(undefined); }
    await expect(test.controller.editMessage(roomId, '$original', 'Correction')).rejects.toThrow();
    expect(test.internal.uploadInlineEmotes).not.toHaveBeenCalled(); expect(test.client.sendEvent).not.toHaveBeenCalled();
  });

  it.each(['permission', 'membership', 'session'] as const)('rechecks %s after an inline upload completes', async (change) => {
    const test = fixture();
    let finish!: (value: []) => void;
    test.internal.uploadInlineEmotes = vi.fn(() => new Promise<[]>((resolve) => { finish = resolve; }));
    const editing = test.controller.editMessage(roomId, '$original', 'Correction');
    await vi.waitFor(() => expect(test.internal.uploadInlineEmotes).toHaveBeenCalled());
    if (change === 'permission') test.power({ 'm.room.message': 90 });
    if (change === 'membership') test.room.getMyMembership.mockReturnValue('leave');
    if (change === 'session') test.internal.client = undefined;
    finish([]);
    await expect(editing).rejects.toThrow(); expect(test.client.sendEvent).not.toHaveBeenCalled();
  });

  it('uses actual pin and redaction state permissions and preserves existing pins', async () => {
    const test = fixture();
    test.room.currentState.setStateEvents([new MatrixEvent({ room_id: roomId, type: 'm.room.pinned_events', state_key: '', content: { pinned: ['$older'] } })]);
    await test.controller.togglePinnedMessage(roomId, '$original', true);
    expect(test.client.sendStateEvent).toHaveBeenCalledExactlyOnceWith(roomId, 'm.room.pinned_events', { pinned: ['$older', '$original'] }, '');
    test.power({ 'm.room.pinned_events': 100, 'm.room.redaction': 100 }, 90);
    await expect(test.controller.togglePinnedMessage(roomId, '$original', false)).rejects.toThrow('permission');
    await expect(test.controller.redactMessage(roomId, '$original')).rejects.toThrow('permission');
    expect(test.client.redactEvent).not.toHaveBeenCalled();
    test.power({}, 90);
    test.events.set('$peer', message('$peer', 'm.text', '@peer:test'));
    await test.controller.redactMessage(roomId, '$peer');
    expect(test.client.redactEvent).toHaveBeenCalledExactlyOnceWith(roomId, '$peer', undefined, { reason: 'Removed in Aimtrix' });
  });

  it('validates reaction permission and exact ownership/target when removing a reaction', async () => {
    const test = fixture(); test.power({ 'm.reaction': 90 });
    await expect(test.controller.toggleReaction(roomId, '$original', '✨')).rejects.toThrow('permission');
    const reaction = new MatrixEvent({ event_id: '$reaction', room_id: roomId, sender: userId, type: 'm.reaction', content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$original', key: '✨' } } });
    test.events.set('$reaction', reaction);
    await test.controller.toggleReaction(roomId, '$original', '✨', '$reaction');
    expect(test.client.redactEvent).toHaveBeenCalledExactlyOnceWith(roomId, '$reaction');
    await expect(test.controller.toggleReaction(roomId, '$original', 'wrong', '$reaction')).rejects.toThrow('permission');
    test.power({});
    await test.controller.toggleReaction(roomId, '$original', '✨');
    expect(test.client.sendEvent).toHaveBeenCalledExactlyOnceWith(roomId, 'm.reaction', { 'm.relates_to': { rel_type: 'm.annotation', event_id: '$original', key: '✨' } });
  });

  it('uses encrypted wire permissions for edits and plaintext reaction permission in encrypted rooms', async () => {
    const test = fixture();
    test.room.hasEncryptionStateEvent.mockReturnValue(true);
    test.power({ 'm.room.message': 100, 'm.room.encrypted': 0, 'm.reaction': 0 });
    await test.controller.editMessage(roomId, '$original', 'Encrypted correction');
    expect(test.client.sendEvent).toHaveBeenCalledTimes(1);
    test.power({ 'm.room.encrypted': 100, 'm.reaction': 0 });
    test.client.getCrypto.mockReturnValue(undefined);
    await test.controller.toggleReaction(roomId, '$original', '✨');
    expect(test.client.sendEvent).toHaveBeenCalledTimes(2);
  });

  it('honors crypto backend encryption memory when room state has not caught up', async () => {
    const test = fixture();
    test.client.getCrypto.mockReturnValue({ isEncryptionEnabledInRoom: vi.fn().mockResolvedValue(true) });
    test.power({ 'm.room.encrypted': 90 });
    await expect(test.controller.editMessage(roomId, '$original', 'Correction')).rejects.toThrow('permission');
    expect(test.client.sendEvent).not.toHaveBeenCalled();
    expect(test.internal.uploadInlineEmotes).not.toHaveBeenCalled();
  });

  it('rejects foreign fetched events and stale sessions without writes or private error text', async () => {
    const test = fixture(); test.events.clear();
    test.client.fetchRoomEvent.mockResolvedValueOnce({ ...test.original.event, room_id: '!other:test' });
    await expect(test.controller.redactMessage(roomId, '$original')).rejects.toThrow('could not be loaded');
    test.client.fetchRoomEvent.mockImplementationOnce(async () => { test.internal.client = undefined; return test.original.event; });
    await expect(test.controller.togglePinnedMessage(roomId, '$original', true)).rejects.toThrow();
    expect(test.client.redactEvent).not.toHaveBeenCalled(); expect(test.client.sendStateEvent).not.toHaveBeenCalled();
  });

  it.each(['pin', 'redact', 'react'] as const)('blocks %s when membership changes during target decryption', async (action) => {
    const test = fixture();
    test.client.decryptEventIfNeeded.mockImplementation(async () => { test.room.getMyMembership.mockReturnValue('leave'); });
    const result = action === 'pin' ? test.controller.togglePinnedMessage(roomId, '$original', true)
      : action === 'redact' ? test.controller.redactMessage(roomId, '$original')
        : test.controller.toggleReaction(roomId, '$original', '✨');
    await expect(result).rejects.toThrow('session or conversation changed');
    expect(test.client.sendStateEvent).not.toHaveBeenCalled();
    expect(test.client.redactEvent).not.toHaveBeenCalled();
    expect(test.client.sendEvent).not.toHaveBeenCalled();
  });
});
