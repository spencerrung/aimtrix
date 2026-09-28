import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { VoiceRecorderDialog } from './VoiceRecorderDialog';

const originalMediaDevices = navigator.mediaDevices;
afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices });
});

it('records locally, previews before sending, and releases the microphone', async () => {
  const track = { stop: vi.fn(), onended: null };
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  class FakeRecorder {
    static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus';
    state = 'inactive';
    mimeType = 'audio/webm;codecs=opus';
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    onerror?: () => void;
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['recorded audio'], { type: this.mimeType }) }); this.onstop?.(); }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  vi.stubGlobal('AudioContext', class { constructor() { throw new Error('Audio decoding unavailable'); } });
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:voice'); static revokeObjectURL = vi.fn(); });
  let time = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => time);
  const send = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(<VoiceRecorderDialog roomName="Welcome" maxBytes={1_000_000} microphoneId="selected-mic" onSend={send} onClose={close} />);
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  await screen.findByRole('button', { name: 'Stop recording' });
  expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'selected-mic' } } });
  expect(send).not.toHaveBeenCalled();
  time = 2000;
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
  await screen.findByLabelText('Voice message preview');
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send voice message' }));
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ name: 'voice-message.webm' }), 1000, undefined));
  expect(track.stop).toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});

it('keeps the recorder recoverable after microphone denial', async () => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) } });
  vi.stubGlobal('MediaRecorder', { isTypeSupported: () => true });
  render(<VoiceRecorderDialog roomName="Welcome" maxBytes={1_000_000} onSend={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Start recording' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('denied');
  expect(screen.getByRole('button', { name: 'Start recording' })).toBeEnabled();
});
