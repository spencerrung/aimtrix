import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { defaultRuntimeConfig } from '../../config/runtimeConfig';
import { demoWorkspace } from '../../demo/demoWorkspace';
import { defaultUserPreferences } from '../../settings/preferences';
import { Workspace } from './Workspace';

type Props = ComponentProps<typeof Workspace>;
function setup(overrides: Partial<Props> = {}) {
  return render(<Workspace workspace={{ ...demoWorkspace, mode: 'matrix' }} config={defaultRuntimeConfig} theme="aqua" preferences={defaultUserPreferences} onThemeChange={vi.fn()} onPreferencesChange={vi.fn()} onSignOut={vi.fn()} {...overrides} />);
}
function type(element: HTMLElement, value: string) { element.textContent = value; fireEvent.input(element); }
beforeEach(() => { localStorage.clear(); vi.stubGlobal('innerWidth', 1280); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('room and thread composition routing', () => {
  it('edits the thread root in the visible phone composer without replacing the main draft', async () => {
    vi.stubGlobal('innerWidth', 412);
    const edit = vi.fn().mockResolvedValue(undefined);
    const { container } = setup({ onEditMessage: edit });
    fireEvent.click(screen.getByRole('button', { name: /Welcome Lounge/ }));
    const main = screen.getByRole('textbox', { name: 'Message Welcome Lounge' });
    type(main, 'Keep the room draft');
    fireEvent.click(screen.getByRole('button', { name: /2 replies/ }));
    const thread = screen.getByRole('complementary', { name: 'Thread' });
    const root = thread.querySelector<HTMLElement>('[data-event-id="m2"]')!;
    const editButton = within(root).getByRole('button', { name: 'Edit message' });
    fireEvent.pointerDown(editButton); editButton.focus(); fireEvent.click(editButton);
    expect(within(thread).getByText('Editing message')).toBeVisible();
    const composer = within(thread).getByRole('textbox', { name: 'Message thread' });
    expect(composer).toHaveTextContent('The goal: 2006 in spirit, 2026 where it matters.');
    await waitFor(() => expect(composer).toHaveFocus());
    type(composer, 'An edited root from the thread');
    fireEvent.click(within(thread).getByRole('button', { name: 'Send thread reply' }));
    await waitFor(() => expect(edit).toHaveBeenCalledWith('welcome', 'm2', 'An edited root from the thread', []));
    expect(container.querySelector('[aria-label="Message Welcome Lounge"]')).toHaveTextContent('Keep the room draft');
  });

  it('distinguishes a root reply in the main timeline from a root reply in the thread panel', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    setup({ onSendReply: reply });
    fireEvent.click(screen.getByRole('button', { name: /2 replies/ }));
    const main = screen.getByRole('main', { name: 'Conversation with Welcome Lounge' });
    const thread = screen.getByRole('complementary', { name: 'Thread' });
    fireEvent.click(within(main.querySelector<HTMLElement>('[data-event-id="m2"]')!).getByRole('button', { name: 'Reply' }));
    type(within(main).getByRole('textbox', { name: 'Message Welcome Lounge' }), 'Reply in the main room');
    fireEvent.click(within(main).getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(1));
    expect(reply.mock.calls[0][2]).toMatchObject({ id: 'm2', threadRootId: undefined });
    fireEvent.click(within(thread.querySelector<HTMLElement>('[data-event-id="m2"]')!).getByRole('button', { name: 'Reply' }));
    type(within(thread).getByRole('textbox', { name: 'Message thread' }), 'Reply inside the thread');
    fireEvent.click(within(thread).getByRole('button', { name: 'Send thread reply' }));
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(2));
    expect(reply.mock.calls[1][2]).toMatchObject({ id: 'm2', threadRootId: 'm2' });
  });

  it('opens a real composer for the first reply to a root without a thread snapshot', async () => {
    const select = vi.fn().mockResolvedValue(undefined), send = vi.fn().mockResolvedValue(undefined);
    setup({ onThreadSelected: select, onSendThreadMessage: send });
    const main = screen.getByRole('main', { name: 'Conversation with Welcome Lounge' });
    fireEvent.click(within(main.querySelector<HTMLElement>('[data-event-id="m1"]')!).getByRole('button', { name: 'Reply in thread' }));
    const thread = screen.getByRole('complementary', { name: 'Thread' });
    const composer = within(thread).getByRole('textbox', { name: 'Message thread' });
    expect(within(thread).getByText('0 replies')).toBeVisible();
    await waitFor(() => expect(select).toHaveBeenCalledWith('welcome', 'm1', undefined));
    type(composer, 'The first reply');
    fireEvent.click(within(thread).getByRole('button', { name: 'Send thread reply' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith('welcome', 'm1', 'The first reply', []));
  });
});
