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
  const result = makeReport({ ...base, revision: 'not a revision', platform: 'a private host', browserVersion: 'a private browser',
    cpuCount: -1, memoryGiB: Infinity, metrics: { sendReceiveMs: NaN, sharedBackdropMs: Infinity, attachmentInputCount: -1 } });
  assert.equal(result.revision, 'unknown'); assert.equal(result.platform, 'other');
  assert.equal(result.browserVersion, 'unknown'); assert.equal(result.cpuCount, 0); assert.equal(result.memoryGiB, 0);
  assert.deepEqual(result.metrics, {});
});
test('hardware and browser metadata retain bounded values', () => {
  const result = makeReport({ ...base, browserVersion: '149.0.7827.55', cpuCount: 8, memoryGiB: 31 });
  assert.equal(result.browserVersion, '149.0.7827.55');
  assert.equal(result.cpuCount, 8); assert.equal(result.memoryGiB, 31);
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
  for (const name of ['encrypted-staged-attachments-and-retry', 'encrypted-thread-attachment', 'durable-room-thread-drafts-and-reattach', 'formatted-api-peer-interoperability', 'encrypted-poll-create', 'encrypted-poll-vote', 'encrypted-poll-end', 'encrypted-location-interop', 'encrypted-voice-interop', 'saved-reference-own-device-and-context', 'shared-pins-and-member-permission', 'old-cross-room-server-search-and-context', 'private-encrypted-search-key-availability', 'withheld-key-guidance-live', 'confirmed-recovery-reset-and-key-replacement']) {
    const result = makeReport({ ...base, failureStage: name, checks: [{ name, passed: true, durationMs: 10,
      filename: privateValue, caption: privateValue, bytes: [privateValue], draft: privateValue, passphrase: privateValue,
      formatted_body: privateValue, event: { content: privateValue }, transactionId: privateValue,
      senderKey: privateValue, sessionId: privateValue, recoveryKey: privateValue }],
    });
    assert.deepEqual(result.checks, [{ name, passed: true, durationMs: 10 }]);
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});

test('optional Element evidence records the pinned client without session or rendered content', () => {
  const privateValue = randomBytes(24).toString('hex');
  for (const name of ['element-ui-formatted-interoperability', 'element-ui-encrypted-room', 'element-ui-encrypted-message', 'element-ui-incoming-sas-verification', 'element-ui-incoming-qr-verification', 'element-ui-aimtrix-declines-verification', 'element-ui-withdraws-verification', 'element-ui-encrypted-poll', 'element-ui-poll-vote', 'element-ui-poll-vote-replaced', 'element-ui-poll-ended', 'element-ui-unencrypted-poll-roundtrip', 'element-ui-encrypted-location', 'element-ui-location-to-aimtrix', 'element-ui-encrypted-voice', 'element-ui-encrypted-voice-playback']) {
    const result = makeReport({ ...base, elementUi: true, failureStage: name, checks: [{ name, passed: true,
      storage: privateValue, renderedContent: privateValue, screenshot: privateValue, accessToken: privateValue }],
    });
    assert.match(result.images.element, /^vectorim\/element-web:v[0-9.]+@sha256:[a-f0-9]{64}$/);
    assert.equal('element' in makeReport(base).images, false);
    assert.deepEqual(result.checks, [{ name, passed: true }]);
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});

test('attention evidence discards notification policies, patterns, routes, activity and follow data', () => {
  const privateValue = randomBytes(24).toString('hex');
  for (const name of ['notification-rules-and-own-device-sync', 'home-activity-and-follow-own-device-sync']) {
    const result = makeReport({ ...base, failureStage: name, checks: [{ name, passed: true, durationMs: 10,
      rules: privateValue, keyword: privateValue, roomId: privateValue, owner: privateValue,
      eventId: privateValue, pusher: privateValue, activity: [privateValue], accountData: { privateValue } }],
    });
    assert.deepEqual(result.checks, [{ name, passed: true, durationMs: 10 }]);
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});

test('cache reload profile retains numeric evidence without session or room data', () => {
  const privateValue = randomBytes(24).toString('hex');
  const name = 'cache-reload-readiness-profile';
  const result = makeReport({ ...base, failureStage: name,
    checks: [{ name, passed: true, durationMs: 12, roomId: privateValue, syncResponse: privateValue }],
    metrics: { cacheReloadSeedMs: 200, cacheReloadMessages: 350, cacheReloadReadyMs: 90000,
      cacheReloadSyncResponses: 7, cacheReloadReadyWithin90s: 0, debug: privateValue },
  });
  assert.deepEqual(result.metrics, { cacheReloadSeedMs: 200, cacheReloadMessages: 350,
    cacheReloadReadyMs: 90000, cacheReloadSyncResponses: 7, cacheReloadReadyWithin90s: 0 });
  assert.deepEqual(result.checks, [{ name, passed: true, durationMs: 12 }]);
  assert.equal(JSON.stringify(result).includes(privateValue), false);
});
test('sustained sync profile retains only bounded numeric evidence', () => {
  const privateValue = randomBytes(24).toString('hex');
  const name = 'sustained-sync-delivery';
  const result = makeReport({ ...base, failureStage: name,
    checks: [{ name, passed: true, durationMs: 600000, roomId: privateValue, eventBody: privateValue }],
    metrics: { sustainedSyncRoomCount: 1, sustainedSyncEventCount: 300, sustainedSyncDurationMs: 600001,
      sustainedSyncP95Ms: 800, sustainedSyncMaxMs: 1200, sustainedSyncResponses: 40,
      sustainedSyncHeapGrowthMiB: 3, roomId: privateValue, accessToken: privateValue,
      sustainedSyncEventBodies: [privateValue] },
  });
  assert.deepEqual(result.metrics, { sustainedSyncRoomCount: 1, sustainedSyncEventCount: 300,
    sustainedSyncDurationMs: 600001, sustainedSyncP95Ms: 800, sustainedSyncMaxMs: 1200,
    sustainedSyncResponses: 40, sustainedSyncHeapGrowthMiB: 3 });
  assert.deepEqual(result.checks, [{ name, passed: true, durationMs: 600000 }]);
  assert.equal(JSON.stringify(result).includes(privateValue), false);
});

test('encrypted sustained sync profile discards message and crypto material', () => {
  const privateValue = randomBytes(24).toString('hex');
  const name = 'encrypted-sustained-sync-delivery';
  const result = makeReport({ ...base, failureStage: name,
    checks: [{ name, passed: false, category: 'encrypted-sync-wire', durationMs: 600000, eventBody: privateValue }],
    metrics: { encryptedSyncRoomCount: 1, encryptedSyncEventCount: 300, encryptedSyncWireCount: 300,
      encryptedSyncDurationMs: 600001, encryptedSyncP95Ms: 900, encryptedSyncMaxMs: 1500,
      encryptedSyncResponses: 40, encryptedSyncHeapGrowthMiB: 4,
      roomId: privateValue, accessToken: privateValue, recoveryKey: privateValue, eventBody: privateValue },
  });
  assert.deepEqual(result.metrics, { encryptedSyncRoomCount: 1, encryptedSyncEventCount: 300,
    encryptedSyncWireCount: 300, encryptedSyncDurationMs: 600001, encryptedSyncP95Ms: 900,
    encryptedSyncMaxMs: 1500, encryptedSyncResponses: 40, encryptedSyncHeapGrowthMiB: 4 });
  assert.deepEqual(result.checks, [{ name, passed: false, durationMs: 600000, category: 'encrypted-sync-wire' }]);
  assert.equal(JSON.stringify(result).includes(privateValue), false);
});

test('first-use encrypted chat evidence discards identities and message content', () => {
  const privateValue = randomBytes(24).toString('hex');
  const name = 'first-use-encrypted-direct-conversation';
  const result = makeReport({ ...base, failureStage: name,
    checks: [{ name, passed: false, category: 'first-use-peer-decryption', durationMs: 120,
      roomId: privateValue, userId: privateValue, eventBody: privateValue, accessToken: privateValue }],
  });
  assert.deepEqual(result.checks, [{ name, passed: false, category: 'first-use-peer-decryption', durationMs: 120 }]);
  assert.equal(JSON.stringify(result).includes(privateValue), false);
});

test('community administration evidence keeps only fixed stages', () => {
  const privateValue = randomBytes(24).toString('hex');
  for (const name of ['room-access-and-discovery-administration', 'room-moderator-permission-transition', 'space-child-parent-and-recommendation-administration', 'room-knock-and-upgrade-administration']) {
    const category = name === 'room-knock-and-upgrade-administration' ? 'upgrade-tombstone' : name === 'room-moderator-permission-transition' ? 'moderator-demote' : 'space-add-subspace';
    const result = makeReport({ ...base, failureStage: name,
      checks: [{ name, passed: false, category, durationMs: 120,
        roomId: privateValue, alias: privateValue, serverAcl: privateValue, state: privateValue }],
      metrics: { communityBeforeDirectoryMs: 1200, roomId: privateValue },
    });
    assert.deepEqual(result.checks, [{ name, passed: false, category, durationMs: 120 }]);
    assert.deepEqual(result.metrics, { communityBeforeDirectoryMs: 1200 });
    assert.equal(JSON.stringify(result).includes(privateValue), false);
  }
});
