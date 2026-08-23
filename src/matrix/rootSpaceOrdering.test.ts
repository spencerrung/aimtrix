import { describe, expect, it } from 'vitest';
import {
  createRootSpaceOrderContent,
  isValidMsc3230Order,
  sortRootSpaceIds,
} from './rootSpaceOrdering';

describe('isValidMsc3230Order', () => {
  it('accepts printable ASCII strings from 1 through 50 characters', () => {
    expect(isValidMsc3230Order(' ')).toBe(true);
    expect(isValidMsc3230Order('~'.repeat(50))).toBe(true);
    expect(isValidMsc3230Order('000042')).toBe(true);
  });

  it.each(['', 'a'.repeat(51), '\n', '\x1f', '\x7f', 'café', undefined, 42])(
    'rejects invalid order value %j',
    (value) => expect(isValidMsc3230Order(value)).toBe(false),
  );
});

describe('createRootSpaceOrderContent', () => {
  it('generates stable six-digit lexicographic order content', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `root-${index}`);
    const content = createRootSpaceOrderContent(ids);

    expect(content['root-0']).toEqual({ order: '000000' });
    expect(content['root-9']).toEqual({ order: '000009' });
    expect(content['root-11']).toEqual({ order: '000011' });
    expect(ids.map((id) => content[id].order).sort()).toEqual(ids.map((id) => content[id].order));
  });

  it('keeps the first position when input contains a duplicate ID', () => {
    expect(createRootSpaceOrderContent(['alpha', 'beta', 'alpha'])).toEqual({
      alpha: { order: '000000' },
      beta: { order: '000001' },
    });
  });
});

describe('sortRootSpaceIds', () => {
  it('sorts valid per-room orders ahead of roots without valid orders', () => {
    expect(sortRootSpaceIds(
      ['alpha', 'beta', 'gamma', 'delta'],
      {
        alpha: { order: '000020' },
        beta: { order: '\n' },
        gamma: { order: '000010' },
      },
    )).toEqual(['gamma', 'alpha', 'beta', 'delta']);
  });

  it('uses the legacy array for unordered roots without overriding MSC3230 order', () => {
    expect(sortRootSpaceIds(
      ['alpha', 'beta', 'gamma', 'delta'],
      new Map([['delta', '000000']]),
      ['gamma', 'alpha'],
    )).toEqual(['delta', 'gamma', 'alpha', 'beta']);
  });

  it('preserves original order for equal orders, unknown legacy IDs, and remaining roots', () => {
    expect(sortRootSpaceIds(
      ['charlie', 'alpha', 'bravo', 'delta'],
      { charlie: 'same', alpha: 'same' },
      ['missing', 'bravo'],
    )).toEqual(['charlie', 'alpha', 'bravo', 'delta']);
  });

  it('does not mutate its inputs', () => {
    const ids = ['beta', 'alpha'];
    const legacy = ['alpha', 'beta'];
    expect(sortRootSpaceIds(ids, {}, legacy)).toEqual(['alpha', 'beta']);
    expect(ids).toEqual(['beta', 'alpha']);
    expect(legacy).toEqual(['alpha', 'beta']);
  });
});
