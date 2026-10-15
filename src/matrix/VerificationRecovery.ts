import { ClientEvent, type MatrixClient } from 'matrix-js-sdk/lib/client.js';
import { CryptoEvent, type VerificationRequest } from 'matrix-js-sdk/lib/crypto-api/index.js';
import type { ReceivedToDeviceMessage } from 'matrix-js-sdk/lib/sync-accumulator.js';
import type { IncomingVerificationSummary } from './settingsTypes';

type Recovery = { summary: IncomingVerificationSummary; expires: number; checking: boolean };
const MAX_REQUEST_AGE = 10 * 60_000;
const RECOVERY_LIFETIME = 2 * 60_000;
const identity = (user: string, transaction: string) => JSON.stringify([user, transaction]);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 255;

/** Observes unsupported requests; never feeds events back into crypto or starts a handshake. */
export class VerificationRecovery {
  private readonly requests = new Map<string, Recovery>();
  private readonly seen = new Map<string, number>();
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public constructor(private readonly client: MatrixClient, private readonly changed: () => void) {
    client.on(ClientEvent.ReceivedToDeviceMessage, this.received);
    client.on(CryptoEvent.VerificationRequestReceived, this.accepted);
    client.on(CryptoEvent.DevicesUpdated, this.devicesUpdated);
  }

  public summaries(): IncomingVerificationSummary[] { return [...this.requests.values()].map(({ summary }) => summary); }

  public stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.requests.clear(); this.seen.clear();
    this.client.removeListener(ClientEvent.ReceivedToDeviceMessage, this.received);
    this.client.removeListener(CryptoEvent.VerificationRequestReceived, this.accepted);
    this.client.removeListener(CryptoEvent.DevicesUpdated, this.devicesUpdated);
  }

  public dismiss(id: string): void {
    for (const [key, entry] of this.requests) if (entry.summary.id === id) this.requests.delete(key);
    this.changed();
  }

  public async check(id: string): Promise<void> {
    const pair = [...this.requests].find(([, entry]) => entry.summary.id === id);
    if (!pair || this.stopped) return;
    const [key, entry] = pair;
    if (entry.checking) return;
    entry.checking = true; entry.summary.recovery = 'checking'; this.changed();
    try {
      // The own user is tracked by Rust. This waits briefly for an in-flight
      // signed key query; it cannot replay a dropped verification request.
      const devices = await this.client.getCrypto()?.getUserDeviceInfo([entry.summary.userId]);
      if (this.stopped || this.requests.get(key) !== entry) return;
      const device = devices?.get(entry.summary.userId)?.get(entry.summary.deviceId!);
      entry.summary.recovery = device && device.deviceId === entry.summary.deviceId && device.userId === entry.summary.userId ? 'retry' : 'waiting';
    } catch {
      if (this.stopped || this.requests.get(key) !== entry) return;
      entry.summary.recovery = 'failed';
    } finally {
      entry.checking = false;
      if (!this.stopped && this.requests.get(key) === entry) this.changed();
    }
  }

  private readonly devicesUpdated = (users: string[]): void => {
    if (!users.includes(this.client.getUserId() ?? '')) return;
    for (const { summary } of this.requests.values()) void this.check(summary.id);
  };

  private readonly accepted = (request: VerificationRequest): void => {
    if (!request.transactionId) return;
    const key = identity(request.otherUserId, request.transactionId);
    this.remember(key);
    let removed = this.requests.delete(key);
    // A new SDK-owned request from the same device supersedes its old advisory.
    for (const [priorKey, entry] of this.requests) {
      if (entry.summary.userId === request.otherUserId && entry.summary.deviceId === request.otherDeviceId) {
        this.requests.delete(priorKey); removed = true;
      }
    }
    if (removed) this.changed();
  };

  private readonly received = ({ message, encryptionInfo }: ReceivedToDeviceMessage): void => {
    if (this.stopped || message.sender !== this.client.getUserId()) return;
    const content = message.content;
    if (!content || !identifier(content.transaction_id)) return;
    const key = identity(message.sender, content.transaction_id);
    if (message.type === 'm.key.verification.cancel' || message.type === 'm.key.verification.done') {
      this.remember(key);
      if (this.requests.delete(key)) this.changed();
      return;
    }
    if (message.type !== 'm.key.verification.request' || this.seen.has(key)) return;
    const device = content.from_device;
    if (!identifier(device) || device === this.client.getDeviceId() || !Number.isFinite(content.timestamp)
      || Date.now() - content.timestamp > MAX_REQUEST_AGE || content.timestamp - Date.now() > 5 * 60_000
      || !Array.isArray(content.methods) || !content.methods.some((method: unknown) => method === 'm.sas.v1' || method === 'm.qr_code.show.v1' || method === 'm.qr_code.scan.v1')) return;
    if (encryptionInfo && (encryptionInfo.sender !== message.sender || encryptionInfo.senderDevice !== device)) return;
    this.remember(key);
    const existing = this.client.getCrypto()?.getVerificationRequestsToDeviceInProgress(message.sender)
      .some((request) => request.transactionId === content.transaction_id);
    if (existing || this.requests.size >= 5) return;
    // The identity here is claimed by the request, not an authenticated device.
    // No verification actions are offered until a new SDK-owned request arrives.
    const summary: IncomingVerificationSummary = { id: `recovery:${crypto.randomUUID()}`, userId: message.sender, deviceId: device,
      selfVerification: true, sasAvailable: false, qrShowAvailable: false, qrScanAvailable: false, qrConfirmAvailable: false, recovery: 'checking' };
    this.requests.set(key, { summary, expires: Math.min(Date.now() + RECOVERY_LIFETIME, content.timestamp + MAX_REQUEST_AGE), checking: false });
    this.changed();
    void this.check(summary.id);
  };

  private remember(key: string): void {
    this.seen.set(key, Date.now() + MAX_REQUEST_AGE);
    if (this.seen.size > 128) this.seen.delete(this.seen.keys().next().value!);
    if (this.timer === undefined) this.timer = setTimeout(this.expire, 1000);
  }

  private readonly expire = (): void => {
    this.timer = undefined;
    const now = Date.now();
    let changed = false;
    for (const [key, entry] of this.requests) if (entry.expires <= now) { this.requests.delete(key); changed = true; }
    for (const [key, until] of this.seen) if (until <= now) this.seen.delete(key);
    if (changed) this.changed();
    if (!this.stopped && this.seen.size) this.timer = setTimeout(this.expire, 1000);
  };
}
