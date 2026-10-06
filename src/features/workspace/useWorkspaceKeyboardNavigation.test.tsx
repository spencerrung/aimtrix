import { useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceKeyboardNavigation } from './useWorkspaceKeyboardNavigation';

function Example({ count = 3, context = false, media = false }: { count?: number; context?: boolean; media?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useWorkspaceKeyboardNavigation(root);
  return <div ref={root}>
    <header><button>Global navigation</button></header>
    <nav className="space-rail"><button>Spaces</button></nav>
    <aside className="buddy-panel"><button>Rooms</button></aside>
    <main className="conversation">
      <section className="timeline">{Array.from({ length: count }, (_, index) => <article data-keyboard-message tabIndex={-1} key={index} aria-label={`Message ${index}`}><p>Text {index}</p><button>Action {index}</button><a href="#target">Link {index}</a>{media ? <><audio controls aria-label={`Audio ${index}`} /><video controls aria-label={`Video ${index}`} /></> : null}</article>)}</section>
      <form className="composer"><textarea aria-label="Compose" /></form>
    </main>
    <aside hidden={!context} className="context-panel"><section className="thread-panel" hidden><h2 data-panel-heading tabIndex={-1}>Retained thread</h2><div className="thread-panel__timeline" /></section><h2 data-panel-heading tabIndex={-1}>Details</h2><button>Details action</button></aside>
  </div>;
}

beforeEach(() => { vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [{ width: 100, height: 44 }] as unknown as DOMRectList); });
afterEach(() => { vi.restoreAllMocks(); });

describe('workspace keyboard navigation', () => {
  it('bounds a populated timeline to one Tab entry and allows selected message controls', () => {
    const { container } = render(<Example count={250} />);
    const messages = [...container.querySelectorAll<HTMLElement>('article')];
    expect(messages.filter((node) => node.tabIndex === 0)).toHaveLength(1);
    expect(messages[249].querySelector('button')!).toHaveAttribute('tabindex', '-1');
    act(() => messages[0].focus());
    fireEvent.keyDown(messages[0], { key: 'End' });
    expect(messages[249]).toHaveFocus();
    fireEvent.keyDown(messages[249], { key: 'Enter' });
    expect(messages[249].querySelector('button')!).toHaveFocus();
    expect(messages[249].querySelector('a')!).not.toHaveAttribute('tabindex');
    expect(messages[0].querySelector('button')!).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(messages[249].querySelector('button')!).toHaveAttribute('tabindex', '-1');
  });

  it('keeps native media controls out of inactive rows and restores them on entry', () => {
    const { container } = render(<Example media />);
    const media = [...container.querySelectorAll('audio,video')];
    expect(media).toHaveLength(6);
    expect(media.every((node) => node.getAttribute('tabindex') === '-1')).toBe(true);
    const row = screen.getAllByRole('article')[1];
    act(() => row.focus());
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(row.querySelector('audio')).not.toHaveAttribute('tabindex');
    expect(row.querySelector('video')).not.toHaveAttribute('tabindex');
    expect(media[0]).toHaveAttribute('tabindex', '-1');
    act(() => screen.getByRole('textbox').focus());
    expect(media.every((node) => node.getAttribute('tabindex') === '-1')).toBe(true);
  });

  it('moves between visible sections, skips a retained hidden thread heading, and preserves editor arrows', () => {
    render(<Example context />);
    act(() => screen.getByRole('button', { name: 'Rooms' }).focus());
    fireEvent.keyDown(document.activeElement!, { key: 'F6' });
    expect(screen.getAllByRole('article')[0]).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'F6' });
    expect(screen.getByRole('textbox')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(screen.getByRole('textbox')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'F6' });
    expect(screen.getByRole('heading')).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'F6', shiftKey: true });
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('keeps traversal bounded when rows append and skips hidden context', async () => {
    const { rerender } = render(<Example />);
    act(() => screen.getAllByRole('article')[1].focus());
    rerender(<Example count={4} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Action 3' })).toHaveAttribute('tabindex', '-1'));
    expect(screen.getAllByRole('article').filter((node) => node.tabIndex === 0)).toEqual([screen.getAllByRole('article')[1]]);
    act(() => screen.getByRole('textbox').focus());
    fireEvent.keyDown(document.activeElement!, { key: 'F6' });
    expect(screen.getByRole('button', { name: 'Spaces' })).toHaveFocus();
  });

  it('leaves active menus and composition events alone', () => {
    render(<Example />);
    const row = screen.getAllByRole('article')[0];
    act(() => row.focus());
    const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); document.body.append(menu);
    fireEvent.keyDown(row, { key: 'F6' }); expect(row).toHaveFocus();
    menu.remove();
    fireEvent.keyDown(row, { key: 'ArrowDown', isComposing: true }); expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: 'ArrowDown', altKey: true }); expect(row).toHaveFocus();
  });

  it('starts backward section traversal at the last section from global navigation', () => {
    render(<Example context />);
    act(() => screen.getByRole('button', { name: 'Global navigation' }).focus());
    fireEvent.keyDown(document.activeElement!, { key: 'F6', shiftKey: true });
    expect(screen.getByRole('heading')).toHaveFocus();
  });

  it('preserves native keyboard handling while message text is selected', () => {
    render(<Example />);
    const row = screen.getAllByRole('article')[0];
    act(() => row.focus());
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(row.querySelector('p')!);
    selection.removeAllRanges(); selection.addRange(range);
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    row.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(row).toHaveFocus();
    selection.removeAllRanges();
  });
});
