import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FirstUseGuide } from './FirstUseGuide';
import type { MatrixSettingsSnapshot } from '../../matrix/settingsTypes';

it('guides an empty account to encrypted conversations and explains recovery health', async () => {
  const onStartChat = vi.fn();
  const onCreateRoom = vi.fn();
  const onRecovery = vi.fn();
  const health = { security: { encryptionReady: true, secretStorageReady: false, keyBackupEnabled: false } } as MatrixSettingsSnapshot;
  render(<FirstUseGuide loadHealth={vi.fn().mockResolvedValue(health)} onStartChat={onStartChat} onCreateRoom={onCreateRoom} onRecovery={onRecovery} />);
  expect(await screen.findByText(/Recovery needs attention/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Start an encrypted chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create an encrypted room' }));
  fireEvent.click(screen.getByRole('button', { name: 'Set up or restore recovery' }));
  expect(onStartChat).toHaveBeenCalledOnce();
  expect(onCreateRoom).toHaveBeenCalledOnce();
  expect(onRecovery).toHaveBeenCalledOnce();
});
