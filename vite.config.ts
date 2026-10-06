import react from '@vitejs/plugin-react';
import { serviceWorkerBuild } from './build/serviceWorker';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), serviceWorkerBuild()],
  build: {
    sourcemap: false,
    target: 'es2022',
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    css: true,
  },
});
