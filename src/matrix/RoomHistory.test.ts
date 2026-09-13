import { describe, expect, it, vi } from 'vitest';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { MatrixEvent } from 'matrix-js-sdk/lib/models/event.js';
import { EventTimeline } from 'matrix-js-sdk/lib/models/event-timeline.js';
import { RoomHistory, type HistoryView } from './RoomHistory';
import { isVisibleTimelineEvent } from './historyEvents';

function message(index: number, roomId = '!history:test'): MatrixEvent {
  return new MatrixEvent({ event_id: `$message-${index}`, room_id: roomId, sender: '@synthetic:test', origin_server_ts: index,
    type: 'm.room.message', content: { msgtype: 'm.text', body: `Synthetic message ${index}` } });
}
function reaction(index: number, target = '$message-349'): MatrixEvent {
  return new MatrixEvent({ event_id: `$reaction-${index}`, room_id: '!history:test', sender: '@synthetic:test', type: 'm.reaction',
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: target, key: 'synthetic' } } });
}
class TestTimeline {
  public baseIndex = 0;
  public backward: string | null = null;
  public forward: string | null = null;
  public previous?: TestTimeline;
  public next?: TestTimeline;
  public constructor(public events: MatrixEvent[]) {}
  public getEvents() { return this.events; }
  public getBaseIndex() { return this.baseIndex; }
  public getPaginationToken(direction: string) { return direction === 'b' ? this.backward : this.forward; }
  public getNeighbouringTimeline(direction: string) { return (direction === 'b' ? this.previous : this.next)?.sdk ?? null; }
  public prepend(events: MatrixEvent[]) { this.events.unshift(...events); this.baseIndex += events.length; }
  public get sdk() { return this as unknown as EventTimeline; }
}
function fixture(events: MatrixEvent[] = Array.from({ length: 350 }, (_, index) => message(index))) {
  let live = new TestTimeline(events);
  const timelines = [live];
  let membership = 'join';
  const room = {
    roomId: '!history:test', getMyMembership: () => membership,
    getLiveTimeline: () => live.sdk,
    getUnfilteredTimelineSet: () => ({ getTimelineForEvent: (id: string) => timelines.find((timeline) => timeline.events.some((event) => event.getId() === id))?.sdk }),
  } as unknown as Room;
  const client = {
    getRoom: vi.fn((id: string) => id === room.roomId ? room : null),
    getEventTimeline: vi.fn(async () => live.sdk as EventTimeline | null),
    paginateEventTimeline: vi.fn(async () => false),
    decryptEventIfNeeded: vi.fn<(event: MatrixEvent) => Promise<void>>().mockResolvedValue(undefined),
  };
  let activeClient = client as unknown as MatrixClient | undefined;
  const views = new Map<string, HistoryView>();
  const publish = vi.fn();
  const history = new RoomHistory(() => activeClient, views, publish);
  return {
    history, client, room, live, timelines, views, publish,
    ids: () => views.get(room.roomId)!.events.filter(isVisibleTimelineEvent).map((event) => event.getId()),
    state: () => views.get(room.roomId)!.state,
    replaceClient: () => { activeClient = undefined; },
    leave: () => { membership = 'leave'; },
    reset: (next: TestTimeline) => { live = next; timelines.push(next); },
  };
}
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('RoomHistory', () => {
  it('navigates both ways through more than 350 visible messages without relations consuming capacity', async () => {
    const events = Array.from({ length: 400 }, (_, index) => [message(index), reaction(index, `$message-${index}`)]).flat();
    const test = fixture(events);
    await test.history.open(test.room.roomId);
    expect(test.ids()).toHaveLength(250);
    expect(test.ids()[0]).toBe('$message-150');
    expect(test.views.get(test.room.roomId)!.events.filter((event) => event.getType() === 'm.reaction')).toHaveLength(250);
    await test.history.load(test.room.roomId);
    expect(test.ids()[0]).toBe('$message-100');
    expect(test.ids().at(-1)).toBe('$message-349');
    expect(test.state()).toMatchObject({ mode: 'history', canLoadOlder: true, canLoadNewer: true });
    await test.history.load(test.room.roomId, 'forward');
    expect(test.ids()[0]).toBe('$message-150');
    expect(test.ids().at(-1)).toBe('$message-399');
    expect(test.state().canLoadNewer).toBe(false);
    expect(test.client.paginateEventTimeline).not.toHaveBeenCalled();
  });

  it('crosses relation-only network pages without consuming visible capacity', async () => {
    const test = fixture([message(100)]);
    test.live.backward = 'older-1';
    let requests = 0;
    test.client.paginateEventTimeline.mockImplementation(async () => {
      requests += 1;
      if (requests === 1) {
        test.live.prepend(Array.from({ length: 60 }, (_, index) => reaction(index, '$message-100')));
        test.live.backward = 'older-2';
        return true;
      }
      test.live.prepend(Array.from({ length: 50 }, (_, index) => message(index)));
      test.live.backward = null;
      return false;
    });
    await test.history.open(test.room.roomId);
    await test.history.load(test.room.roomId);
    expect(test.ids()).toHaveLength(51);
    expect(test.ids()[0]).toBe('$message-0');
    expect(test.state().canLoadOlder).toBe(false);
    expect(test.client.paginateEventTimeline).toHaveBeenCalledTimes(2);
    expect(test.client.decryptEventIfNeeded).toHaveBeenCalledTimes(110);
  });

  it('does not skip newer messages when a late relation survives trimming its surrounding messages', async () => {
    const test = fixture([...Array.from({ length: 400 }, (_, index) => message(index)), reaction(999, '$message-250')]);
    await test.history.open(test.room.roomId);
    await test.history.load(test.room.roomId);
    expect(test.ids().at(-1)).toBe('$message-349');
    expect(test.views.get(test.room.roomId)!.events.at(-1)?.getId()).toBe('$reaction-999');
    expect(test.state().canLoadNewer).toBe(true);
    await test.history.load(test.room.roomId, 'forward');
    expect(test.ids()).toContain('$message-350');
    expect(test.ids().at(-1)).toBe('$message-399');
  });

  it('continues filling a page when decryption reveals a hidden relation', async () => {
    const test = fixture([message(100)]);
    const encrypted = new MatrixEvent({ event_id: '$encrypted-relation', room_id: test.room.roomId, sender: '@synthetic:test', type: 'm.room.encrypted', content: { ciphertext: 'synthetic-ciphertext' } });
    let decrypted = false;
    vi.spyOn(encrypted, 'getType').mockImplementation(() => decrypted ? 'm.reaction' : 'm.room.encrypted');
    test.live.backward = 'encrypted-page';
    test.client.paginateEventTimeline.mockImplementation(async () => {
      test.live.prepend([...Array.from({ length: 50 }, (_, index) => message(index)), encrypted]);
      test.live.backward = null;
      return false;
    });
    test.client.decryptEventIfNeeded.mockImplementation(async (event) => { if (event === encrypted) decrypted = true; });
    await test.history.load(test.room.roomId);
    expect(test.ids()).toHaveLength(51);
    expect(test.ids()[0]).toBe('$message-0');
    expect(test.ids()).not.toContain('$encrypted-relation');
  });

  it('walks neighbouring SDK timelines and preserves cursor position when events are removed', async () => {
    const test = fixture(Array.from({ length: 300 }, (_, index) => message(index)));
    const older = new TestTimeline(Array.from({ length: 100 }, (_, index) => message(index - 100)));
    older.next = test.live; test.live.previous = older;
    test.timelines.push(older);
    await test.history.open(test.room.roomId);
    await test.history.load(test.room.roomId);
    await test.history.load(test.room.roomId);
    expect(test.ids()[0]).toBe('$message--50');
    expect(test.ids().at(-1)).toBe('$message-199');
    test.live.events.splice(test.live.events.findIndex((event) => event.getId() === '$message-120'), 1);
    await test.history.load(test.room.roomId, 'forward');
    expect(test.ids()).toContain('$message-200');
    expect(test.ids().at(-1)).toBe('$message-249');
    expect(test.client.paginateEventTimeline).not.toHaveBeenCalled();
  });

  it('invalidates a pending page when another room becomes active and reactivates detached history on revisit', async () => {
    const test = fixture([message(100)]);
    test.live.backward = 'older';
    const secondTimeline = new TestTimeline([message(200, '!second:test')]);
    const second = { ...test.room, roomId: '!second:test', getLiveTimeline: () => secondTimeline.sdk } as Room;
    test.client.getRoom.mockImplementation((id) => id === second.roomId ? second : test.room);
    const page = deferred<boolean>();
    test.client.paginateEventTimeline.mockReturnValue(page.promise);
    const request = test.history.load(test.room.roomId);
    await test.history.open(second.roomId);
    page.resolve(false); await request;
    expect(test.state()).toMatchObject({ mode: 'history', loading: undefined });
    expect(test.ids()).toEqual(['$message-100']);
    await test.history.open(test.room.roomId);
    expect(test.state().mode).toBe('history');
    await test.history.latest(test.room.roomId);
    const revision = test.state().revision;
    await test.history.latest(test.room.roomId);
    expect(test.state().revision).toBeGreaterThan(revision);
  });

  it('stops a relation-only request budget without claiming history is exhausted', async () => {
    const test = fixture([message(100)]);
    test.live.backward = 'page-0';
    let page = 0;
    test.client.paginateEventTimeline.mockImplementation(async () => {
      test.live.prepend([reaction(page++)]);
      test.live.backward = `page-${page}`;
      return true;
    });
    await test.history.open(test.room.roomId);
    await test.history.load(test.room.roomId);
    expect(test.client.paginateEventTimeline).toHaveBeenCalledTimes(10);
    expect(test.state()).toMatchObject({ canLoadOlder: true, loading: undefined, error: undefined });
    expect(test.ids()).toEqual(['$message-100']);
  });

  it('stops repeated tokens and preserves a directional retry after a network error', async () => {
    const test = fixture([message(100)]);
    test.live.backward = 'unchanged';
    test.client.paginateEventTimeline.mockResolvedValue(true);
    await test.history.open(test.room.roomId);
    await test.history.load(test.room.roomId);
    expect(test.client.paginateEventTimeline).toHaveBeenCalledTimes(1);
    test.client.paginateEventTimeline.mockRejectedValue(new Error('private homeserver diagnostic'));
    await test.history.load(test.room.roomId);
    expect(test.state()).toMatchObject({ errorDirection: 'backward', loading: undefined, canLoadOlder: true });
    expect(JSON.stringify(test.state())).not.toContain('private homeserver');
    expect(test.ids()).toEqual(['$message-100']);
  });

  it('opens bounded context on a detached SDK timeline and returns to the current live timeline', async () => {
    const test = fixture();
    const old = new TestTimeline(Array.from({ length: 200 }, (_, index) => message(index - 500)));
    test.timelines.push(old);
    test.client.getEventTimeline.mockResolvedValue(old.sdk);
    await test.history.open(test.room.roomId);
    await test.history.context(test.room.roomId, '$message--400');
    expect(test.ids()).toHaveLength(51);
    expect(test.ids()[25]).toBe('$message--400');
    expect(test.state()).toMatchObject({ mode: 'context', targetStatus: 'found', canLoadOlder: true, canLoadNewer: true });
    const detachedIds = test.ids();
    const newer = new TestTimeline([message(500)]);
    test.reset(newer);
    test.history.refresh(test.room);
    expect(test.ids()).toEqual(detachedIds);
    await test.history.latest(test.room.roomId);
    expect(test.ids()).toEqual(['$message-500']);
    expect(test.state()).toMatchObject({ mode: 'live', targetEventId: undefined, error: undefined });
  });

  it('fills a zero-context response with bounded SDK pagination on both sides', async () => {
    const test = fixture();
    const context = new TestTimeline([message(-100)]);
    context.backward = 'before'; context.forward = 'after';
    test.timelines.push(context);
    test.client.getEventTimeline.mockResolvedValue(context.sdk);
    test.client.paginateEventTimeline.mockImplementation(async (...args: unknown[]) => {
      const options = args[1] as { backwards: boolean };
      if (options.backwards) {
        context.prepend(Array.from({ length: 30 }, (_, index) => message(index - 130)));
        context.backward = null;
      } else {
        context.events.push(...Array.from({ length: 30 }, (_, index) => message(index - 99)));
        context.forward = null;
      }
      return false;
    });
    await test.history.context(test.room.roomId, '$message--100');
    expect(test.ids()).toHaveLength(51);
    expect(test.ids()[25]).toBe('$message--100');
    expect(test.client.paginateEventTimeline).toHaveBeenCalledTimes(2);
  });

  it.each(['missing', 'removed', 'unrendered'] as const)('keeps the prior selection when a target is %s', async (kind) => {
    const test = fixture();
    await test.history.open(test.room.roomId);
    const before = test.ids();
    const target = kind === 'unrendered' ? reaction(-1) : message(-1);
    if (kind === 'removed') target.makeRedacted(new MatrixEvent({ type: 'm.room.redaction', content: {} }), test.room);
    test.client.getEventTimeline.mockResolvedValue(kind === 'missing' ? null : new TestTimeline([target]).sdk);
    await test.history.context(test.room.roomId, target.getId()!);
    expect(test.ids()).toEqual(before);
    expect(test.state()).toMatchObject({ targetStatus: kind === 'removed' ? 'removed' : 'unavailable', loading: undefined, errorDirection: 'context' });
  });

  it('keeps an encrypted target visible when keys are unavailable and awaits decryption before accepting context', async () => {
    const test = fixture();
    const encrypted = new MatrixEvent({ event_id: '$encrypted', room_id: test.room.roomId, sender: '@synthetic:test', type: 'm.room.encrypted', content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: 'synthetic-ciphertext' } });
    const context = new TestTimeline([encrypted]);
    test.client.getEventTimeline.mockResolvedValue(context.sdk);
    const decryption = deferred<void>();
    test.client.decryptEventIfNeeded.mockImplementation(() => decryption.promise);
    const request = test.history.context(test.room.roomId, '$encrypted');
    await vi.waitFor(() => expect(test.client.decryptEventIfNeeded).toHaveBeenCalled());
    expect(test.state().loading).toBe('context');
    decryption.reject(new Error('Synthetic missing keys'));
    await request;
    expect(test.ids()).toEqual(['$encrypted']);
    expect(test.state().targetStatus).toBe('found');
  });

  it('ignores an old context response after return to live and after session replacement', async () => {
    const test = fixture();
    const response = deferred<EventTimeline | null>();
    test.client.getEventTimeline.mockReturnValue(response.promise);
    const context = test.history.context(test.room.roomId, '$old-target');
    await test.history.latest(test.room.roomId);
    const before = test.ids();
    response.resolve(new TestTimeline([message(-1)]).sdk);
    await context;
    expect(test.ids()).toEqual(before);
    expect(test.state().mode).toBe('live');
    const stale = deferred<EventTimeline | null>();
    test.client.getEventTimeline.mockReturnValue(stale.promise);
    const next = test.history.context(test.room.roomId, '$old-target');
    test.replaceClient(); test.history.clear();
    stale.reject(new Error('Private diagnostic'));
    await next;
    expect(test.views.size).toBe(0);
  });

  it('invalidates pending history when membership changes and never fetches a left room', async () => {
    const test = fixture([message(100)]);
    test.live.backward = 'older';
    const page = deferred<boolean>();
    test.client.paginateEventTimeline.mockReturnValue(page.promise);
    const request = test.history.load(test.room.roomId);
    test.leave(); test.history.refresh(test.room);
    page.resolve(false);
    await request;
    expect(test.views.size).toBe(0);
    await expect(test.history.context(test.room.roomId, '$message-100')).rejects.toThrow('not available');
    expect(test.client.getEventTimeline).not.toHaveBeenCalled();
  });

  it('freezes live arrival while detached and follows a reset only after returning live', async () => {
    const test = fixture([message(1)]);
    await test.history.open(test.room.roomId);
    test.history.detach(test.room.roomId, true);
    test.live.events.push(message(2));
    test.history.refresh(test.room);
    expect(test.ids()).toEqual(['$message-1']);
    expect(test.state().canLoadNewer).toBe(true);
    const reset = new TestTimeline([message(3)]);
    test.reset(reset); test.history.refresh(test.room);
    expect(test.ids()).toEqual(['$message-1']);
    await test.history.latest(test.room.roomId);
    reset.events.push(message(4)); test.history.refresh(test.room);
    expect(test.ids()).toEqual(['$message-3', '$message-4']);
  });
});
