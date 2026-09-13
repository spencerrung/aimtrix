import { act, fireEvent, render, screen } from '@testing-library/react';
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
