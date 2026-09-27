import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { VerificationPhase, VerificationRequestEvent, VerifierEvent } from 'matrix-js-sdk/lib/crypto-api/index.js';
import { MatrixController } from './MatrixController';
import { defaultRuntimeConfig } from '../config/runtimeConfig';
import type { VerificationRequest } from 'matrix-js-sdk/lib/crypto-api/verification.js';

function fixture() {
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  const confirm = vi.fn().mockResolvedValue(undefined);
  const cancelSas = vi.fn();
  const verifier = Object.assign(new EventEmitter(), { getReciprocateQrCodeCallbacks: vi.fn().mockReturnValue(null), getShowSasCallbacks: vi.fn().mockReturnValue(null), verify: vi.fn(async () => {
    queueMicrotask(() => verifier.emit(VerifierEvent.ShowSas, { sas: { emoji: [['🌱', 'Seedling']] }, confirm, cancel: cancelSas }));
  }) });
  const request = Object.assign(new EventEmitter(), {
    transactionId: 'verification-1', otherUserId: '@self:test', otherDeviceId: 'PHONE', isSelfVerification: true,
    initiatedByMe: false, pending: true, accepting: false, declining: false, phase: VerificationPhase.Requested,
    timeout: 60000, verifier,
    otherPartySupportsMethod: vi.fn().mockReturnValue(false),
    accept: vi.fn(async () => { request.phase = VerificationPhase.Ready; request.emit(VerificationRequestEvent.Change); }),
    cancel: vi.fn(async () => { request.phase = VerificationPhase.Cancelled; request.pending = false; request.emit(VerificationRequestEvent.Change); }),
  });
  const internals = controller as unknown as { handleIncomingVerification: (request: VerificationRequest) => void; incomingVerificationSummaries: () => Array<{ id: string; deviceId?: string }> };
  return { controller, internals, request, verifier, confirm };
}

describe('incoming verification', () => {
  it('accepts an incoming request and completes emoji SAS for the named device', async () => {
    const { controller, internals, request, confirm } = fixture();
    internals.handleIncomingVerification(request as unknown as VerificationRequest);
    expect(internals.incomingVerificationSummaries()).toMatchObject([{ id: 'verification-1', deviceId: 'PHONE' }]);
    const challenge = await controller.acceptIncomingVerification('verification-1');
    expect(request.accept).toHaveBeenCalledOnce();
    expect(challenge.emoji).toEqual([['🌱', 'Seedling']]);
    await challenge.confirm();
    expect(confirm).toHaveBeenCalledOnce();
    request.phase = VerificationPhase.Done; request.pending = false; request.emit(VerificationRequestEvent.Change);
    expect(internals.incomingVerificationSummaries()).toEqual([]);
    expect(request.listenerCount(VerificationRequestEvent.Change)).toBe(0);
  });

  it('declines and removes an incoming request', async () => {
    const { controller, internals, request } = fixture();
    internals.handleIncomingVerification(request as unknown as VerificationRequest);
    await controller.declineIncomingVerification('verification-1');
    expect(request.cancel).toHaveBeenCalledOnce();
    expect(internals.incomingVerificationSummaries()).toEqual([]);
  });

  it('generates QR bytes only after accepting a compatible incoming request', async () => {
    const { controller, internals, request } = fixture();
    const bytes = new Uint8ClampedArray([77, 65, 84, 82, 73, 88]);
    request.otherPartySupportsMethod.mockImplementation((method: string) => method === 'm.qr_code.scan.v1');
    const generateQRCode = vi.fn().mockResolvedValue(bytes);
    Object.assign(request, { generateQRCode });
    internals.handleIncomingVerification(request as unknown as VerificationRequest);
    expect(internals.incomingVerificationSummaries()).toMatchObject([{ qrShowAvailable: true }]);
    await expect(controller.showIncomingVerificationQr('verification-1')).resolves.toEqual(bytes);
    expect(request.accept).toHaveBeenCalledOnce();
    expect(generateQRCode).toHaveBeenCalledOnce();
    Object.defineProperty(request, 'methods', { get: () => { throw new Error('SDK methods getter is not implemented'); } });
    expect(internals.incomingVerificationSummaries()).toMatchObject([{ qrShowAvailable: true }]);
  });

  it('rejects an unsupported QR scan before passing payload to the SDK', async () => {
    const { controller, internals, request } = fixture();
    const scanQRCode = vi.fn();
    Object.assign(request, { scanQRCode });
    internals.handleIncomingVerification(request as unknown as VerificationRequest);
    await expect(controller.scanIncomingVerificationQr('verification-1', new Uint8ClampedArray([1]))).rejects.toThrow(/cannot show/);
    expect(scanQRCode).not.toHaveBeenCalled();
  });

  it('does not offer emoji after a QR verifier starts', () => {
    const { internals, request } = fixture();
    request.phase = VerificationPhase.Started;
    Object.assign(request, { chosenMethod: 'm.reciprocate.v1' });
    request.otherPartySupportsMethod.mockReturnValue(true);
    internals.handleIncomingVerification(request as unknown as VerificationRequest);
    expect(internals.incomingVerificationSummaries()).toMatchObject([{ sasAvailable: false, qrShowAvailable: false, qrScanAvailable: false }]);
  });

  it('uses a SAS challenge that arrived before the user opened verification', async () => {
    const { controller, internals, request, verifier, confirm } = fixture();
    request.phase = VerificationPhase.Started;
    Object.assign(request, { chosenMethod: 'm.sas.v1' });
    verifier.getShowSasCallbacks.mockReturnValue({ sas: { emoji: [['🌱', 'Seedling']] }, confirm, cancel: vi.fn() });
    internals.handleIncomingVerification(request as unknown as VerificationRequest);
    const challenge = await controller.acceptIncomingVerification('verification-1');
    expect(challenge.emoji).toEqual([['🌱', 'Seedling']]);
    expect(verifier.listenerCount(VerifierEvent.ShowSas)).toBe(0);
  });
});
