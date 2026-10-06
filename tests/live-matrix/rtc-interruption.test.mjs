import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPausedSfu } from './rtc-stack.mjs';

function fakeDocker(failingOperation) {
  const calls = [];
  return { calls, command: async (binary, args, options) => {
    calls.push({ binary, args, options });
    if (args[0] === failingOperation) throw new Error('synthetic-docker-failure');
  } };
}

test('SFU resumes after the reconnect assertion completes', async () => {
  const fake = fakeDocker();
  await withPausedSfu('synthetic-container', async () => {
    assert.deepEqual(fake.calls.map((call) => call.args[0]), ['pause']);
  }, fake.command);
  assert.deepEqual(fake.calls.map((call) => call.args), [['pause', 'synthetic-container'], ['unpause', 'synthetic-container']]);
  assert.ok(fake.calls.every((call) => call.binary === 'docker' && call.options.timeout === 10000));
});

test('assertion failure and bounded deadline both resume the SFU', async () => {
  for (const action of [async () => { throw new Error('synthetic-assertion'); }, () => new Promise(() => {})]) {
    const fake = fakeDocker();
    await assert.rejects(withPausedSfu('synthetic-container', action, fake.command, 10));
    assert.deepEqual(fake.calls.map((call) => call.args[0]), ['pause', 'unpause']);
  }
});

test('uncertain pause failure still attempts unpause; resume failures fail the check', async () => {
  for (const operation of ['pause', 'unpause']) {
    const fake = fakeDocker(operation);
    await assert.rejects(withPausedSfu('synthetic-container', async () => {}, fake.command));
    assert.deepEqual(fake.calls.map((call) => call.args[0]), ['pause', 'unpause']);
  }
});
