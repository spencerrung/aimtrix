import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultRuntimeConfig } from '../../config/runtimeConfig';
import { LoginWindow } from './LoginWindow';

describe('LoginWindow', () => {
  it('submits Matrix credentials without changing the password field type', () => {
    const onLogin = vi.fn().mockResolvedValue(undefined);
    render(
      <LoginWindow
        config={defaultRuntimeConfig}
        snapshot={{ status: 'signed-out' }}
        warnings={[]}
        onLogin={onLogin}
        onSso={vi.fn()}
        onDemo={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Matrix ID'), { target: { value: '@alex:example.com' } });
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
        onDemo={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /explore the demo buddy list/i })).toBeEnabled();
  });
});
