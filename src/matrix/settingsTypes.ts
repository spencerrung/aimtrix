export interface MatrixDeviceSummary {
  id: string;
  displayName: string;
  lastSeenAt?: number;
  lastSeenIp?: string;
  userAgent?: string;
  current: boolean;
  verified: boolean;
}

export interface MatrixSecuritySummary {
  encryptionReady: boolean;
  crossSigningReady: boolean;
  secretStorageReady: boolean;
  keyBackupEnabled: boolean;
  keyBackupVersion?: string;
}

export interface MatrixServerSummary {
  userId: string;
  homeserverUrl: string;
  serverName: string;
  deviceId: string;
  versions: string[];
  rtcFoci: string[];
}

export interface MatrixSettingsSnapshot {
  server: MatrixServerSummary;
  security: MatrixSecuritySummary;
  devices: MatrixDeviceSummary[];
  ignoredUsers: string[];
}

export interface DeviceVerificationChallenge {
  emoji: Array<[symbol: string, name: string]>;
  confirm: () => Promise<void>;
  cancel: () => void;
}

export type DeviceRemovalResult = 'removed' | 'password-required';
