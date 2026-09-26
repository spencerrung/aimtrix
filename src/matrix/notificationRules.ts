import type { MatrixClient } from 'matrix-js-sdk';
import { ConditionKind, TweakName, PushRuleActionName, PushRuleKind, type IPushRule, type IPushRules } from 'matrix-js-sdk/lib/@types/PushRules.js';

export type RoomNotificationMode = 'default' | 'all' | 'mentions' | 'nothing' | 'custom';
export const ROOM_SILENCE_PREFIX = 'dev.alucard.aimtrix.silence.';
export const THREAD_SILENCE_PREFIX = 'dev.alucard.aimtrix.thread_silence.';
export const KEYWORD_PREFIX = 'dev.alucard.aimtrix.keyword.';
const suppresses = (rule: IPushRule) => rule.enabled !== false && rule.actions.every((action) => action === PushRuleActionName.DontNotify);
const roomCondition = (rule: IPushRule, roomId: string) => rule.conditions?.some((condition) => condition.key === 'room_id' && ((condition.kind === ConditionKind.EventMatch && !/[?*]/.test(roomId) && condition.pattern === roomId) || (condition.kind === ConditionKind.EventPropertyIs && condition.value === roomId)));
export function roomNotificationMode(rules: IPushRules | undefined, roomId: string): RoomNotificationMode {
  const overrides = rules?.global?.override?.filter((rule) => rule.enabled !== false && roomCondition(rule, roomId)) ?? [];
  if (overrides.some((rule) => rule.conditions?.length === 1 && suppresses(rule))) return 'nothing';
  if (overrides.some((rule) => !rule.rule_id.startsWith(THREAD_SILENCE_PREFIX))) return 'custom';
  const rule = rules?.global?.room?.find((rule) => rule.rule_id === roomId && rule.enabled !== false);
  if (!rule) return 'default';
  if (rule.actions.includes(PushRuleActionName.Notify)) return 'all';
  if (suppresses(rule)) return 'mentions';
  return 'custom';
}
export interface NotificationRulesSnapshot {
  rooms: Array<{ id: string; name: string; mode: RoomNotificationMode }>;
  keywords: Array<{ id: string; pattern: string; enabled: boolean; editable: boolean }>;
  doNotDisturb: boolean;
  threadRulesSupported: boolean;
}

