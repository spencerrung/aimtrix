import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { VerificationPhase, VerificationRequestEvent, VerifierEvent } from 'matrix-js-sdk/lib/crypto-api';
import type { MatrixClient } from 'matrix-js-sdk';
import { MatrixController } from './MatrixController';
import { defaultRuntimeConfig } from '../config/runtimeConfig';

function setup(phase: VerificationPhase) {
  const controller = new MatrixController(structuredClone(defaultRuntimeConfig));
  const verifier = Object.assign(new EventEmitter(), { verify: vi.fn(() => new Promise<void>(() => undefined)) });
  const request = Object.assign(new EventEmitter(), { phase, verifier, cancel: vi.fn().mockResolvedValue(undefined) });
  const client = { getSafeUserId: () => '@synthetic:example.test', getCrypto: () => ({ requestDeviceVerification: vi.fn().mockResolvedValue(request) }) };
  (controller as unknown as { client: MatrixClient }).client = client as unknown as MatrixClient;
  return { controller, request, verifier };
}

describe('verification cancellation', () => {
  it('cancels a request before readiness and removes its listener', async () => {
    const { controller, request } = setup(VerificationPhase.Requested);
    const abort = new AbortController(); const pending = controller.verifyDevice('OTHER', abort.signal);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(request.listenerCount(VerificationRequestEvent.Change)).toBe(1));
    abort.abort(); await rejected;
    expect(request.cancel).toHaveBeenCalled(); expect(request.listenerCount(VerificationRequestEvent.Change)).toBe(0);
  });

  it('cancels while waiting for SAS and removes the SAS listener', async () => {
    const { controller, request, verifier } = setup(VerificationPhase.Ready);
    const abort = new AbortController(); const pending = controller.verifyDevice('OTHER', abort.signal);
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(verifier.listenerCount(VerifierEvent.ShowSas)).toBe(1));
    abort.abort(); await rejected;
    expect(request.cancel).toHaveBeenCalled(); expect(verifier.listenerCount(VerifierEvent.ShowSas)).toBe(0);
  });

  it('cancels a request that arrives after the caller stopped waiting', async () => {
    const { controller, request } = setup(VerificationPhase.Requested);
    const abort = new AbortController(); const pending = controller.verifyDevice('OTHER', abort.signal);
    abort.abort(); await expect(pending).rejects.toThrow('cancelled');
    expect(request.cancel).toHaveBeenCalled(); expect(request.listenerCount(VerificationRequestEvent.Change)).toBe(0);
  });

  it('keeps cancellation connected after SAS is shown and cleans up on local cancel', async () => {
    const { controller, request, verifier } = setup(VerificationPhase.Ready);
    const abort = new AbortController(); const pending = controller.verifyDevice('OTHER', abort.signal);
    await vi.waitFor(() => expect(verifier.listenerCount(VerifierEvent.ShowSas)).toBe(1));
    const cancel = vi.fn();
    verifier.emit(VerifierEvent.ShowSas, { sas: { emoji: [['🌱', 'Seedling']] }, cancel, confirm: vi.fn() });
    const challenge = await pending;
    abort.abort(); expect(request.cancel).toHaveBeenCalled();
    challenge.cancel(); expect(cancel).toHaveBeenCalledOnce(); expect(verifier.listenerCount(VerifierEvent.ShowSas)).toBe(0);
  });
});
