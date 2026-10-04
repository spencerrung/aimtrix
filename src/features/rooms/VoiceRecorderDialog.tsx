import { useEffect, useRef, useState } from 'react';
import { Mic, Square, X } from 'lucide-react';
import { Dialog, DialogClose } from '../../components/Dialog';
import './voiceRecorder.css';

const MAX_DURATION_MS = 300_000;
const RECORDING_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4'];

function recordingType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return typeof MediaRecorder.isTypeSupported === 'function' ? RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) : undefined;
}

async function waveformFor(file: File): Promise<number[] | undefined> {
  if (typeof AudioContext === 'undefined') return undefined;
  let audio: AudioContext | undefined;
  try {
    audio = new AudioContext();
    const decoded = await audio.decodeAudioData(await file.arrayBuffer());
    const samples = decoded.getChannelData(0);
    if (!samples.length) return undefined;
    return Array.from({ length: 32 }, (_, index) => {
      const start = Math.floor(index * samples.length / 32);
      const end = Math.max(start + 1, Math.floor((index + 1) * samples.length / 32));
      let peak = 0;
      for (let cursor = start; cursor < end; cursor++) peak = Math.max(peak, Math.abs(samples[cursor] ?? 0));
      return Math.round(Math.min(1, peak) * 1024);
    });
  } catch { return undefined; }
  finally { if (audio) await audio.close().catch(() => {}); }
}

export function VoiceRecorderDialog({ roomName, maxBytes, microphoneId, onSend, onClose }: {
  roomName: string;
  maxBytes: number;
  microphoneId?: string;
  onSend: (file: File, durationMs: number, waveform?: number[]) => Promise<void>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'requesting' | 'recording' | 'preview' | 'sending'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState<{ file: File; durationMs: number }>();
  const [error, setError] = useState('');
  const preview = useRef<HTMLAudioElement>(null);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const started = useRef(0);
  const generation = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const overLimit = useRef(false);
  const failed = useRef(false);
  const stopTracks = () => { stream.current?.getTracks().forEach((track) => track.stop()); stream.current = undefined; };
  const clearTimer = () => { if (timer.current !== undefined) window.clearInterval(timer.current); timer.current = undefined; };
  useEffect(() => () => { generation.current++; clearTimer(); if (recorder.current?.state === 'recording') recorder.current.stop(); stopTracks(); }, []);
  useEffect(() => {
    if (!recording || !preview.current) return;
    const url = URL.createObjectURL(recording.file);
    preview.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [recording]);
  const dismiss = () => { generation.current++; clearTimer(); if (recorder.current?.state === 'recording') recorder.current.stop(); stopTracks(); onClose(); };
  const start = async () => {
    const mimeType = recordingType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) { setError('Recording is unavailable in this browser. Attach an audio file instead.'); return; }
    const current = ++generation.current;
    setError(''); setRecording(undefined); setElapsed(0); setPhase('requesting');
    let input: MediaStream;
    try { input = await navigator.mediaDevices.getUserMedia({ audio: microphoneId ? { deviceId: { exact: microphoneId } } : true }); }
    catch { if (generation.current === current) { setPhase('idle'); setError('Microphone access was denied or unavailable. Check device permissions and try again.'); } return; }
    if (generation.current !== current) { input.getTracks().forEach((track) => track.stop()); return; }
    stream.current = input;
    const chunks: Blob[] = [];
    let bytes = 0;
    overLimit.current = false;
    failed.current = false;
    let instance: MediaRecorder;
    try { instance = new MediaRecorder(input, { mimeType }); }
    catch { stopTracks(); setPhase('idle'); setError('Recording could not start on this device.'); return; }
    recorder.current = instance;
    instance.ondataavailable = (event) => {
      if (generation.current !== current || !event.data.size) return;
      bytes += event.data.size;
      if (bytes > maxBytes) { overLimit.current = true; if (instance.state === 'recording') instance.stop(); return; }
      chunks.push(event.data);
    };
    instance.onerror = () => { if (generation.current === current) { failed.current = true; setError('The microphone was interrupted. Try recording again.'); if (instance.state === 'recording') instance.stop(); } };
    instance.onstop = () => {
      clearTimer(); stopTracks();
      if (generation.current !== current) return;
      const durationMs = Math.min(MAX_DURATION_MS, Date.now() - started.current);
      if (failed.current) { setPhase('idle'); return; }
      if (overLimit.current) { setError('This recording exceeds the attachment size limit. Try a shorter message.'); setPhase('idle'); return; }
      if (!chunks.length || durationMs < 250) { setError('No audio was recorded. Try again.'); setPhase('idle'); return; }
      const type = instance.mimeType || mimeType;
      const extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      setRecording({ file: new File(chunks, `voice-message.${extension}`, { type: type.split(';')[0] }), durationMs });
      setPhase('preview');
    };
    input.getAudioTracks().forEach((track) => { track.onended = () => {
      if (generation.current === current && instance.state === 'recording') { setError('The microphone disconnected. Review the captured audio or record again.'); instance.stop(); }
    }; });
    try {
      instance.start(1000);
      started.current = Date.now(); setPhase('recording');
      timer.current = window.setInterval(() => {
        const duration = Date.now() - started.current;
        setElapsed(duration);
        if (duration >= MAX_DURATION_MS && instance.state === 'recording') instance.stop();
      }, 250);
    } catch { stopTracks(); setPhase('idle'); setError('Recording could not start on this device.'); }
  };
  const send = async () => {
    if (!recording) return;
    setPhase('sending'); setError('');
    try { await onSend(recording.file, recording.durationMs, await waveformFor(recording.file)); dismiss(); }
    catch (cause) { setPhase('preview'); setError(cause instanceof Error ? cause.message : 'The voice message could not be staged. Try again.'); }
  };
  return <Dialog className="room-dialog voice-recorder" aria-labelledby="voice-recorder-title" onClose={dismiss} busy={phase === 'sending'}>
    <header><strong id="voice-recorder-title">Record a voice message</strong><DialogClose aria-label="Close"><X size={16} /></DialogClose></header>
    <div className="voice-recorder__body">
      <p>Record for {roomName}. Nothing is uploaded until you review and send. Maximum {Math.floor(MAX_DURATION_MS / 60_000)} minutes and {Math.ceil(maxBytes / 1024 / 1024)} MB.</p>
      {phase === 'requesting' ? <p role="status">Waiting for microphone permission…</p> : null}
      {phase === 'recording' ? <><p role="status">Recording · {Math.ceil(elapsed / 1000)} seconds</p><button className="aqua-button" type="button" onClick={() => recorder.current?.stop()}><Square size={16} /> Stop recording</button></> : null}
      {recording && phase !== 'recording' ? <><strong>Review your recording · {Math.ceil(recording.durationMs / 1000)} seconds</strong><audio ref={preview} controls preload="metadata" aria-label="Voice message preview" />
        <div className="voice-recorder__actions"><button className="aqua-button" type="button" disabled={phase === 'sending'} onClick={() => { setRecording(undefined); setPhase('idle'); setError(''); }}>Discard</button>
          <button className="aqua-button aqua-button--primary" type="button" disabled={phase === 'sending'} onClick={() => void send()}>{phase === 'sending' ? 'Preparing…' : 'Send voice message'}</button></div></> : null}
      {phase === 'idle' ? <button className="aqua-button aqua-button--primary" type="button" onClick={() => void start()}><Mic size={16} /> Start recording</button> : null}
      {error ? <p role="alert" className="settings-error">{error}</p> : null}
    </div>
  </Dialog>;
}
