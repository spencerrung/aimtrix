import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InstallPrompt } from './InstallPrompt';

describe('InstallPrompt', () => {
  it('offers the browser install flow when the browser exposes it', async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const installEvent = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'accepted' }>;
    };
    installEvent.prompt = prompt;
    installEvent.userChoice = Promise.resolve({ outcome: 'accepted' });

    render(<InstallPrompt />);
    window.dispatchEvent(installEvent);

    const installButton = await screen.findByRole('button', { name: 'Install' });
    fireEvent.click(installButton);
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument());
  });
});
