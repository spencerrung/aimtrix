import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import type { DeviceVerificationChallenge, IncomingVerificationSummary } from '../../matrix/settingsTypes';

export interface IncomingVerificationActions {
  accept: (id: string, signal?: AbortSignal) => Promise<DeviceVerificationChallenge>;
  decline: (id: string) => Promise<void>;
  showQr: (id: string, signal?: AbortSignal) => Promise<Uint8ClampedArray>;
  scanQr: (id: string, bytes?: Uint8ClampedArray, signal?: AbortSignal) => Promise<void>;
  confirmQr: (id: string) => Promise<void>;
}

function QrScanner({ onScan, onError }: { onScan: (bytes: Uint8ClampedArray) => void; onError: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const callbacks = useRef({ onScan, onError });
  useEffect(() => { callbacks.current = { onScan, onError }; }, [onScan, onError]);
  useEffect(() => {
    let stopped = false;
    let controls: { stop: () => void } | undefined;
    void (async () => {
      try {
        const [{ MatrixQrReader }, { ResultMetadataType }] = await Promise.all([import('./MatrixQrReader'), import('@zxing/library')]);
        if (stopped || !video.current) return;
        controls = await new MatrixQrReader().decodeFromVideoDevice(undefined, video.current, (result) => {
          if (!result || stopped) return;
          const segments = result.getResultMetadata()?.get(ResultMetadataType.BYTE_SEGMENTS) as Uint8Array[] | undefined;
          if (!segments?.length) return;
          const size = segments.reduce((length, segment) => length + segment.length, 0);
          if (size > 512) { callbacks.current.onError(); return; }
          const bytes = new Uint8ClampedArray(size);
          let offset = 0;
          for (const segment of segments) { bytes.set(segment, offset); offset += segment.length; }
          stopped = true; controls?.stop(); callbacks.current.onScan(bytes);
        });
        if (stopped) controls.stop();
      } catch { if (!stopped) callbacks.current.onError(); }
    })();
    return () => { stopped = true; controls?.stop(); };
  }, []);
  return <video ref={video} className="incoming-verification__camera" muted playsInline aria-label="Camera preview for Matrix verification QR code" />;
}

export function IncomingVerification({ requests, actions }: { requests: IncomingVerificationSummary[]; actions: IncomingVerificationActions }) {
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState('');
  const [challenge, setChallenge] = useState<{ request: IncomingVerificationSummary; value: DeviceVerificationChallenge }>();
  const [qr, setQr] = useState<{ request: IncomingVerificationSummary; image?: string; scanning?: boolean }>();
  const [confirming, setConfirming] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);
  const activeChallenge = useRef(challenge);
  const pending = useRef(false);
  useEffect(() => { activeChallenge.current = challenge; }, [challenge]);
  useEffect(() => () => { abort.current?.abort(); activeChallenge.current?.value.cancel(); }, []);
  const start = async (request: IncomingVerificationSummary, operation: (signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusyId(request.id); setError('');
    const controller = new AbortController(); abort.current = controller;
    try { await operation(controller.signal); }
    catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Verification could not start. Ask for a new request.'); }
    finally { pending.current = false; setBusyId(undefined); }
  };
  const accept = (request: IncomingVerificationSummary) => void start(request, async (signal) => {
    const value = await actions.accept(request.id, signal);
    if (signal.aborted) { value.cancel(); return; }
    setChallenge({ request, value });
  });
  const showQr = (request: IncomingVerificationSummary) => void start(request, async (signal) => {
    const bytes = await actions.showQr(request.id, signal);
    const { toDataURL } = await import('qrcode');
    const image = await toDataURL([{ mode: 'byte', data: bytes }], { errorCorrectionLevel: 'L', margin: 2, width: 256 });
    if (!signal.aborted) setQr({ request, image });
  });
  const scanQr = (request: IncomingVerificationSummary) => void start(request, async (signal) => {
    await actions.scanQr(request.id, undefined, signal);
    if (!signal.aborted) setQr({ request, scanning: true });
  });
  const scanned = (bytes: Uint8ClampedArray) => {
    const request = qr?.request;
    if (!request) return;
    setQr({ request });
    void start(request, async (signal) => { await actions.scanQr(request.id, bytes, signal); setQr(undefined); });
  };
  const scannerError = () => { setQr(undefined); setError('Camera or QR decoding failed. Allow camera access and try again, or compare emoji.'); };
  const cancel = () => { abort.current?.abort(); challenge?.value.cancel(); if (qr) void actions.decline(qr.request.id).catch(() => undefined); setChallenge(undefined); setQr(undefined); setConfirming(false); };
  const confirm = async () => {
    if (!challenge || confirming) return;
    setConfirming(true); setError('');
    try { await challenge.value.confirm(); setChallenge(undefined); }
    catch { setError('Verification did not complete. The other device may have cancelled; try a new request.'); }
    finally { setConfirming(false); }
  };
  const confirmQr = async () => {
    if (!qr || confirming) return;
    setConfirming(true); setError('');
    try { await actions.confirmQr(qr.request.id); setQr(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'QR verification did not complete.'); }
    finally { setConfirming(false); }
  };
  const shownQrRequest = qr && requests.find((request) => request.id === qr.request.id) || qr?.request;
  if (!requests.length && !challenge && !qr) return null;
  return <aside className="incoming-verification" aria-label="Incoming device verification">
    <strong>Verify a device</strong>
    {requests.map((request) => <div key={request.id} className="incoming-verification__request">
      <p>{request.selfVerification ? 'Another session on your account' : request.userId} {request.deviceId ? `(${request.deviceId})` : ''} wants to verify. Compare emoji or scan a QR code before trusting it.</p>
      {request.timeoutMs !== undefined ? <small>Expires in about {Math.max(0, Math.ceil(request.timeoutMs / 1000))} seconds.</small> : null}
      <div>
        {request.sasAvailable ? <button className="aqua-button aqua-button--primary" type="button" disabled={Boolean(busyId)} onClick={() => accept(request)}>Compare emoji</button> : null}
        {request.qrShowAvailable ? <button className="aqua-button" type="button" disabled={Boolean(busyId)} onClick={() => showQr(request)}>Show QR code</button> : null}
        {request.qrScanAvailable && typeof navigator.mediaDevices?.getUserMedia === 'function' ? <button className="aqua-button" type="button" disabled={Boolean(busyId)} onClick={() => scanQr(request)}>Scan QR code</button> : null}
        <button type="button" disabled={Boolean(busyId)} onClick={() => void start(request, async () => { await actions.decline(request.id); })}>Decline</button>
      </div>
      {!request.sasAvailable && !request.qrShowAvailable && !request.qrScanAvailable ? <p>This request has no verification method available here. Ask for a new request or use another Matrix client.</p> : null}
    </div>)}
    {error ? <p role="alert">{error}</p> : null}
    {challenge ? <Dialog className="verification-challenge" aria-label="Compare incoming verification emoji" onClose={cancel} busy={confirming}>
      <h2>Do these emoji match on both devices?</h2><p>Confirm only when the same emoji appear in the same order on {challenge.request.deviceId || challenge.request.userId}.</p>
      <div className="incoming-verification__emoji">{challenge.value.emoji.map(([symbol, name]) => <span key={`${symbol}-${name}`}><b>{symbol}</b><small>{name}</small></span>)}</div>
      <footer><button className="aqua-button" type="button" onClick={cancel}>They do not match</button><button className="aqua-button aqua-button--primary" type="button" disabled={confirming} onClick={() => void confirm()}>{confirming ? 'Confirming…' : 'They match'}</button></footer>
      {error ? <p role="alert">{error}</p> : null}
    </Dialog> : null}
    {qr ? <Dialog className="verification-challenge" aria-label="Matrix verification QR code" onClose={cancel} busy={confirming}>
      <h2>{qr.scanning ? 'Scan the other device’s QR code' : 'Verify this QR code'}</h2>
      {qr.image ? <img className="incoming-verification__qr" src={qr.image} alt="Matrix verification QR code to scan with the other device" /> : null}
      {qr.scanning ? <QrScanner onScan={scanned} onError={scannerError} /> : null}
      {!qr.image && !qr.scanning ? <p>Waiting for the other device to finish verification…</p> : null}
      {qr.image && !shownQrRequest?.qrConfirmAvailable ? <p>Waiting for the other device to scan the code.</p> : null}
      {qr.image && shownQrRequest?.qrConfirmAvailable ? <p>Check the confirmation on both devices before trusting this session.</p> : null}
      <footer><button type="button" onClick={cancel}>Cancel</button>{qr.image && shownQrRequest?.qrConfirmAvailable ? <button className="aqua-button aqua-button--primary" type="button" disabled={confirming} onClick={() => void confirmQr()}>Confirm QR match</button> : null}</footer>
      {error ? <p role="alert">{error}</p> : null}
    </Dialog> : null}
  </aside>;
}
