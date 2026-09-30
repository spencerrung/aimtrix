/* global setTimeout, fetch, console */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';

let deliveries = 0;
let offlineAttempts = 0;
const server = createServer((request, response) => {
  if (request.url === '/deliver') deliveries += 1;
  if (request.url === '/offline') offlineAttempts += 1;
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><title>Scheduling proof</title>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const deadlineMs = 5_000;
let browser;
let context;

try {
  browser = await chromium.launch();
  context = await browser.newContext({ timezoneId: 'America/New_York' });
  // A page timer has no process that can send after its page is closed.
  const closedPage = await context.newPage();
  await closedPage.goto(origin);
  const closeStarted = Date.now();
  await closedPage.evaluate(() => {
    setTimeout(() => { void fetch('/deliver'); }, 5_000);
  });
  await closedPage.close();
  assert.ok(Date.now() - closeStarted < deadlineMs, 'Page closed before the synthetic deadline');
  await new Promise((resolve) => setTimeout(resolve, deadlineMs + 300));
  assert.equal(deliveries, 0, 'A closed page did not deliver its pending timer');

  const restartedPage = await context.newPage();
  await restartedPage.goto(origin);
  await restartedPage.waitForTimeout(300);
  assert.equal(deliveries, 0, 'Opening a new page did not recreate the old timer');

  // Headless Chromium's lifecycle state is an observation, not an OS suspension guarantee.
  const session = await context.newCDPSession(restartedPage);
  const freezeStarted = Date.now();
  await restartedPage.evaluate(() => {
    setTimeout(() => { void fetch('/deliver'); }, 5_000);
  });
  await session.send('Page.setWebLifecycleState', { state: 'frozen' });
  assert.ok(Date.now() - freezeStarted < deadlineMs, 'Page froze before the synthetic deadline');
  await new Promise((resolve) => setTimeout(resolve, deadlineMs + 300));
  assert.ok(deliveries === 0 || deliveries === 1, 'The synthetic timer fired at most once while frozen');
  const firedWhileFrozen = deliveries === 1;
  await session.send('Page.setWebLifecycleState', { state: 'active' });
  const resumeDeadline = Date.now() + 5_000;
  while (deliveries === 0 && Date.now() < resumeDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(deliveries, 1, 'The synthetic timer fired once across freeze and resume');

  // Offline work fails rather than becoming a durable queue for later delivery.
  await context.setOffline(true);
  const offlineResult = await restartedPage.evaluate(async () => {
    try {
      await fetch('/offline');
      return 'sent';
    } catch {
      return 'failed';
    }
  });
  assert.equal(offlineResult, 'failed', 'An offline fetch did not deliver');
  assert.equal(offlineAttempts, 0, 'The local endpoint did not receive offline work');
  await context.setOffline(false);
  await restartedPage.waitForTimeout(200);
  assert.equal(deliveries, 1, 'Connectivity restoration did not replay failed work');
  assert.equal(offlineAttempts, 0, 'Connectivity restoration did not retry the failed fetch');

  // A wall-clock timestamp is not a unique future instant across DST changes.
  const daylightSaving = await restartedPage.evaluate(() => {
    const missing = new Date(2026, 2, 8, 2, 30);
    const first = new Date('2026-11-01T01:30:00-04:00');
    const second = new Date('2026-11-01T01:30:00-05:00');
    return {
      missingHour: missing.getHours(),
      firstHour: first.getHours(),
      secondHour: second.getHours(),
      differenceMs: second.getTime() - first.getTime(),
    };
  });
  assert.deepEqual(daylightSaving, {
    missingHour: 3,
    firstHour: 1,
    secondHour: 1,
    differenceMs: 60 * 60 * 1000,
  }, 'The local wall clock has a missing and an ambiguous time in New York');

  console.log(`Scheduling feasibility proof passed: close, restart, freeze/resume (${firedWhileFrozen ? 'fired while frozen' : 'fired after resume'}), offline, and DST boundaries.`);
} finally {
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
