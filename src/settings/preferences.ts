export const accentNames = ['blue', 'grape', 'rose', 'tangerine', 'lime'] as const;
export const densityNames = ['compact', 'comfortable', 'roomy'] as const;
export const messageScaleNames = ['small', 'medium', 'large'] as const;
export const motionNames = ['system', 'reduced', 'full'] as const;

export type AccentName = (typeof accentNames)[number];
export type DensityName = (typeof densityNames)[number];
export type MessageScaleName = (typeof messageScaleNames)[number];
export type MotionName = (typeof motionNames)[number];

export interface UserPreferences {
  accent: AccentName;
  density: DensityName;
  messageScale: MessageScaleName;
  motion: MotionName;
  detailsOpenByDefault: boolean;
  desktopNotifications: boolean;
  notificationSounds: boolean;
  soundVolume: number;
  sendReadReceipts: boolean;
  sendTypingNotifications: boolean;
  autoplayMedia: boolean;
  dataSaver: boolean;
  microphoneId: string;
  cameraId: string;
  speakerId: string;
}

export const defaultUserPreferences: UserPreferences = {
  accent: 'blue',
  density: 'comfortable',
  messageScale: 'medium',
  motion: 'system',
  detailsOpenByDefault: true,
  desktopNotifications: false,
  notificationSounds: true,
  soundVolume: 0.55,
  sendReadReceipts: true,
  sendTypingNotifications: true,
  autoplayMedia: true,
  dataSaver: false,
  microphoneId: '',
  cameraId: '',
  speakerId: '',
};

const PREFERENCES_KEY = 'aimtrix.preferences.v1';

function includes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

export function parseUserPreferences(value: unknown): UserPreferences {
  if (typeof value !== 'object' || value === null) return { ...defaultUserPreferences };
  const candidate = value as Partial<UserPreferences>;
  return {
    accent: includes(accentNames, candidate.accent) ? candidate.accent : defaultUserPreferences.accent,
    density: includes(densityNames, candidate.density)
      ? candidate.density
      : defaultUserPreferences.density,
    messageScale: includes(messageScaleNames, candidate.messageScale)
      ? candidate.messageScale
      : defaultUserPreferences.messageScale,
    motion: includes(motionNames, candidate.motion) ? candidate.motion : defaultUserPreferences.motion,
    detailsOpenByDefault:
      typeof candidate.detailsOpenByDefault === 'boolean'
        ? candidate.detailsOpenByDefault
        : defaultUserPreferences.detailsOpenByDefault,
    desktopNotifications:
      typeof candidate.desktopNotifications === 'boolean'
        ? candidate.desktopNotifications
        : defaultUserPreferences.desktopNotifications,
    notificationSounds:
      typeof candidate.notificationSounds === 'boolean'
        ? candidate.notificationSounds
        : defaultUserPreferences.notificationSounds,
    soundVolume:
      typeof candidate.soundVolume === 'number' && Number.isFinite(candidate.soundVolume)
        ? Math.min(1, Math.max(0, candidate.soundVolume))
        : defaultUserPreferences.soundVolume,
    sendReadReceipts:
      typeof candidate.sendReadReceipts === 'boolean'
        ? candidate.sendReadReceipts
        : defaultUserPreferences.sendReadReceipts,
    sendTypingNotifications:
      typeof candidate.sendTypingNotifications === 'boolean'
        ? candidate.sendTypingNotifications
        : defaultUserPreferences.sendTypingNotifications,
    autoplayMedia:
      typeof candidate.autoplayMedia === 'boolean'
        ? candidate.autoplayMedia
        : defaultUserPreferences.autoplayMedia,
    dataSaver:
      typeof candidate.dataSaver === 'boolean'
        ? candidate.dataSaver
        : defaultUserPreferences.dataSaver,
    microphoneId: typeof candidate.microphoneId === 'string' ? candidate.microphoneId : '',
    cameraId: typeof candidate.cameraId === 'string' ? candidate.cameraId : '',
    speakerId: typeof candidate.speakerId === 'string' ? candidate.speakerId : '',
  };
}

export function loadUserPreferences(storage: Storage = localStorage): UserPreferences {
  try {
    const serialized = storage.getItem(PREFERENCES_KEY);
    return serialized ? parseUserPreferences(JSON.parse(serialized)) : { ...defaultUserPreferences };
  } catch {
    return { ...defaultUserPreferences };
  }
}

export function saveUserPreferences(
  preferences: UserPreferences,
  storage: Storage = localStorage,
): void {
  storage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}
