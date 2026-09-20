import { describe, expect, it, vi } from 'vitest';
import { StagedAttachments } from './stagedAttachments';

const room = { roomId: '!synthetic:test' };
const thread = { ...room, threadRootId: '$thread' };
const file = (name: string) => new File(['synthetic'], name, { type: 'text/plain', lastModified: 10 });
const deferred = () => { let resolve!: () => void; let reject!: () => void; const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
type Send = ConstructorParameters<typeof StagedAttachments>[0]['send'];
function setup(send = vi.fn<Send>(async () => {})) {
  const persist = vi.fn(); const cancel = vi.fn();
  return { queue: new StagedAttachments({ maxBytes: 1024, send, persist, cancel }), persist, send, cancel };
}

describe('staged attachment queue', () => {
  it('preserves ordered captions, independent failures and stable retry identity without resending successes', async () => {
    let rejectSecond = true;
    const send = vi.fn<Send>(async (_context, input, _progress, _language, options) => { if (input.name === 'second.txt' && rejectSecond) { rejectSecond = false; throw new Error('private transport detail'); } expect(options.signal?.aborted).toBe(false); });
    const { queue, persist } = setup(send);
    queue.stage(room, [file('first.txt'), file('second.txt'), file('third.txt')], 'text');
    const [first, second, third] = queue.list(room);
    queue.caption(third.id, 'Third caption'); queue.move(third.id, -1); queue.send(room);
    await vi.waitFor(() => expect(queue.list(room).map((item) => item.phase)).toEqual(['sent', 'sent', 'failed']));
    expect(send.mock.calls.map((call) => call[1].name)).toEqual(['first.txt', 'third.txt', 'second.txt']);
    expect(send.mock.calls[1][4]).toMatchObject({ caption: 'Third caption', id: third.id });
    expect(queue.list(room)[2].error).not.toContain('private');
    expect(persist.mock.lastCall?.[1]).toEqual([expect.objectContaining({ id: second.id, interrupted: true })]);
    queue.retry(second.id);
    await vi.waitFor(() => expect(queue.list(room).every((item) => item.phase === 'sent')).toBe(true));
    expect(send.mock.calls[3][4].id).toBe(second.id);
    expect(send.mock.calls.filter((call) => call[4].id === first.id)).toHaveLength(1);
    expect(queue.list(room).every((item) => !item.file)).toBe(true);
    expect(persist.mock.lastCall?.[1]).toEqual([]);
  });

  it('cancels the reserved item before its first phase and continues the queue', async () => {
    const gate = deferred();
    const send = vi.fn<Send>(async (_context, input, _progress, _language, options) => { if (input.name === 'first.txt') { await gate.promise; if (options.signal?.aborted) throw new Error('cancelled'); } });
    const { queue } = setup(send); queue.stage(room, [file('first.txt'), file('second.txt')]);
    const id = queue.list(room)[0].id; queue.send(room); queue.remove(id);
    expect(send.mock.calls[0][4].signal?.aborted).toBe(true); gate.resolve();
    await vi.waitFor(() => expect(queue.list(room).map((item) => item.phase)).toEqual(['sent']));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('refuses cancelling a submitted event and does not publish stale completion after account clear', async () => {
    const gate = deferred();
    const send = vi.fn<Send>(async (_context, _input, _progress, _language, options) => { options.onPhase?.('sending'); await gate.promise; });
    const { queue, persist } = setup(send); queue.stage(thread, [file('first.txt')]); queue.send(thread);
    queue.remove(queue.list(thread)[0].id); expect(queue.list(thread)).toHaveLength(1);
    queue.clear(); persist.mockClear(); gate.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(queue.list(thread)).toEqual([]); expect(persist).not.toHaveBeenCalled();
  });

  it('restores metadata only and requires matching files before retrying an interrupted send', () => {
    const { queue, send, persist } = setup();
    queue.restore(thread, [{ id: 'restored', name: 'old.txt', type: 'text/plain', size: 9, lastModified: 10, caption: 'Saved caption', interrupted: true }]);
    expect(queue.list(thread)[0]).toMatchObject({ phase: 'reattach', interrupted: true });
    expect(queue.list(thread)[0]).not.toHaveProperty('file');
    queue.send(thread); expect(send).not.toHaveBeenCalled();
    expect(queue.reattach('restored', file('different.txt'))).toContain('original file');
    expect(queue.reattach('restored', file('old.txt'))).toBeUndefined();
    expect(queue.list(thread)[0]).toMatchObject({ phase: 'staged', caption: 'Saved caption' });
    expect(persist.mock.lastCall?.[1][0]).not.toHaveProperty('file');
    expect(queue.list(room)).toEqual([]);
  });

  it('prunes accepted feedback before enforcing account capacity and bounds pending files per context', async () => {
    const { queue } = setup();
    for (let i = 0; i < 130; i++) {
      expect(queue.stage(room, [file(`file-${i}.txt`)])).toEqual([]); queue.send(room);
      await Promise.resolve();
      expect(queue.list(room).every((item) => item.phase === 'sent')).toBe(true);
    }
    expect(queue.list(room)).toHaveLength(1);
    expect(queue.stage(room, Array.from({ length: 21 }, (_, index) => file(`${index}.txt`)))).toHaveLength(1);
    expect(queue.list(room)).toHaveLength(20);
    expect(queue.stage(thread, [new File([], 'empty.txt')])[0]).toContain('Empty files');
  });
});
