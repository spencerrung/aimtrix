import { describe, expect, it } from 'vitest';
import { VolatileDrafts } from './volatileDrafts';
describe('volatile drafts', () => {
  it('retains text for the same account, then clears it on account transition and forget', () => {
    const store = new VolatileDrafts();
    store.read('@one:test');
    store.write('@one:test', { room: 'synthetic draft' }, { thread: 'synthetic reply' });
    expect(store.read('@one:test').threads.thread).toBe('synthetic reply');
    expect(store.read('@two:test')).toEqual({ rooms: {}, threads: {} });
    store.write('@one:test', { room: 'late old draft' }, {});
    expect(store.read('@two:test').rooms).toEqual({});
    store.write('@two:test', { room: 'new draft' }, {});
    store.clear();
    expect(store.read('@two:test').rooms).toEqual({});
  });
});
