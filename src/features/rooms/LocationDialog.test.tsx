import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LocationDialog } from './LocationDialog';

it('requires a coordinate preview and explicit share action', async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(<LocationDialog roomName="Welcome" onSend={send} onClose={close} />);
  expect(screen.getByRole('button', { name: 'Share this location' })).toBeDisabled();
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Latitude' }), { target: { value: '40.7128' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Longitude' }), { target: { value: '-74.006' } });
  expect(screen.getByText('geo:40.7128,-74.006')).toBeVisible();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Share this location' }));
  await waitFor(() => expect(send).toHaveBeenCalledWith(40.7128, -74.006, ''));
  expect(close).toHaveBeenCalledOnce();
});

it('can close while browser location permission is pending', () => {
  const close = vi.fn();
  const original = navigator.geolocation;
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn() } });
  try {
    render(<LocationDialog roomName="Welcome" onSend={vi.fn()} onClose={close} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledOnce();
  } finally { Object.defineProperty(navigator, 'geolocation', { configurable: true, value: original }); }
});

it('keeps manual sharing available when device permission is denied', async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  const original = navigator.geolocation;
  const locate = vi.fn((_success: unknown, fail: (error: { code: number }) => void) => fail({ code: 1 }));
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: locate } });
  try {
    render(<LocationDialog roomName="Welcome" onSend={send} onClose={vi.fn()} />);
    expect(locate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use my current location' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('denied');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Latitude' }), { target: { value: '40' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Longitude' }), { target: { value: '-74' } });
    fireEvent.click(screen.getByRole('button', { name: 'Share this location' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith(40, -74, ''));
  } finally { Object.defineProperty(navigator, 'geolocation', { configurable: true, value: original }); }
});
