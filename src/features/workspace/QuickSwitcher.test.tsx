import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickSwitcher } from './QuickSwitcher';
import { demoWorkspace } from '../../demo/demoWorkspace';
import type { RoomSummary, WorkspaceSnapshot } from '../../matrix/viewModels';

function snapshot(): WorkspaceSnapshot {
  const room = (id: string, name: string, extra: Partial<RoomSummary> = {}): RoomSummary => ({ ...demoWorkspace.rooms[0], id, name, kind: 'room', membership: 'join', badgeCount: 0, unreadCount: 0, highlighted: false, ...extra });
  return { ...demoWorkspace, spaces: [], rooms: [room('alpha', 'Alpha'), room('bravo', 'Bravo', { canonicalAlias: '#bravo:example.test' }), room('mara', 'Mara Chen', { kind: 'direct', directUserId: '@mara:example.test' })] };
}
const activeOption = () => document.getElementById(screen.getByRole('combobox').getAttribute('aria-activedescendant')!);

describe('QuickSwitcher', () => {
  it('focuses its named combobox and opens the chosen destination without leaving input focus', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    render(<QuickSwitcher workspace={snapshot()} recents={[]} onSelect={onSelect} onClose={onClose} />);
    const input = screen.getByRole('combobox', { name: 'Search rooms, people, and spaces' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-controls', screen.getByRole('listbox', { name: 'Destinations' }).id);
    expect(activeOption()).toHaveTextContent('Alpha');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeOption()).toHaveTextContent('Bravo');
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({ kind: 'room', id: 'bravo' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('supports Home, End, wrapping arrows, and Escape', () => {
    const onClose = vi.fn();
    render(<QuickSwitcher workspace={snapshot()} recents={[]} onSelect={vi.fn()} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'End' }); expect(activeOption()).toHaveTextContent('Mara Chen');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); expect(activeOption()).toHaveTextContent('Alpha');
    fireEvent.keyDown(input, { key: 'ArrowUp' }); expect(activeOption()).toHaveTextContent('Mara Chen');
    fireEvent.keyDown(input, { key: 'Home' }); expect(activeOption()).toHaveTextContent('Alpha');
    fireEvent.keyDown(input, { key: 'Escape' }); expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the active destination stable when snapshot ranking changes and safely replaces a removed destination', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    const initial = snapshot();
    const view = (workspace: WorkspaceSnapshot) => <QuickSwitcher workspace={workspace} recents={[]} onSelect={onSelect} onClose={onClose} />;
    const { rerender } = render(view(initial));
    const input = screen.getByRole('combobox');
    const updated = snapshot(); updated.rooms[1].badgeCount = 10;
    rerender(view(updated));
    expect(activeOption()).toHaveTextContent('Alpha');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(activeOption()).toHaveTextContent('Bravo');
    const removed = { ...updated, rooms: updated.rooms.filter((room) => room.id !== 'bravo') };
    rerender(view(removed)); expect(activeOption()).toHaveTextContent('Alpha');
    rerender(view(updated)); expect(activeOption()).toHaveTextContent('Alpha');
    expect(input).toHaveFocus();
  });

  it('filters aliases and people without duplicate DM rows and announces a truthful empty state', () => {
    render(<QuickSwitcher workspace={snapshot()} recents={[]} onSelect={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '#bravo' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(activeOption()).toHaveTextContent('#bravo:example.test');
    fireEvent.change(input, { target: { value: '@mara' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(activeOption()).toHaveTextContent('Person · direct message');
    expect(screen.getByRole('status')).toHaveTextContent('1 destination');
    fireEvent.change(input, { target: { value: 'not-in-this-account' } });
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-activedescendant');
    expect(screen.getByText(/No destinations match/)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('0 destinations');
  });

  it('does not select or dismiss while an IME composition is active', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    render(<QuickSwitcher workspace={snapshot()} recents={[]} onSelect={onSelect} onClose={onClose} />);
    const input = screen.getByRole('combobox');
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(activeOption()).toHaveTextContent('Alpha');
    expect(onSelect).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith({ kind: 'room', id: 'alpha' });
  });

  it('selects pointer results and exposes caller-provided footer actions', () => {
    const onSelect = vi.fn(); const onClose = vi.fn();
    render(<QuickSwitcher workspace={snapshot()} recents={[]} onSelect={onSelect} onClose={onClose}><button type="button">Keyboard shortcuts</button></QuickSwitcher>);
    const option = screen.getByRole('option', { name: /Bravo/ });
    fireEvent.mouseDown(option);
    expect(screen.getByRole('combobox')).toHaveFocus();
    fireEvent.click(option);
    expect(onSelect).toHaveBeenCalledWith({ kind: 'room', id: 'bravo' });
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeVisible();
  });

  it('restores the invoking composer when dismissed without navigating', async () => {
    const { rerender } = render(<textarea aria-label="Composer" />);
    screen.getByLabelText('Composer').focus();
    rerender(<><textarea aria-label="Composer" /><QuickSwitcher workspace={snapshot()} recents={[]} onSelect={vi.fn()} onClose={vi.fn()} /></>);
    expect(screen.getByRole('combobox')).toHaveFocus();
    rerender(<textarea aria-label="Composer" />);
    await act(async () => {});
    expect(screen.getByLabelText('Composer')).toHaveFocus();
  });

  it('limits the DOM to 50 results and distinguishes favorite and attention information', () => {
    const workspace = snapshot();
    workspace.rooms = Array.from({ length: 75 }, (_, index) => ({ ...workspace.rooms[0], id: `room-${index}`, name: `Room ${index}`, favorite: index === 0, badgeCount: index === 0 ? 2 : 0 }));
    render(<QuickSwitcher workspace={workspace} recents={[]} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getAllByRole('option')).toHaveLength(50);
    expect(screen.getByRole('status')).toHaveTextContent('Showing 50 destinations');
    const first = activeOption()!;
    expect(within(first).getByLabelText('Favorite')).toBeInTheDocument();
    expect(within(first).getByLabelText('2 unread')).toBeInTheDocument();
  });
});
