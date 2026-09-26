import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { ConditionKind, PushRuleActionName, PushRuleKind, type IPushRules } from 'matrix-js-sdk/lib/@types/PushRules.js';
import { NotificationRules, ROOM_SILENCE_PREFIX, THREAD_SILENCE_PREFIX, roomNotificationMode, roomSilenceRuleId, threadSilenceRuleId } from './notificationRules';

function fixture() {
  const rules: IPushRules = { global: { override: [], room: [], content: [] } };
  const client = { pushRules: rules, getPushRules: vi.fn(async () => rules), getVersions: vi.fn(async () => ({ versions: ['v1.10'] })),
    getRoom: () => ({ getMyMembership: () => 'join' }), getRooms: () => [],
    addPushRule: vi.fn().mockResolvedValue({}), deletePushRule: vi.fn().mockResolvedValue({}), setPushRuleEnabled: vi.fn().mockResolvedValue({}),
  };
  let current: MatrixClient | undefined = client as unknown as MatrixClient;
  const changed = vi.fn();
  return { client, rules, changed, store: new NotificationRules(() => current, changed), disconnect: () => { current = undefined; } };
}
describe('notification rules', () => {
  it('distinguishes mentions, unconditional mute, and custom conditions', () => {
    const { rules } = fixture();
    rules.global.room!.push({ rule_id: '!room:test', enabled: true, default: false, actions: [] });
    expect(roomNotificationMode(rules, '!room:test')).toBe('mentions');
    rules.global.override!.push({ rule_id: 'mute', enabled: true, default: false, actions: [], conditions: [{ kind: ConditionKind.EventPropertyIs, key: 'room_id', value: '!room:test' }] });
    expect(roomNotificationMode(rules, '!room:test')).toBe('nothing');
    rules.global.override![0].conditions!.push({ kind: ConditionKind.EventMatch, key: 'sender', pattern: '@someone:test' });
    expect(roomNotificationMode(rules, '!room:test')).toBe('custom');
  });
  it('uses slash-free, collision-free IDs for opaque room and thread identifiers', async () => {
    const { store, client } = fixture();
    const roomId = '!room/part\\more:test', rootId = '$root/part\\more';
    expect(roomSilenceRuleId(roomId)).toBe(ROOM_SILENCE_PREFIX + '!room%2Fpart%5Cmore%3Atest');
    expect(threadSilenceRuleId(roomId, rootId)).toBe(THREAD_SILENCE_PREFIX + '!room%2Fpart%5Cmore%3Atest:%24root%2Fpart%5Cmore');
    expect(threadSilenceRuleId('!a:b', '$c')).not.toBe(threadSilenceRuleId('!a', 'b:$c'));
    await store.setRoom(roomId, 'nothing');
    await store.setThreadMuted(roomId, rootId, true);
    for (const call of client.addPushRule.mock.calls) { expect(call[2]).not.toContain('/'); expect(call[2]).not.toContain('\\'); }
    expect(client.addPushRule).toHaveBeenLastCalledWith('global', 'override', threadSilenceRuleId(roomId, rootId), expect.objectContaining({ conditions: expect.arrayContaining([
      { kind: 'event_property_is', key: 'room_id', value: roomId },
      { kind: 'event_property_is', key: 'content.m\\.relates_to.event_id', value: rootId },
    ]) }));
  });

  it('writes an exact override mute even for wildcard-shaped opaque room identifiers', async () => {
    const { store, client } = fixture();
    await store.setRoom('!room*:test', 'nothing');
    expect(client.addPushRule).toHaveBeenCalledWith('global', PushRuleKind.Override, roomSilenceRuleId('!room*:test'), { actions: [], conditions: [{ kind: ConditionKind.EventPropertyIs, key: 'room_id', value: '!room*:test' }] });
    expect(client.getPushRules).toHaveBeenCalledTimes(2);
  });
  it('re-enables a previously disabled managed room and thread rule', async () => {
    const { store, client, rules } = fixture();
    rules.global.override!.push({ rule_id: roomSilenceRuleId('!room:test'), enabled: false, default: false, actions: [], conditions: [{ kind: ConditionKind.EventPropertyIs, key: 'room_id', value: '!room:test' }] });
    await store.setRoom('!room:test', 'nothing');
    expect(client.setPushRuleEnabled).toHaveBeenCalledWith('global', 'override', roomSilenceRuleId('!room:test'), true);
    await store.setThreadMuted('!room:test', '$root', true);
    expect(client.setPushRuleEnabled).toHaveBeenCalledWith('global', 'override', threadSilenceRuleId('!room:test', '$root'), true);
  });
  it('does not rewrite unfamiliar suppression actions', async () => {
    const { store, client, rules } = fixture();
    rules.global.room!.push({ rule_id: '!room:test', enabled: true, default: false, actions: [PushRuleActionName.Coalesce] });
    expect(roomNotificationMode(rules, '!room:test')).toBe('custom');
    await expect(store.setRoom('!room:test', 'mentions')).rejects.toThrow();
    expect(client.addPushRule).not.toHaveBeenCalled();
  });
  it('preserves custom rules instead of overwriting their meaning', async () => {
    const { store, rules, client } = fixture();
    rules.global.override!.push({ rule_id: 'custom', enabled: true, default: false, actions: [PushRuleActionName.Notify], conditions: [{ kind: ConditionKind.EventMatch, key: 'room_id', pattern: '!room:test' }] });
    await expect(store.setRoom('!room:test', 'all')).rejects.toThrow('could not be saved');
    expect(client.addPushRule).not.toHaveBeenCalled();
  });
  it('refreshes authoritative rules after a partially failed write', async () => {
    const { store, client, changed } = fixture();
    client.setPushRuleEnabled.mockRejectedValue(new Error('private server response'));
    await expect(store.setRoom('!room:test', 'mentions')).rejects.toThrow('could not be saved');
    expect(client.addPushRule).toHaveBeenCalledWith('global', 'room', '!room:test', { actions: [] });
    expect(client.getPushRules).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledOnce();
  });
  it('never writes after an account changes during the initial refresh', async () => {
    const { store, client, disconnect } = fixture();
    client.getPushRules.mockImplementationOnce(async () => { disconnect(); return client.pushRules; });
    await expect(store.setDoNotDisturb(true)).rejects.toThrow();
    expect(client.setPushRuleEnabled).not.toHaveBeenCalled();
  });
  it('uses exact thread relation conditions and rejects unsupported servers', async () => {
    const { store, client } = fixture();
    await store.setThreadMuted('!room:test', '$root', true);
    expect(client.addPushRule).toHaveBeenCalledWith('global', 'override', expect.any(String), expect.objectContaining({ conditions: expect.arrayContaining([{ kind: 'event_property_is', key: 'content.m\\.relates_to.event_id', value: '$root' }]) }));
    client.getVersions.mockResolvedValue({ versions: ['v1.6'] });
    await expect(store.setThreadMuted('!room:test', '$root', true)).rejects.toThrow();
  });
});
