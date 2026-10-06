import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Node 26 exposes host Web Storage; browser tests must use their JSDOM origin.
// Vitest exposes the underlying instance even when host globals shadow window.
const browserWindow = (globalThis as typeof globalThis & { jsdom: { window: Window } }).jsdom.window;
for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, { configurable: true, get: () => browserWindow[name] });
}

// JSDOM has no top layer. Real containment/inertness is covered in Playwright.
HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
HTMLDialogElement.prototype.close ??= function () { this.open = false; };

afterEach(() => cleanup());
