import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientEvent, type MatrixClient } from 'matrix-js-sdk/lib/client.js';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api/index.js';
import { VerificationRecovery } from './VerificationRecovery';

const user = '@synthetic:example.test';
const device = { deviceId: 'NEW', userId: user };
const known = () => new Map([[user, new Map([['NEW', device]])]]);
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((stop) => stop()); vi.useRealTimers(); });
function fixture() {
  const crypto = { getUserDeviceInfo: vi.fn().mockResolvedValue(new Map()), getVerificationRequestsToDeviceInProgress: vi.fn().mockReturnValue([]) };
  const client = Object.assign(new EventEmitter(), { getCrypto: () => crypto, getUserId: () => user, getDeviceId: () => 'THIS' });
  const changed = vi.fn();
  const recovery = new VerificationRecovery(client as unknown as MatrixClient, changed);
  cleanups.push(() => recovery.stop());
  const receive = (content: Record<string, unknown> = {}, type = 'm.key.verification.request', sender = user, encryptionInfo: unknown = null) => client.emit(ClientEvent.ReceivedToDeviceMessage, {
    message: { sender, type, content: { from_device: 'NEW', transaction_id: 'original', timestamp: Date.now(), methods: ['m.sas.v1'], ...content } }, encryptionInfo,
  });
  return { crypto, client, changed, recovery, receive };
}

