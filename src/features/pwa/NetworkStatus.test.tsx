import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NetworkStatus } from './NetworkStatus';

describe('NetworkStatus', () => {
  it('explains that Matrix history is not guaranteed offline', async () => {
    render(<NetworkStatus />);
    window.dispatchEvent(new Event('offline'));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('You’re offline');
    expect(status).toHaveTextContent('Matrix history may be unavailable');
  });
});
