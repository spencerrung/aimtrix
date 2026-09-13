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
