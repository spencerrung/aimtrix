import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultRuntimeConfig } from '../../config/runtimeConfig';
import { LoginWindow } from './LoginWindow';

describe('LoginWindow', () => {
  it('submits Matrix credentials without changing the password field type', async () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(
      <LoginWindow
        config={defaultRuntimeConfig}
        snapshot={{ status: 'signed-out' }}
        warnings={[]}
        onLogin={onLogin}
        onSso={vi.fn()}
        onDiscover={vi.fn().mockResolvedValue({ password: true, sso: true, cas: false, homeserver: 'https://matrix.org' })}
        onDemo={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Matrix ID'), { target: { value: '@alex:example.com' } });
    await screen.findByLabelText('Password');
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-a-real-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign On' }));

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    expect(onLogin).toHaveBeenCalledWith({
      userId: '@alex:example.com',
      password: 'not-a-real-password',
      homeserver: 'matrix.org',
    });
  });

  it('offers demo mode when enabled', () => {
    render(
      <LoginWindow
        config={defaultRuntimeConfig}
        snapshot={{ status: 'signed-out' }}
        warnings={[]}
        onLogin={vi.fn()}
        onSso={vi.fn()}
        onDiscover={vi.fn().mockResolvedValue({ password: true, sso: true, cas: false, homeserver: 'https://matrix.org' })}
        onDemo={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /explore the demo buddy list/i })).toBeEnabled();
  });
});

it('prefills and locks a retained account while allowing password and SSO recovery', async () => {
  const onSso = vi.fn();
  render(<LoginWindow config={defaultRuntimeConfig} snapshot={{ status: 'signed-out', recovery: { userId: '@synthetic:example.test', homeserver: 'https://example.test', softLogout: true } }} warnings={[]} onLogin={vi.fn()} onSso={onSso} onDiscover={vi.fn().mockResolvedValue({ password: true, sso: true, cas: false, homeserver: 'https://example.test' })} onDemo={vi.fn()} onForget={vi.fn()} />);
  expect(screen.getByLabelText('Matrix ID')).toHaveValue('@synthetic:example.test');
  expect(screen.getByLabelText('Matrix ID')).toHaveAttribute('readonly');
  expect(screen.getByLabelText('Homeserver')).toHaveValue('https://example.test');
  expect(screen.getByLabelText('Homeserver')).toHaveAttribute('readonly');
  expect(await screen.findByLabelText('Password')).toHaveValue('');
  expect(screen.queryByText(/Explore the demo/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Sign in with homeserver SSO/ }));
  expect(onSso).toHaveBeenCalledWith({ userId: '@synthetic:example.test', homeserver: 'https://example.test' });
});

it('follows discovered SSO-only capability and does not ask for a password', async () => {
  const onDiscover = vi.fn().mockResolvedValue({ password: false, sso: true, cas: false, homeserver: 'https://sso.example.test' });
  render(<LoginWindow config={defaultRuntimeConfig} snapshot={{ status: 'signed-out' }} warnings={[]} onLogin={vi.fn()} onSso={vi.fn()} onDiscover={onDiscover} onDemo={vi.fn()} />);
  await waitFor(() => expect(onDiscover).toHaveBeenCalled());
  expect(await screen.findByRole('button', { name: /Sign in with homeserver SSO/ })).toBeEnabled();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign On' })).not.toBeInTheDocument();
});
