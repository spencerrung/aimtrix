/* global document, window */
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Standalone reference QA: no Vite server, Matrix fixture, or application state.
const output = process.argv[2] || join(tmpdir(), 'aimtrix-step02-ui');
await mkdir(output, { recursive: true });
const assets = new Map(await Promise.all(['references.html', 'reference.css', 'reference.js'].map(async (name) => [name, await readFile(new URL(name, import.meta.url))])));
const server = createServer((request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1);
  if (!assets.has(name)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript');
  response.end(assets.get(name));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let layouts = 0;
let audits = 0;
async function load(scene = 'conversation', width = 1440, height = 1000, theme = 'aqua', extra = '') {
  await page.setViewportSize({ width, height });
  await page.goto(`${origin}/references.html?presentation=1&scene=${scene}&theme=${theme}${extra}`);
  await expect(page.locator('#room-title')).toHaveText(scene === 'dm' ? 'Mara Chen' : 'Welcome Lounge');
}
async function audit() {
  const result = await new AxeBuilder({ page }).analyze();
  assert.deepEqual(result.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })), []);
  audits++;
}
async function geometry(scene) {
  const measurements = await page.evaluate(() => {
    const visible = (selector) => [...document.querySelectorAll(selector)].filter((node) => node.getClientRects().length);
    const composer = visible('.composer')[0];
    const rect = composer?.getBoundingClientRect();
    const frame = document.querySelector('#frame').getBoundingClientRect();
    return { overflow: document.documentElement.scrollWidth > window.innerWidth, composers: visible('.composer').length, panels: visible('.context-panel').length, composerInside: !rect || rect.bottom <= frame.bottom && rect.left >= frame.left && rect.right <= frame.right, conversationWidth: visible('.conversation')[0]?.getBoundingClientRect().width };
  });
  assert.equal(measurements.overflow, false, `Page overflow in ${scene}`);
  assert.equal(measurements.composerInside, true, `Composer outside frame in ${scene}`);
  assert.ok(measurements.panels <= 1);
  if (measurements.conversationWidth) assert.ok(measurements.conversationWidth >= 300, 'Conversation track collapsed');
  layouts++;
}
try {
  for (const theme of ['aqua', 'graphite', 'midnight']) {
    for (const [scene, width, height] of [['conversation',1440,1000],['thread',1280,800],['busy',412,915],['failure',412,915],['empty',412,915],['dm',1440,1000]]) {
      await load(scene, width, height, theme); await geometry(scene); await audit();
      if (['busy','failure'].includes(scene)) await page.locator('#timeline').evaluate((node) => { node.scrollTop = node.scrollHeight; });
      await page.screenshot({ path: join(output, `${theme}-${scene}-${width}x${height}.png`) });
    }
  }
  for (const [width,height] of [[1024,768],[1024,360],[412,360],[568,320],[320,568]]) {
    for (const scene of ['conversation','thread']) {
      await load(scene,width,height); await geometry(scene);
      const prefix = scene === 'thread' ? '#thread-form' : '#composer-form';
      await expect(page.locator(`${prefix} textarea`)).toBeVisible();
      const send = await page.locator(`${prefix} .send`).boundingBox();
      assert.ok(send.y + send.height <= height);
      if (width < 768) assert.ok(send.width >= 44 && send.height >= 44);
      await page.screenshot({path:join(output,`aqua-${scene}-${width}x${height}.png`)});
    }
  }
  await load();
  await page.locator('#message').fill('Main draft survives');
  await page.getByRole('button',{name:/2 replies/}).click();
  await expect(page.locator('#context-panel')).toHaveAttribute('aria-label','Thread');
  await page.locator('#thread-message').fill('Thread draft survives');
  await page.getByRole('button',{name:'Room details',exact:true}).click();
  await page.getByRole('button',{name:/2 replies/}).click();
  await expect(page.locator('#thread-message')).toHaveValue('Thread draft survives');
  await page.getByRole('button',{name:'Send preview reply',exact:true}).click();
  await expect(page.getByRole('button',{name:/3 replies/})).toBeVisible();
  await expect(page.locator('#message')).toHaveValue('Main draft survives');
  await page.keyboard.press('Escape');
  await expect(page.locator('#context-panel')).toBeHidden();
  await page.getByRole('button',{name:'More message tools',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  for (let i=0;i<12;i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.closest('dialog') !== null),true); }
  await audit();
  await page.keyboard.press('Escape');
  await expect(page.locator('#more-tools')).toBeFocused();
  await page.locator('#message').fill('<img src=x onerror=alert(1)>');
  await page.locator('#message').press('Enter');
  await expect(page.locator('#timeline .message-text').last()).toHaveText('<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('#timeline img').count(),0);
  await page.getByRole('button',{name:'Stage sample attachment',exact:true}).click();
  await expect(page.locator('#attachment-stage')).toBeVisible();
  await page.getByRole('button',{name:'Remove sample attachment'}).click();
  await expect(page.locator('#attachment-stage')).toBeHidden();
  await page.getByRole('button',{name:'Stage sample attachment',exact:true}).click();
  await page.getByRole('button',{name:'Send preview message',exact:true}).click();
  await expect(page.locator('#timeline .message').last().locator('.sample-file')).toBeVisible();
  await page.getByRole('button',{name:'Add sparkle reaction'}).click();
  await expect(page.getByRole('button',{name:'Remove sparkle reaction'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Search conversation',exact:true}).click();
  await page.locator('#search-query').fill('Saturday');
  await expect(page.locator('#search-results button')).toHaveCount(1);
  await page.locator('#search-results button').click();
  await expect(page.locator('#message-0')).toBeFocused();
  await page.keyboard.press('Control+k');
  await page.locator('#switch-query').fill('Mara');
  await page.locator('[data-switch]').click();
  await expect(page.locator('#room-title')).toHaveText('Mara Chen');
  await load('failure',412,915);
  await page.locator('#message').fill('A newer draft');
  await page.getByRole('button',{name:'Keep editing'}).click();
  await expect(page.locator('#message')).toHaveValue(/A newer draft\nI’ll bring/);
  await page.locator('#message').press('Enter');
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.locator('.failed')).toHaveCount(1);
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.locator('.failed')).toHaveCount(0);
  await load('empty',412,915);
  await page.getByRole('button',{name:'Say hello'}).click();
  await page.locator('#message').press('Enter');
  await expect(page.locator('.empty-card')).toHaveCount(0);
  await load('loading');
  await page.locator('[data-history]').click();
  await expect(page.getByText('Earlier that morning:',{exact:false})).toBeVisible();
  await load('list',412,915);
  await page.locator('[data-room="Welcome Lounge"]').click();
  await page.getByRole('button',{name:/2 replies/}).click();
  await page.getByRole('button',{name:'Back to conversation'}).click();
  await page.getByRole('button',{name:'Back to buddy list'}).click();
  await expect(page.locator('.buddy-list')).toBeVisible();
  await page.emulateMedia({reducedMotion:'reduce'});
  await load('conversation',412,360);
  await page.locator('#send').dispatchEvent('pointerdown');
  assert.equal(await page.locator('#send').evaluate((element)=>window.getComputedStyle(element).transitionDuration),'0s');
  await page.goto(`${origin}/references.html`);
  for (const theme of ['graphite','midnight','aqua']) { await page.locator('#theme').selectOption(theme); await expect(page.locator('html')).toHaveAttribute('data-theme',theme); }
  for (const device of ['phone','tablet','landscape','keyboard','desktop']) { await page.locator('#device').selectOption(device); await expect(page.locator('#frame')).toHaveAttribute('data-device',device); }
  await page.locator('#reading').selectOption('aligned'); await expect(page.locator('#frame')).toHaveAttribute('data-reading','aligned');
  await page.locator('#reset').click(); await expect(page.locator('#reading')).toHaveValue('bubbles');
  await load();
  await page.locator('#self-card').click(); await expect(page.getByRole('dialog')).toContainText('Your personality'); await page.keyboard.press('Escape');
  await page.locator('[data-member="Mara Chen"]').click(); await expect(page.getByRole('dialog')).toContainText('Mara Chen'); await page.keyboard.press('Escape');
  await page.locator('#activity').click(); await page.locator('[data-activity-thread]').click(); await expect(page.locator('#thread-message')).toBeVisible();
  await page.locator('[data-thread-tools]').click(); await page.locator('[data-insert="✨"]').click(); await expect(page.locator('#thread-message')).toHaveValue('✨');
  await page.keyboard.press('Escape'); await page.locator('#more-tools').click(); await page.locator('[data-insert="code"]').click(); await expect(page.locator('#message')).toHaveValue(/code goes here/);
  await page.locator('#shortcuts').click(); await expect(page.getByRole('dialog')).toContainText('Keyboard shortcuts'); await page.keyboard.press('Escape');
  await load('conversation',412,915);
  await expect(page.locator('#shortcuts')).toBeHidden();
  await page.locator('[data-space="Garden club"]').click(); await expect(page.locator('.buddy-list')).toBeVisible(); await expect(page.locator('#space-title')).toHaveText('Garden club');
  await page.locator('#switcher').click(); const close = await page.getByRole('button',{name:'Close dialog'}).boundingBox(); assert.ok(close.width >= 44 && close.height >= 44);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  console.log(`PASS: ${layouts} layout checks, ${audits} Axe scans, local interaction journeys, no browser errors. Screenshots: ${output}`);
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
