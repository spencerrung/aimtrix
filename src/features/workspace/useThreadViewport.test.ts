import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreadSummary } from '../../matrix/viewModels';
import { useThreadViewport } from './useThreadViewport';

type Options = Parameters<typeof useThreadViewport>[0];
type Viewport = ReturnType<typeof useThreadViewport>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function thread(revision = 1, rootId = '$root'): ThreadSummary {
  return {
    rootId, roomId: '!room:test', rootStatus: 'found', replyCount: 2,
    messages: ['$old', '$target'].map((id) => ({ id, roomId: '!room:test', threadRootId: rootId, senderId: '@synthetic:test', senderName: 'Synthetic', body: id, timestamp: 1, kind: 'text', isOwn: false })),
    history: { mode: 'live', revision, canLoadOlder: true, canLoadNewer: false },
  };
}

function mount(options: Options) {
  let value!: Viewport;
  const Harness = (props: Options) => {
    value = useThreadViewport(props);
    return createElement('div', { ref: value.viewport, 'data-timeline': true }, props.thread?.messages.map((message) =>
      createElement('div', { key: message.id, 'data-event-id': message.id, 'data-message-key': message.id, tabIndex: -1 }, message.body)));
  };
  const rendered = render(createElement(Harness, options));
  return { ...rendered, get current() { return value; }, update: (next: Options) => rendered.rerender(createElement(Harness, next)) };
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(200);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.hasAttribute('data-timeline') ? 0 : this.dataset.eventId === '$old' ? 30 : 350;
    const height = this.hasAttribute('data-timeline') ? 200 : 40;
    return { top, bottom: top + height, height, width: 400, left: 0, right: 400, x: 0, y: top, toJSON: () => ({}) };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('thread viewport navigation', () => {
  it('does not capture old rows before the initial context request starts', async () => {
    const pending = deferred();
    const open = vi.fn().mockReturnValue(pending.promise);
    const remember = vi.fn();
    const view = mount({ roomId: '!room:test', thread: thread(), active: true, entryId: 1, eventId: '$target', open, remember });
    expect(remember).not.toHaveBeenCalled();
    expect(view.current.canRead()).toBe(false);
    await waitFor(() => expect(open).toHaveBeenCalledWith('$target'));
    expect(remember).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
  });

  it('gives a new explicit reply link precedence over the same thread’s remembered position', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const remember = vi.fn();
    const options: Options = { roomId: '!room:test', thread: thread(), active: true, entryId: 1, open, remember };
    const view = mount(options);
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    await act(async () => {});
    view.update({ ...options, thread: thread(2) });
    await waitFor(() => expect(view.current.busy).toBe(false));
    view.current.viewport.current!.scrollTop = 100;
    act(() => view.current.capture());
    expect(remember).toHaveBeenLastCalledWith(expect.objectContaining({ anchor: { eventId: '$old', offset: 30 } }), 1);
    view.update({ ...options, thread: thread(2), entryId: 2, eventId: '$target' });
    await waitFor(() => expect(open).toHaveBeenLastCalledWith('$target'));
  });

  it('waits for a committed revision after the request resolves even if the old target already matches', async () => {
    const pending = deferred();
    const open = vi.fn().mockReturnValue(pending.promise);
    const remember = vi.fn();
    const old = thread(); old.history = { ...old.history!, mode: 'context', targetEventId: '$target', targetStatus: 'found' };
    const options: Options = { roomId: '!room:test', thread: old, active: true, entryId: 1, eventId: '$target', open, remember };
    const view = mount(options);
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    remember.mockClear();
    await act(async () => pending.resolve());
    expect(view.current.busy).toBe(true);
    expect(remember).not.toHaveBeenCalled();
    view.update({ ...options, thread: { ...old, history: { ...old.history!, revision: 2 } } });
    await waitFor(() => expect(view.current.busy).toBe(false));
    expect(view.container.querySelector('[data-event-id="$target"]')).toHaveFocus();
  });

  it('does not invoke an old scheduled operation against a newly selected thread', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const oldLatest = vi.fn().mockResolvedValue(undefined);
    const newLatest = vi.fn().mockResolvedValue(undefined);
    const options: Options = { roomId: '!room:test', thread: thread(), active: true, entryId: 1, open, latest: oldLatest, remember: vi.fn() };
    const view = mount(options);
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    await act(async () => {});
    view.update({ ...options, thread: thread(2) });
    await waitFor(() => expect(view.current.busy).toBe(false));
    act(() => {
      view.current.latest();
      view.update({ ...options, thread: thread(1, '$other-root'), entryId: 2, latest: newLatest });
    });
    await act(async () => {});
    expect(oldLatest).not.toHaveBeenCalled();
    expect(newLatest).not.toHaveBeenCalled();
  });

  it('never captures, scrolls, or focuses new arrivals while its thread is hidden', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const remember = vi.fn();
    const close = vi.fn();
    const options: Options = { roomId: '!room:test', thread: thread(), active: true, entryId: 1, open, close, remember };
    const view = mount(options);
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    await act(async () => {});
    view.update({ ...options, thread: thread(2) });
    await waitFor(() => expect(view.current.busy).toBe(false));
    view.update({ ...options, active: false, thread: thread(3) });
    const timeline = view.current.viewport.current!;
    timeline.scrollTop = 100;
    remember.mockClear();
    act(() => { view.current.capture(); view.current.restore(); });
    expect(remember).not.toHaveBeenCalled();
    expect(timeline.scrollTop).toBe(100);
    expect(close).toHaveBeenCalledOnce();
    expect(view.current.canRead()).toBe(false);
  });

  it('retries a failed jump to latest rather than reopening its older context target', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const latest = vi.fn().mockResolvedValue(undefined);
    const initial = thread(); initial.history = { ...initial.history!, mode: 'context', targetEventId: '$target', targetStatus: 'found' };
    const options: Options = { roomId: '!room:test', thread: initial, active: true, entryId: 1, eventId: '$target', open, latest, remember: vi.fn() };
    const view = mount(options);
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    await act(async () => {});
    view.update({ ...options, thread: { ...initial, history: { ...initial.history!, revision: 2 } } });
    await waitFor(() => expect(view.current.busy).toBe(false));
    act(() => view.current.latest());
    await waitFor(() => expect(latest).toHaveBeenCalledOnce());
    await act(async () => {});
    view.update({ ...options, thread: { ...initial, history: { ...initial.history!, revision: 3, error: 'Synthetic latest failure', errorDirection: 'latest' } } });
    await waitFor(() => expect(view.current.busy).toBe(false));
    act(() => view.current.retry());
    await waitFor(() => expect(latest).toHaveBeenCalledTimes(2));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('preserves later composer focus when a pending reply target finally publishes', async () => {
    const pending = deferred();
    const options: Options = { roomId: '!room:test', thread: thread(), active: true, entryId: 1, eventId: '$target', open: vi.fn().mockReturnValue(pending.promise), remember: vi.fn() };
    const view = mount(options);
    await waitFor(() => expect(options.open).toHaveBeenCalledOnce());
    const composer = document.createElement('textarea');
    view.container.append(composer);
    composer.focus();
    await act(async () => pending.resolve());
    view.update({ ...options, thread: { ...thread(2), history: { ...thread(2).history!, mode: 'context', targetEventId: '$target', targetStatus: 'found' } } });
    await waitFor(() => expect(view.current.busy).toBe(false));
    expect(composer).toHaveFocus();
  });
  it('keeps the historical reading anchor when jumping to latest fails', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const latest = vi.fn().mockResolvedValue(undefined);
    const initial = thread(); initial.history!.mode = 'history';
    const options: Options = { roomId: '!room:test', thread: initial, active: true, entryId: 1, open, latest, remember: vi.fn() };
    const view = mount(options);
    await waitFor(() => expect(open).toHaveBeenCalledOnce());
    view.update({ ...options, thread: { ...initial, history: { ...initial.history!, revision: 2 } } });
    await waitFor(() => expect(view.current.busy).toBe(false));
    const timeline = view.current.viewport.current!;
    timeline.scrollTop = 100;
    act(() => { view.current.capture(); view.current.latest(); });
    await waitFor(() => expect(latest).toHaveBeenCalledOnce());
    view.update({ ...options, thread: { ...initial, history: { ...initial.history!, revision: 3, error: 'Synthetic latest failure', errorDirection: 'latest' } } });
    await waitFor(() => expect(view.current.busy).toBe(false));
    expect(timeline.scrollTop).toBe(100);
    expect(view.current.canRead()).toBe(false);
  });

});
