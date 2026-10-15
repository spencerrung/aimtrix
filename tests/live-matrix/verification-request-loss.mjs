// Installed SDK boundary proof using memory-only synthetic devices.
import process from 'node:process';
import assert from 'node:assert/strict';
import { OlmMachine, UserId, DeviceId, DeviceLists, RequestType } from '@matrix-org/matrix-sdk-crypto-wasm';
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const user = '@synthetic:aimtrix.test';
let receiver, sender;
const evidence = { unknownDeviceRequestCreated: false, lostRequestReplayedAfterKeys: false, knownDeviceRequestCreated: false };
try {
  receiver = await OlmMachine.initialize(new UserId(user), new DeviceId('RECEIVER'), undefined, undefined, quiet);
  sender = await OlmMachine.initialize(new UserId(user), new DeviceId('NEW-ELEMENT'), undefined, undefined, quiet);
  const content = (transactionId) => ({ sender: user, type: 'm.key.verification.request', content: {
    from_device: 'NEW-ELEMENT', transaction_id: transactionId, methods: ['m.sas.v1'], timestamp: Date.now(),
  } });
  await receiver.receiveSyncChanges(JSON.stringify([content('unknown-sender-flow')]), new DeviceLists([], []), new Map());
  const missing = receiver.getVerificationRequest(new UserId(user), 'unknown-sender-flow');
  evidence.unknownDeviceRequestCreated = Boolean(missing);
  missing?.free();
  assert.equal(evidence.unknownDeviceRequestCreated, false);
  const uploaded = (await sender.outgoingRequests()).find((request) => request.type === RequestType.KeysUpload);
  const deviceKeys = JSON.parse(uploaded.body).device_keys;
  const query = receiver.queryKeysForUsers([new UserId(user)]);
  await receiver.markRequestAsSent(query.id, query.type, JSON.stringify({ device_keys: { [user]: { 'NEW-ELEMENT': deviceKeys } } }));
  const replay = receiver.getVerificationRequest(new UserId(user), 'unknown-sender-flow');
  evidence.lostRequestReplayedAfterKeys = Boolean(replay);
  replay?.free();
  assert.equal(evidence.lostRequestReplayedAfterKeys, false);
  await receiver.receiveSyncChanges(JSON.stringify([content('known-sender-flow')]), new DeviceLists([], []), new Map());
  const pending = receiver.getVerificationRequest(new UserId(user), 'known-sender-flow');
  evidence.knownDeviceRequestCreated = Boolean(pending);
  pending?.free();
  assert.equal(evidence.knownDeviceRequestCreated, true);
  process.stdout.write(JSON.stringify(evidence) + '\n');
} catch {
  process.stdout.write('{"category":"fresh-device-wasm-proof-failed"}\n');
  process.exitCode = 1;
} finally { receiver?.close(); sender?.close(); }
