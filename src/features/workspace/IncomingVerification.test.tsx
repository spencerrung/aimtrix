import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IncomingVerification, type IncomingVerificationActions } from './IncomingVerification';
import type { IncomingVerificationSummary } from '../../matrix/settingsTypes';

vi.mock('qrcode', () => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,cXJjb2Rl') }));
vi.mock('@zxing/browser', () => ({ BrowserQRCodeReader: class { decodeFromVideoDevice() { return new Promise(() => undefined); } } }));

const request: IncomingVerificationSummary = { id: 'req', userId: '@self:example.test', deviceId: 'PHONE', selfVerification: true, timeoutMs: 60000, sasAvailable: true, qrShowAvailable: false, qrScanAvailable: false, qrConfirmAvailable: false };
function actions(overrides: Partial<IncomingVerificationActions> = {}): IncomingVerificationActions {
  return { accept: vi.fn(), decline: vi.fn().mockResolvedValue(undefined), showQr: vi.fn(), scanQr: vi.fn().mockResolvedValue(undefined), confirmQr: vi.fn(), ...overrides };
}

describe('incoming verification controls', () => {
  it('shows device identity and completes incoming emoji confirmation once', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const api = actions({ accept: vi.fn().mockResolvedValue({ emoji: [['🌱', 'Seedling']], confirm, cancel: vi.fn() }) });
    render(<IncomingVerification requests={[request]} actions={api} />);
    expect(screen.getByText(/PHONE/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compare emoji' }));
    expect(await screen.findByRole('dialog', { name: 'Compare incoming verification emoji' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'They match' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  });

  it('does not expose unsupported QR controls and prevents duplicate decline', async () => {
    let complete!: () => void;
    const decline = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    render(<IncomingVerification requests={[request]} actions={actions({ decline })} />);
    expect(screen.queryByRole('button', { name: /QR code/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(decline).toHaveBeenCalledOnce();
    complete();
  });

  it('cancels the Matrix request when an already displayed QR dialog closes', async () => {
    const api = actions({ showQr: vi.fn().mockResolvedValue(new Uint8ClampedArray([77, 65, 84, 82, 73, 88])) });
    render(<IncomingVerification requests={[{ ...request, qrShowAvailable: true }]} actions={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show QR code' }));
    expect(await screen.findByRole('dialog', { name: 'Matrix verification QR code' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(api.decline).toHaveBeenCalledWith('req'));
  });

  it('accepts the request before opening the QR camera', async () => {
    const mediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } });
    let ready!: () => void;
    const scanQr = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
    const api = actions({ scanQr });
    render(<IncomingVerification requests={[{ ...request, qrScanAvailable: true }]} actions={api} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scan QR code' }));
    expect(scanQr).toHaveBeenCalledWith('req', undefined, expect.any(AbortSignal));
    expect(screen.queryByRole('dialog', { name: 'Matrix verification QR code' })).not.toBeInTheDocument();
    ready();
    expect(await screen.findByRole('dialog', { name: 'Matrix verification QR code' })).toBeInTheDocument();
    if (mediaDevices) Object.defineProperty(navigator, 'mediaDevices', mediaDevices);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
  });
});
