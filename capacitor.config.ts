import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.alucard.aimtrix',
  appName: 'Aimtrix',
  webDir: 'dist',
  // Keep the web bundle local. A remote server.url would turn native privileges into a remote-content boundary.
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'banner', 'list'],
    },
    LocalNotifications: {
      presentationOptions: ['badge', 'sound', 'banner', 'list'],
    },
  },
};

export default config;
