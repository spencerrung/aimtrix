import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProfileDialog } from './ProfileDialog';
import { defaultProfilePersonalization } from '../../settings/profilePersonalization';
import { demoWorkspace } from '../../demo/demoWorkspace';

it('retains rejected profile edits and only finishes after the save resolves', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('synthetic denial')).mockResolvedValue(undefined);
  render(<ProfileDialog user={demoWorkspace.user} personalization={defaultProfilePersonalization} stickerPacks={[]} canUpload={false} dataSaver onChange={save} onSignOut={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByText('Decorate my page'));
  fireEvent.change(screen.getByRole('textbox', { name: /Profile note/ }), { target: { value: 'Synthetic draft' } });
  fireEvent.click(screen.getByText('Save my page'));
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: /Profile note/ })).toHaveValue('Synthetic draft');
  fireEvent.click(screen.getByText('Save my page'));
  await waitFor(() => expect(screen.queryByText('Save my page')).not.toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent('Profile decorations saved.');
  expect(save).toHaveBeenCalledTimes(2);
});
