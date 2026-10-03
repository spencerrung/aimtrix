import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import './groupCall.css';

interface Props {
  roomName: string;
  initialVideo: boolean;
  onClose: () => void;
  onJoin: (video: boolean, devices: { microphoneId: string; cameraId: string }, microphoneEnabled: boolean) => Promise<void>;
}

export function GroupCallPrejoin({ roomName, initialVideo, onClose, onJoin }: Props) {
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [video, setVideo] = useState(initialVideo);
  const [microphoneId, setMicrophoneId] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = useRef<HTMLVideoElement>(null);
  const previewStream = useRef<MediaStream | null>(null);
  const previewGeneration = useRef(0);
  const mounted = useRef(true);

  const stopPreview = () => {
    previewGeneration.current += 1;
    previewStream.current?.getTracks().forEach((track) => track.stop());
    previewStream.current = null;
    if (preview.current) preview.current.srcObject = null;
    setPreviewing(false);
  };
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void navigator.mediaDevices?.enumerateDevices().then((items) => { if (active) setDevices(items); }).catch(() => undefined);
    return () => { active = false; mounted.current = false; previewGeneration.current += 1; previewStream.current?.getTracks().forEach((track) => track.stop()); };
  }, []);
  const togglePreview = async () => {
    if (previewing) { stopPreview(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setError('Camera preview is unavailable in this browser.'); return; }
    setError('');
    const generation = ++previewGeneration.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: cameraId ? { deviceId: { exact: cameraId } } : true });
      if (!mounted.current || generation !== previewGeneration.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      previewStream.current = stream;
      if (preview.current) preview.current.srcObject = stream;
      setPreviewing(true);
      const refreshed = await navigator.mediaDevices.enumerateDevices();
      if (mounted.current && generation === previewGeneration.current) setDevices(refreshed);
    } catch { if (mounted.current && generation === previewGeneration.current) setError('Camera access was denied or the selected camera is unavailable. Choose another device or join without video.'); }
  };
  const join = async () => {
    if (busy) return;
    setBusy(true); setError(''); stopPreview();
    try { await onJoin(video, { microphoneId, cameraId }, microphoneEnabled); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The group call could not start.'); }
    finally { setBusy(false); }
  };
  const close = () => { stopPreview(); onClose(); };

  return <Dialog className="group-call-prejoin" aria-label="Join group call" onClose={close} busy={busy}>
    <h2>Join group call</h2>
    <p>{roomName}</p>
    <p>Call media is encrypted before your microphone or camera publishes. Joining starts with both off unless you turn them on here.</p>
    <label><input type="checkbox" checked={microphoneEnabled} onChange={(event) => setMicrophoneEnabled(event.target.checked)} /> Join with microphone on</label>
    <label>Microphone<select value={microphoneId} onChange={(event) => setMicrophoneId(event.target.value)}><option value="">System default</option>{devices.filter((device) => device.kind === 'audioinput' && device.deviceId).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
    <label><input type="checkbox" checked={video} onChange={(event) => setVideo(event.target.checked)} /> Join with camera on</label>
    <label>Camera<select value={cameraId} onChange={(event) => { setCameraId(event.target.value); stopPreview(); }}><option value="">System default</option>{devices.filter((device) => device.kind === 'videoinput' && device.deviceId).map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
    <video ref={preview} className="group-call-prejoin__preview" muted autoPlay playsInline aria-label="Camera preview" hidden={!previewing} />
    <button type="button" onClick={() => void togglePreview()}>{previewing ? 'Stop camera preview' : 'Preview camera'}</button>
    {error ? <p role="alert">{error}</p> : null}
    <footer><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="aqua-button aqua-button--primary" type="button" disabled={busy} onClick={() => void join()}>{busy ? 'Joining…' : 'Join encrypted call'}</button></footer>
  </Dialog>;
}
