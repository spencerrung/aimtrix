export const ROOM_BACKGROUND_EVENT = 'dev.alucard.aimtrix.room_background.v1';
export const DIRECT_BACKGROUNDS_EVENT = 'dev.alucard.aimtrix.direct_backgrounds.v1';
export const DECORATOR_POWER_LEVEL = 25;

export const roomBackgroundPresetNames = [
  'none',
  'aero-sky',
  'blue-lagoon',
  'green-meadow',
  'citrus-grove',
  'soft-twilight',
  'graphite-grid',
] as const;

export type RoomBackgroundPreset = (typeof roomBackgroundPresetNames)[number];
export type RoomBackgroundPermission = 'admins' | 'decorators' | 'members';

export interface RoomBackground {
  preset: RoomBackgroundPreset;
  mxcUrl?: string;
  blockSpaceInheritance?: boolean;
}

export interface RoomBackgroundPolicy {
  mode: RoomBackgroundPermission;
  requiredPowerLevel: number;
  canChange: boolean;
  canManage: boolean;
}

export const defaultRoomBackground: RoomBackground = { preset: 'none' };

function isPreset(value: unknown): value is RoomBackgroundPreset {
  return typeof value === 'string' && roomBackgroundPresetNames.includes(value as RoomBackgroundPreset);
}

export function parseRoomBackground(value: unknown): RoomBackground {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...defaultRoomBackground };
  const candidate = value as { preset?: unknown; mxc_url?: unknown; mxcUrl?: unknown; block_space_inheritance?: unknown };
  const mxc = candidate.mxc_url ?? candidate.mxcUrl;
  const mxcUrl = typeof mxc === 'string' && /^mxc:\/\/[^/]+\/.+/.test(mxc) ? mxc : undefined;
  return {
    preset: mxcUrl ? 'none' : isPreset(candidate.preset) ? candidate.preset : 'none',
    mxcUrl,
    ...(candidate.block_space_inheritance === true ? { blockSpaceInheritance: true } : {}),
  };
}

export function serializeRoomBackground(background: RoomBackground): Record<string, string | boolean> {
  const parsed = parseRoomBackground({
    preset: background.preset,
    mxcUrl: background.mxcUrl,
    block_space_inheritance: background.blockSpaceInheritance,
  });
  return parsed.mxcUrl
    ? { preset: 'none', mxc_url: parsed.mxcUrl }
    : {
        preset: parsed.preset,
        ...(parsed.blockSpaceInheritance ? { block_space_inheritance: true } : {}),
      };
}

export function backgroundPermissionForThreshold(threshold: number): RoomBackgroundPermission {
  if (threshold <= 0) return 'members';
  if (threshold <= DECORATOR_POWER_LEVEL) return 'decorators';
  return 'admins';
}

export function thresholdForBackgroundPermission(permission: RoomBackgroundPermission): number {
  if (permission === 'members') return 0;
  if (permission === 'decorators') return DECORATOR_POWER_LEVEL;
  return 50;
}

export function parseDirectBackgrounds(value: unknown): Record<string, RoomBackground> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const rooms = (value as { rooms?: unknown }).rooms;
  if (!rooms || typeof rooms !== 'object' || Array.isArray(rooms)) return {};
  return Object.fromEntries(
    Object.entries(rooms as Record<string, unknown>)
      .filter(([roomId]) => roomId.startsWith('!') && roomId.length <= 255)
      .slice(0, 5000)
      .map(([roomId, background]) => [roomId, parseRoomBackground(background)])
      .filter(([, background]) => (background as RoomBackground).preset !== 'none' || Boolean((background as RoomBackground).mxcUrl)),
  );
}

export function serializeDirectBackgrounds(backgrounds: Record<string, RoomBackground>): {
  rooms: Record<string, Record<string, string | boolean>>;
} {
  return {
    rooms: Object.fromEntries(
      Object.entries(backgrounds)
        .filter(([roomId]) => roomId.startsWith('!') && roomId.length <= 255)
        .slice(0, 5000)
        .flatMap(([roomId, background]) => {
          const parsed = parseRoomBackground(background);
          return parsed.preset === 'none' && !parsed.mxcUrl
            ? []
            : [[roomId, serializeRoomBackground(parsed)]];
        }),
    ),
  };
}