/** Serializes writes for one client lifecycle; sync remains the shared authority. */
export class NotificationRules {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly client: () => MatrixClient | undefined, private readonly changed: () => void) {}
  private owner() {
    const client = this.client();
    if (!client) throw new Error('Connect to Matrix to change notification rules.');
    const check = () => { if (this.client() !== client) throw new Error('The Matrix account changed. Open notification settings again.'); };
    return { client, check };
  }
  public async load(): Promise<NotificationRulesSnapshot> {
    const { client, check } = this.owner();
    const rules = await client.getPushRules(); check();
    const versions = await client.getVersions(); check();
    this.changed();
    return {
      rooms: client.getRooms().filter((room) => room.getMyMembership() === 'join' && room.getType() !== 'm.space')
        .map((room) => ({ id: room.roomId, name: room.name, mode: roomNotificationMode(rules, room.roomId) })).sort((a, b) => a.name.localeCompare(b.name)),
      keywords: (rules.global.content ?? []).filter((rule) => !rule.default).map((rule) => ({ id: rule.rule_id, pattern: rule.pattern ?? '', enabled: rule.enabled !== false, editable: rule.rule_id.startsWith(KEYWORD_PREFIX) })),
      doNotDisturb: rules.global.override?.some((rule) => rule.rule_id === '.m.rule.master' && rule.enabled) ?? false,
      threadRulesSupported: versions.versions.some((version) => /^v1\.(\d+)$/.test(version) && Number(version.slice(3)) >= 10),
    };
  }
  private write(action: (client: MatrixClient, check: () => void) => Promise<void>): Promise<void> {
    const owner = this.owner();
    const result = this.queue.catch(() => undefined).then(async () => {
      owner.check();
      try {
        await owner.client.getPushRules(); owner.check();
        await action(owner.client, owner.check); owner.check();
        await owner.client.getPushRules(); owner.check(); this.changed();
      } catch {
        if (this.client() === owner.client) {
          try { await owner.client.getPushRules(); owner.check(); this.changed(); }
          catch { /* Preserve the safe partial-write error. */ }
        }
        throw new Error('Notification rules could not be saved completely. Refresh to check the homeserver, then retry.');
      }
    });
    this.queue = result;
    return result;
  }
  public setRoom(roomId: string, mode: Exclude<RoomNotificationMode, 'custom'>): Promise<void> {
    return this.write(async (client, check) => {
      if (client.getRoom(roomId)?.getMyMembership() !== 'join') throw new Error('Room unavailable');
      const rules = client.pushRules;
      if (roomNotificationMode(rules, roomId) === 'custom') throw new Error('Custom rules require another client');
      // Only canonical unconditional room suppression is managed here. Preserve
      // keyword, sender, conditional and thread rules created by other clients.
      const overrides = rules?.global.override?.filter((rule) => roomCondition(rule, roomId) && rule.conditions?.length === 1 && suppresses(rule)) ?? [];
      if (!['default', 'all', 'mentions', 'nothing'].includes(mode)) throw new Error('Unknown mode');
      if (mode === 'nothing') {
        const versions = await client.getVersions(); check();
        const exact = versions.versions.some((version) => /^v1\.(\d+)$/.test(version) && Number(version.slice(3)) >= 7);
        if (!exact && /[?*]/.test(roomId)) throw new Error('Exact room rules unavailable');
        await client.addPushRule('global', PushRuleKind.Override, ROOM_SILENCE_PREFIX + roomId, {
          conditions: [exact ? { kind: ConditionKind.EventPropertyIs, key: 'room_id', value: roomId } : { kind: ConditionKind.EventMatch, key: 'room_id', pattern: roomId }], actions: [],
        }); check();
        await client.setPushRuleEnabled('global', PushRuleKind.Override, ROOM_SILENCE_PREFIX + roomId, true); check();
      }
      for (const rule of overrides) {
        if (mode === 'nothing' && rule.rule_id === ROOM_SILENCE_PREFIX + roomId) continue;
        await client.deletePushRule('global', PushRuleKind.Override, rule.rule_id); check();
      }
      const old = rules?.global.room?.find((rule) => rule.rule_id === roomId);
      if (mode === 'default' || mode === 'nothing') {
        if (old) { await client.deletePushRule('global', PushRuleKind.RoomSpecific, roomId); check(); }
      } else {
        await client.addPushRule('global', PushRuleKind.RoomSpecific, roomId, { actions: mode === 'all' ? [PushRuleActionName.Notify] : [] }); check();
        await client.setPushRuleEnabled('global', PushRuleKind.RoomSpecific, roomId, true); check();
      }
    });
  }
  public setDoNotDisturb(enabled: boolean): Promise<void> {
    return this.write(async (client, check) => { await client.setPushRuleEnabled('global', PushRuleKind.Override, '.m.rule.master', enabled); check(); });
  }
  public addKeyword(pattern: string): Promise<void> {
    const value = pattern.trim();
    if (!value || value.length > 120 || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return Promise.reject(new Error('Enter a keyword pattern between 1 and 120 characters.'));
    return this.write(async (client, check) => {
      if ((client.pushRules?.global.content?.length ?? 0) >= 100) throw new Error('Keyword limit');
      await client.addPushRule('global', PushRuleKind.ContentSpecific, KEYWORD_PREFIX + crypto.randomUUID(), {
        pattern: value, actions: [PushRuleActionName.Notify, { set_tweak: TweakName.Highlight, value: true }],
      }); check();
    });
  }
  public removeKeyword(id: string): Promise<void> {
    if (!id.startsWith(KEYWORD_PREFIX)) return Promise.reject(new Error('Manage this rule in the client that created it.'));
    return this.write(async (client, check) => { await client.deletePushRule('global', PushRuleKind.ContentSpecific, id); check(); });
  }
  public setThreadMuted(roomId: string, rootId: string, muted: boolean): Promise<void> {
    return this.write(async (client, check) => {
      if (client.getRoom(roomId)?.getMyMembership() !== 'join' || !/^\$\S{1,1023}$/.test(rootId)) throw new Error('Thread unavailable');
      const versions = await client.getVersions(); check();
      if (!versions.versions.some((version) => /^v1\.(\d+)$/.test(version) && Number(version.slice(3)) >= 10)) throw new Error('Thread rules unsupported');
      const id = THREAD_SILENCE_PREFIX + roomId + '/' + rootId;
      if (muted) { await client.addPushRule('global', PushRuleKind.Override, id, { actions: [], conditions: [
        { kind: ConditionKind.EventPropertyIs, key: 'room_id', value: roomId },
        { kind: ConditionKind.EventPropertyIs, key: 'content.m\\.relates_to.rel_type', value: 'm.thread' },
        { kind: ConditionKind.EventPropertyIs, key: 'content.m\\.relates_to.event_id', value: rootId },
      ] }); check();
        await client.setPushRuleEnabled('global', PushRuleKind.Override, id, true);
      } else if (client.pushRules?.global.override?.some((rule) => rule.rule_id === id)) await client.deletePushRule('global', PushRuleKind.Override, id);
      check();
    });
  }
}
