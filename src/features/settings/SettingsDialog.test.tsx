import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SettingsDialog } from './SettingsDialog';
import { demoWorkspace } from '../../demo/demoWorkspace';
import { defaultUserPreferences } from '../../settings/preferences';

it('keeps profile settings and entered values available while a save is pending or rejected', async () => {
  let reject!: (error: Error) => void;
  const save = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  const openPage = vi.fn(); const close = vi.fn();
  render(<SettingsDialog user={demoWorkspace.user} theme="aqua" preferences={defaultUserPreferences} canEditProfile onThemeChange={vi.fn()} onPreferencesChange={vi.fn()} onSaveProfile={save} onOpenProfilePage={openPage} onSignOut={vi.fn()} onClose={close} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), { target: { value: 'Synthetic draft' } });
  fireEvent.click(screen.getByText('Save profile'));
  expect(screen.getByText('Decorate profile page')).toBeDisabled();
  expect(screen.getByText('Appearance')).toBeDisabled();
  fireEvent.click(screen.getByText('Decorate profile page'));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(openPage).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  await act(async () => reject(new Error('synthetic denial')));
  expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue('Synthetic draft');
  expect(screen.getByRole('alert')).toHaveTextContent('did not accept');
  expect(screen.getByText('Decorate profile page')).toBeEnabled();
});

it('offers account switching and confirms dormant-account removal without touching the current account', async () => {
  const choose = vi.fn().mockResolvedValue(undefined);
  const forget = vi.fn().mockResolvedValue(undefined);
  render(<SettingsDialog user={demoWorkspace.user} theme="aqua" preferences={defaultUserPreferences} canEditProfile
    onThemeChange={vi.fn()} onPreferencesChange={vi.fn()} onOpenProfilePage={vi.fn()} onSignOut={vi.fn()} onClose={vi.fn()}
    accounts={[{ id: 'a', userId: '@current:example.test', homeserver: 'https://example.test', serverName: 'example.test', active: true, recovery: false },
      { id: 'b', userId: '@other:example.test', homeserver: 'https://other.test', serverName: 'other.test', active: false, recovery: false }]}
    onChooseAccount={choose} onForgetAccount={forget} />);
  fireEvent.click(screen.getByRole('button', { name: 'Accounts' }));
  expect(screen.getByText('@current:example.test')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Switch' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
  await waitFor(() => expect(choose).toHaveBeenCalledWith('b'));
  fireEvent.click(screen.getByRole('button', { name: 'Add another account' }));
  await waitFor(() => expect(choose).toHaveBeenCalledWith(null));
  fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
  expect(forget).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Forget account' }));
  await waitFor(() => expect(forget).toHaveBeenCalledWith('b'));
});
