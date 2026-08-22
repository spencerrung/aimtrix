import { Capacitor } from '@capacitor/core';
import { isTauri } from '@tauri-apps/api/core';
import { createBrowserPlatform } from './browserPlatform';
import { createCapacitorPlatform } from './capacitorPlatform';
import { createTauriPlatform } from './tauriPlatform';
import type { AimtrixPlatform } from './platform';

let platform: AimtrixPlatform | undefined;

export function getAimtrixPlatform(): AimtrixPlatform {
  platform ??= isTauri()
    ? createTauriPlatform()
    : Capacitor.isNativePlatform()
      ? createCapacitorPlatform()
      : createBrowserPlatform();
  return platform;
}