describe('lost incoming verification recovery', () => {
  it('keeps the lost request distinct from SDK verification and checks signed device availability', async () => {
    const { recovery, receive, crypto, client } = fixture();
    receive();
    await vi.waitFor(() => expect(recovery.summaries()[0].recovery).toBe('waiting'));
    expect(recovery.summaries()[0]).toMatchObject({ sasAvailable: false, qrShowAvailable: false, qrScanAvailable: false, qrConfirmAvailable: false, deviceId: 'NEW' });
    const id = recovery.summaries()[0].id;
    crypto.getUserDeviceInfo.mockResolvedValue(known());
    client.emit(CryptoEvent.DevicesUpdated, [user], false);
    await vi.waitFor(() => expect(recovery.summaries()[0]).toMatchObject({ id, recovery: 'retry' }));
    receive();
    expect(recovery.summaries()).toHaveLength(1);
    expect(crypto.getUserDeviceInfo).toHaveBeenCalledTimes(2);
    client.emit(ClientEvent.ReceivedToDeviceMessage, { message: { sender: user, type: 'm.key.verification.cancel', content: { transaction_id: 'original' } }, encryptionInfo: null });
    expect(recovery.summaries()).toEqual([]);
    crypto.getVerificationRequestsToDeviceInProgress.mockReturnValue([{ transactionId: 'retry' }]);
    receive({ transaction_id: 'retry' });
    expect(recovery.summaries()).toEqual([]);
  });

  it('does not confuse known requests or terminal SDK phases with lost requests', () => {
    const { recovery, receive, client, crypto } = fixture();
    client.emit(CryptoEvent.VerificationRequestReceived, { otherUserId: user, transactionId: 'original', pending: false });
    receive();
    expect(recovery.summaries()).toEqual([]);
    expect(crypto.getUserDeviceInfo).not.toHaveBeenCalled();
  });

  it('removes a notice if the SDK later supplies the original request', () => {
    const { recovery, receive, client } = fixture();
    receive();
    client.emit(CryptoEvent.VerificationRequestReceived, { otherUserId: user, transactionId: 'original' });
    expect(recovery.summaries()).toEqual([]);
  });

  it.each(['m.key.verification.cancel', 'm.key.verification.done'])('does not resurrect %s after a late device check', async (type) => {
    const { recovery, receive, crypto } = fixture();
    let resolve!: (value: Map<string, Map<string, typeof device>>) => void;
    crypto.getUserDeviceInfo.mockReturnValue(new Promise((done) => { resolve = done; }));
    receive(); receive({}, type);
    resolve(known()); await Promise.resolve();
    expect(recovery.summaries()).toEqual([]);
    receive(); expect(recovery.summaries()).toEqual([]);
  });

  it('supersedes only the same device notice and ignores its late lookup completion', async () => {
    const { recovery, receive, client, crypto } = fixture();
    let resolve!: (value: Map<string, Map<string, typeof device>>) => void;
    crypto.getUserDeviceInfo.mockReturnValue(new Promise((done) => { resolve = done; }));
    receive();
    receive({ from_device: 'OTHER', transaction_id: 'other' });
    client.emit(CryptoEvent.VerificationRequestReceived, { otherUserId: user, otherDeviceId: 'NEW', transactionId: 'retry' });
    resolve(known()); await Promise.resolve();
    expect(recovery.summaries()).toHaveLength(1);
    expect(recovery.summaries()[0].deviceId).toBe('OTHER');
  });

  it('detaches listeners and ignores pending completion on account shutdown', async () => {
    const { recovery, receive, client, crypto, changed } = fixture();
    let resolve!: (value: Map<string, Map<string, typeof device>>) => void;
    crypto.getUserDeviceInfo.mockReturnValue(new Promise((done) => { resolve = done; }));
    receive(); recovery.stop(); changed.mockClear(); resolve(known()); await Promise.resolve();
    expect(recovery.summaries()).toEqual([]); expect(changed).not.toHaveBeenCalled();
    for (const event of [ClientEvent.ReceivedToDeviceMessage, CryptoEvent.VerificationRequestReceived, CryptoEvent.DevicesUpdated]) expect(client.listenerCount(event)).toBe(0);
    receive(); expect(recovery.summaries()).toEqual([]);
  });

  it('rejects other senders, own device, malformed or stale requests and mismatched encrypted identity', () => {
    vi.useFakeTimers();
    const { recovery, receive, crypto } = fixture();
    receive({}, undefined, '@other:example.test');
    for (const content of [{ from_device: 'THIS' }, { from_device: '' }, { transaction_id: '' }, { timestamp: Date.now() - 600001 }, { timestamp: Date.now() + 300001 }, { timestamp: 'now' }, { methods: ['unknown'] }]) receive(content);
    receive({}, undefined, user, { sender: user, senderDevice: 'DIFFERENT' });
    receive({}, undefined, user, { sender: '@other:example.test', senderDevice: 'NEW' });
    expect(recovery.summaries()).toEqual([]); expect(crypto.getUserDeviceInfo).not.toHaveBeenCalled();
  });

  it('requires the returned device to match the request and allows a failed check to be retried', async () => {
    const { recovery, receive, crypto } = fixture();
    crypto.getUserDeviceInfo.mockRejectedValue(new Error('private synthetic error'));
    receive(); await vi.waitFor(() => expect(recovery.summaries()[0].recovery).toBe('failed'));
    const id = recovery.summaries()[0].id;
    crypto.getUserDeviceInfo.mockResolvedValue(new Map([[user, new Map([['NEW', { ...device, userId: '@wrong:test' }]])]]));
    await recovery.check(id); expect(recovery.summaries()[0].recovery).toBe('waiting');
    crypto.getUserDeviceInfo.mockResolvedValue(known());
    await recovery.check(id); expect(recovery.summaries()[0].recovery).toBe('retry');
    recovery.dismiss(id); receive(); expect(recovery.summaries()).toEqual([]);
  });

  it('bounds notices and expires them without retaining SDK or raw event objects', async () => {
    vi.useFakeTimers();
    const { recovery, receive } = fixture();
    for (let i = 0; i < 8; i++) receive({ transaction_id: `request-${i}` });
    expect(recovery.summaries()).toHaveLength(5);
    await vi.advanceTimersByTimeAsync(120000);
    expect(recovery.summaries()).toEqual([]);
  });
});
