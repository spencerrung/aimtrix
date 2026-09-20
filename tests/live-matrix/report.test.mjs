import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { makeReport } from './report.mjs';
const base = { revision: 'a'.repeat(40), platform: 'linux/x64', run: 1, probe: false, passed: false, failureStage: 'authenticated-encrypted-media', checks: [], metrics: {} };
test('diagnostics discard arbitrary error, response, identity and metric content', () => {
  const privateValue = randomBytes(24).toString('hex');
  const result = makeReport({ ...base, error: privateValue, accessToken: privateValue,
    checks: [{ name: 'authenticated-encrypted-media', passed: false, durationMs: 12.5, error: privateValue, category: privateValue }],
    metrics: { sendReceiveMs: privateValue, debug: privateValue, sharedBackdropMs: 50 },
  });
  assert.equal(JSON.stringify(result).includes(privateValue), false);
  assert.deepEqual(result.metrics, { sharedBackdropMs: 50 });
  assert.deepEqual(result.checks, [{ name: 'authenticated-encrypted-media', passed: false, durationMs: 13 }]);
});
test('unknown names and stages cannot carry room data into artifacts', () => {
  const privateValue = randomBytes(24).toString('hex');
  assert.throws(() => makeReport({ ...base, failureStage: privateValue }), /report-stage/);
  assert.throws(() => makeReport({ ...base, checks: [{ name: privateValue }] }), /report-check-name/);
});
test('only safe finite metrics and known metadata are retained', () => {
  const result = makeReport({ ...base, revision: 'not a revision', platform: 'a private host', metrics: { sendReceiveMs: NaN, sharedBackdropMs: Infinity, attachmentInputCount: -1 } });
  assert.equal(result.revision, 'unknown'); assert.equal(result.platform, 'other'); assert.deepEqual(result.metrics, {});
});
test('read-tracking evidence accepts its fixed check name but discards receipt and account data', () => {
  const privateValue = randomBytes(24).toString('hex');
  const name = 'private-read-tracking-and-reminders';
  const result = makeReport({ ...base, failureStage: name, checks: [{ name, passed: true, durationMs: 10,
    eventId: privateValue, userId: privateValue, receipts: [privateValue], accountData: { privateValue } }],
  });
  assert.deepEqual(result.checks, [{ name, passed: true, durationMs: 10 }]);
  assert.equal(JSON.stringify(result).includes(privateValue), false);
});
test('navigation evidence retains fixed checks without links, destinations, tags or reading anchors', () => {
  const privateValue = randomBytes(24).toString('hex');
  for (const name of ['standard-favorites-and-own-device-sync', 'matrix-links-and-navigation-history']) {
    const result = makeReport({ ...base, failureStage: name, checks: [{ name, passed: true, durationMs: 10,
      roomId: privateValue, link: privateValue, alias: privateValue, tags: { privateValue }, anchor: { eventId: privateValue } }],
    });
    assert.deepEqual(result.checks, [{ name, passed: true, durationMs: 10 }]);
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});

test('thread history evidence discards roots, replies, ciphertext, receipts and drafts', () => {
  const privateValue = randomBytes(24).toString('hex');
  const name = 'encrypted-thread-history-and-links';
  const result = makeReport({ ...base, failureStage: name, checks: [{ name, passed: true, durationMs: 10,
    rootId: privateValue, replyId: privateValue, ciphertext: privateValue, receipts: [privateValue], draft: privateValue }],
  });
  assert.deepEqual(result.checks, [{ name, passed: true, durationMs: 10 }]);
  assert.equal(JSON.stringify(result).includes(privateValue), false);
});

test('messaging evidence discards filenames, captions, drafts, bytes and formatted event payloads', () => {
  const privateValue = randomBytes(24).toString('hex');
  for (const name of ['encrypted-staged-attachments-and-retry', 'encrypted-thread-attachment', 'durable-room-thread-drafts-and-reattach', 'formatted-api-peer-interoperability']) {
    const result = makeReport({ ...base, failureStage: name, checks: [{ name, passed: true, durationMs: 10,
      filename: privateValue, caption: privateValue, bytes: [privateValue], draft: privateValue,
      formatted_body: privateValue, event: { content: privateValue }, transactionId: privateValue }],
    });
    assert.deepEqual(result.checks, [{ name, passed: true, durationMs: 10 }]);
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});
