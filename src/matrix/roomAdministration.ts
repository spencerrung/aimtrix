export type RoomAccessSetting = 'joinRule' | 'historyVisibility' | 'guestAccess';

export interface RoomAccessSummary {
  joinRule: string;
  historyVisibility: string;
  guestAccess: string;
  canChangeJoinRule: boolean;
  canChangeHistoryVisibility: boolean;
  canChangeGuestAccess: boolean;
  canChangeCanonicalAlias: boolean;
  canChangeServerAcl: boolean;
  canUpgrade: boolean;
}

export interface RoomAdministrationState {
  localServerName: string;
  access: { joinRule: string; historyVisibility: string; guestAccess: string };
  canonicalAlias?: string;
  localAliases: string[];
  aliasesAvailable: boolean;
  directoryVisibility: 'public' | 'private';
  directoryAvailable: boolean;
  serverAcl: { allow: string[]; deny: string[]; allowIpLiterals: boolean };
  roomVersion: string;
  upgradeVersion?: string;
}

export interface RoomAdministrationActions {
  load: (roomId: string) => Promise<RoomAdministrationState>;
  setAccess: (roomId: string, setting: RoomAccessSetting, value: string) => Promise<void>;
  createAlias: (roomId: string, alias: string) => Promise<void>;
  deleteAlias: (roomId: string, alias: string) => Promise<void>;
  setCanonicalAlias: (roomId: string, alias: string) => Promise<void>;
  setDirectoryVisibility: (roomId: string, visibility: 'public' | 'private') => Promise<void>;
  setServerAcl: (roomId: string, allow: string, deny: string, allowIpLiterals: boolean) => Promise<void>;
  upgrade: (roomId: string) => Promise<string>;
}

export const roomAccessEvents: Record<RoomAccessSetting, { type: string; field: string; values: readonly string[] }> = {
  joinRule: { type: 'm.room.join_rules', field: 'join_rule', values: ['invite', 'public', 'knock'] },
  historyVisibility: { type: 'm.room.history_visibility', field: 'history_visibility', values: ['joined', 'invited', 'shared', 'world_readable'] },
  guestAccess: { type: 'm.room.guest_access', field: 'guest_access', values: ['forbidden', 'can_join'] },
};

export function normalizeServerList(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))];
}

export function validLocalAlias(alias: string, serverName: string): boolean {
  const suffix = `:${serverName}`;
  return Boolean(serverName) && !/\s/.test(serverName) && alias.startsWith('#') && alias.endsWith(suffix) &&
    /^[^\s:#]+$/.test(alias.slice(1, -suffix.length));
}

export function aclAllowsServer(serverName: string, allow: string[], deny: string[]): boolean {
  const patternMatches = (pattern: string) => {
    const expression = `^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.')}$`;
    return new RegExp(expression, 'i').test(serverName);
  };
  return allow.some(patternMatches) && !deny.some(patternMatches);
}
