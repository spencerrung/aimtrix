// Synthetic controller adapter. The browser exercises the production App and UI.
import { demoWorkspace } from '../../src/demo/demoWorkspace';
const recovery = { userId: demoWorkspace.user.id, homeserver: 'https://example.test', softLogout: true };
const ready = () => ({ status: 'ready', workspace: { ...demoWorkspace, mode: 'matrix' } });
export class MatrixController {
  snapshot: object = ready();
  listeners = new Set<() => void>();
  constructor() {
    globalThis.addEventListener('session-fixture', (event) => {
      const next = (event as CustomEvent<string>).detail;
      this.publish(next === 'expired' ? { status: 'reauthentication-required', recovery } : next === 'hard' ? { status: 'reauthentication-required', recovery: { ...recovery, softLogout: false } } : { ...ready(), workspace: { ...demoWorkspace, mode: 'matrix', connection: 'offline' }, issue: next });
    });
    return new Proxy(this, { get(target, key) { return Reflect.get(target, key) ?? (async () => undefined); } });
  }
  loadPersonalization = () => undefined;
  loadProfilePersonalization = () => undefined;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.snapshot;
  getDraftScope = () => 'workspace' in this.snapshot || 'recovery' in this.snapshot ? { userId: recovery.userId, homeserver: recovery.homeserver } : undefined;
  publish(snapshot: object) { this.snapshot = snapshot; this.listeners.forEach((listener) => listener()); }
  reauthenticate = async () => { this.publish({ status: 'signed-out', recovery }); };
  forgetSession = async () => { this.publish({ status: 'signed-out' }); };
  login = async () => { this.publish(ready()); };
  retry = async () => { this.publish(ready()); };
  logout = async () => { this.publish({ status: 'signed-out' }); };
}
