import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { demoWorkspace } from '../../demo/demoWorkspace';
import HomeActivity, { type HomePosition } from './HomeActivity';
import type { ActivitySnapshot } from '../../matrix/activity';
const activity: ActivitySnapshot = {
  items: [
    { id: 'mention', kind: 'notification', roomId: 'welcome', eventId: '$mention', body: 'Synthetic highlighted activity', timestamp: 100, read: 'read', highlighted: true, encrypted: false, unavailable: false, roomName: 'Welcome Lounge' },
    { id: 'thread', kind: 'thread', roomId: 'welcome', eventId: '$reply', threadRootId: '$root', body: 'Synthetic thread reply', timestamp: 200, read: 'unknown', highlighted: false, encrypted: true, unavailable: false, roomName: 'Welcome Lounge', followed: true },
  ], loading: false, loadingThreads: false, canLoadOlder: true, canLoadMoreThreads: true,
  coverage: { notifications: 'server', limited: true, encryptedPending: true, roomsLoaded: 1, roomsTotal: 2, threadsUnsupported: false },
};
function setup(overrides: Partial<ComponentProps<typeof HomeActivity>> = {}) {
  const props = { workspace: demoWorkspace, activity, actions: { refresh: vi.fn(async () => undefined), loadOlder: vi.fn(async () => undefined), loadMoreThreads: vi.fn(async () => undefined), setThreadFollow: vi.fn(async () => undefined) },
    onOpen: vi.fn(async () => undefined), onBack: vi.fn(), onSettings: vi.fn(), onDrafts: vi.fn(), draftCount: 2, onMarkRead: vi.fn(async () => undefined), ...overrides };
  function Fixture() { const [position, setPosition] = useState<HomePosition>({ filter: 'all', scroll: 0, initialized: false }); return <HomeActivity {...props} position={position} onPosition={(patch) => setPosition((current) => ({ ...current, ...patch }))} />; }
  render(<Fixture />); return props;
}
describe('HomeActivity', () => {
  it('refreshes once on first visit and never marks hidden activity read', async () => {
    const props = setup(); await waitFor(() => expect(props.actions?.refresh).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Unread' }));
    expect(screen.queryByText('Synthetic highlighted activity')).not.toBeInTheDocument(); expect(screen.getByText('Synthetic thread reply')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Mentions' }));
    expect(screen.getByText('Synthetic highlighted activity')).toBeVisible(); expect(screen.queryByText('Synthetic thread reply')).not.toBeInTheDocument();
    expect(props.onMarkRead).not.toHaveBeenCalled(); expect(props.onOpen).not.toHaveBeenCalled(); expect(props.actions?.refresh).toHaveBeenCalledTimes(1);
  });
  it('opens exact notification context and exposes explicit follow and pagination actions', async () => {
    const props = setup(); fireEvent.click(screen.getByRole('button', { name: /Synthetic highlighted activity/ }));
    await waitFor(() => expect(props.onOpen).toHaveBeenCalledWith({ roomId: 'welcome', eventId: '$mention' }));
    fireEvent.click(screen.getByRole('button', { name: 'My threads' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide from Home' }));
    await waitFor(() => expect(props.actions?.setThreadFollow).toHaveBeenCalledWith('welcome', '$root', false));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Load older activity' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Load older activity' })); await waitFor(() => expect(props.actions?.loadOlder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Check more threads' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Check more threads' })); await waitFor(() => expect(props.actions?.loadMoreThreads).toHaveBeenCalledTimes(1));
  });
  it('keeps coverage limitations and explicit settings and drafts entry points visible', () => {
    const props = setup(); const coverage = within(screen.getByRole('complementary', { name: 'Activity coverage' }));
    expect(coverage.getByText(/1 of 2 rooms checked/)).toBeVisible(); expect(coverage.getByText(/waiting for keys/)).toBeVisible(); expect(coverage.getByText(/retained activity limit/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Drafts (2)' })); expect(props.onDrafts).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Notification settings' })); expect(props.onSettings).toHaveBeenCalledOnce();
  });
  it('renders honest empty and unavailable states without fake history controls', () => {
    setup({ activity: undefined, actions: undefined }); expect(screen.getByText(/No matching activity/)).toBeVisible(); expect(screen.getByText(/Connect to Matrix/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Load older activity' })).not.toBeInTheDocument();
  });
  it('keeps visible items after a failed action and offers a safe retry error', async () => {
    const props = setup({ onOpen: vi.fn(async () => { throw new Error('Private failure'); }) });
    fireEvent.click(screen.getByRole('button', { name: /Synthetic highlighted activity/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That action could not finish.'); expect(screen.getByText('Synthetic highlighted activity')).toBeVisible(); expect(props.onOpen).toHaveBeenCalledOnce();
  });
});
