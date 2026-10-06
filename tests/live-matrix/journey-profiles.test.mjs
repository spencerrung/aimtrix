import { URL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { journeyChecks, historyChecks, expectedJourneyChecks, assertJourneyCoverage } from './journey-profiles.mjs';

test('manifest contains every declared journey check in execution order', () => {
  const source = readFileSync(new URL('./journeys.mjs', import.meta.url), 'utf8');
  const names = [...source.matchAll(/await check\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(journeyChecks, names);
  assert.equal(new Set(names).size, names.length);
});
test('core and history jointly preserve every full local check', () => {
  for (const element of [false, true]) {
    const core = expectedJourneyChecks('core', element);
    const history = expectedJourneyChecks('history');
    const full = expectedJourneyChecks('full', element);
    assert.deepEqual([...new Set([...core, ...history])].sort(), [...full].sort());
    assert.deepEqual(full.filter((name) => !core.includes(name)), historyChecks);
  }
});
test('history executes exact prerequisites and every dependent assertion', () => {
  assert.deepEqual(expectedJourneyChecks('history'), [
    'isolated-accounts', 'password-login-three-devices', 'encrypted-room-create-and-join',
    'encrypted-send-receive-and-latency', 'encrypted-retry-reconnect-and-cancel', 'encrypted-thread-retry',
    ...historyChecks,
  ]);
});
test('coverage rejects missing, duplicated, reordered and unexpected checks', () => {
  const expected = expectedJourneyChecks('history');
  assert.doesNotThrow(() => assertJourneyCoverage(expected, 'history', false));
  assert.throws(() => assertJourneyCoverage(expected.slice(0, -1), 'history', false));
  assert.throws(() => assertJourneyCoverage([...expected, expected[0]], 'history', false));
  assert.throws(() => assertJourneyCoverage([...expected].reverse(), 'history', false));
  assert.throws(() => assertJourneyCoverage([...expected, 'private-profile-save'], 'history', false));
  assert.throws(() => expectedJourneyChecks('unknown'));
  assert.throws(() => expectedJourneyChecks('history', true));
});

test('custom reaction protocol coverage runs in existing core jobs without history overhead', () => {
  for (const element of [false, true]) {
    assert.ok(expectedJourneyChecks('core', element).includes('standard-custom-mxc-reaction'));
    assert.ok(expectedJourneyChecks('full', element).includes('standard-custom-mxc-reaction'));
  }
  assert.ok(!expectedJourneyChecks('history').includes('standard-custom-mxc-reaction'));
});
