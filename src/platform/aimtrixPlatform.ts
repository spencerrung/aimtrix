import { Capacitor } from '@capacitor/core';
import { createBrowserPlatform } from './browserPlatform';
import { createCapacitorPlatform } from './capacitorPlatform';
import type { AimtrixPlatform } from './platform';

let platform: AimtrixPlatform | undefined;

export function getAimtrixPlatform(): AimtrixPlatform {
  platform ??= Capacitor.isNativePlatform() ? createCapacitorPlatform() : createBrowserPlatform();
  return platform;
}
