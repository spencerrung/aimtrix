import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';
import { invariant, until } from './stack.mjs';

// Only fixed stage names escape this journey; content, event IDs and session
// data remain in the disposable clients/process, never screenshots or reports.
export async function verifyElementReplies({ sender, peer, origin, roomId, roomName, encrypted, peerUserId }) {
  let stage = 'reply-peer-room';
  try {
    const encode = encodeURIComponent;
    await peer.goto(`${origin}/#/room/${encode(roomId)}`);
    const peerComposer = peer.locator('.mx_RoomView_body .mx_BasicMessageComposer_input');
    await peerComposer.waitFor({ timeout: 60000 });
    const original = `Synthetic original ${randomBytes(6).toString('hex')}`;
    stage = 'reply-peer-original';
    await peerComposer.fill(original);
    const eventType = encrypted ? 'm.room.encrypted' : 'm.room.message';
    const sendPath = `/rooms/${encode(roomId)}/send/${eventType}/`;
    const sent = (page) => page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.includes(sendPath), { timeout: 45000 });
    const [originalResponse] = await Promise.all([sent(peer), peerComposer.press('Enter')]);
    invariant(originalResponse.ok(), stage);
    const originalId = (await originalResponse.json()).event_id;
    const source = sender.locator(`[data-event-id=${JSON.stringify(originalId)}]`);
    stage = 'reply-sender-original';
    await sender.bringToFront();
    await until(async () => {
      // Switching rooms restores the reading position; explicitly resume the
      // live tail before expecting a newly received original in that timeline.
      const latest = sender.getByRole('button', { name: 'Jump to latest messages', exact: true });
      if (await latest.isVisible()) await latest.click();
      return source.isVisible();
    }, stage);
    for (const formatted of [false, true]) {
      stage = 'reply-sender-compose';
      await sender.bringToFront();
      await source.getByRole('button', { name: 'More message actions', exact: true }).click();
      await sender.getByRole('menu', { name: 'Message actions', exact: true }).getByRole('menuitem', { name: 'Reply', exact: true }).click();
      const message = `Synthetic ${formatted ? 'formatted' : 'plain'} reply ${randomBytes(6).toString('hex')}`;
      const body = formatted ? `**${message}**` : message;
      await sender.getByRole('textbox', { name: `Message ${roomName}`, exact: true }).fill(body);
      stage = 'reply-sender-send';
      const [response] = await Promise.all([sent(sender), sender.getByRole('button', { name: 'Send message', exact: true }).click()]);
      invariant(response.ok(), stage);
      const wire = response.request().postDataJSON();
      stage = 'reply-wire-content';
      if (encrypted) invariant(wire.algorithm === 'm.megolm.v1.aes-sha2' && !JSON.stringify(wire).includes(message), stage);
      else {
        invariant(wire.body === body && wire['m.relates_to']?.['m.in_reply_to']?.event_id === originalId, stage);
        invariant(wire['m.mentions']?.user_ids?.includes(peerUserId), stage);
        invariant(formatted ? wire.formatted_body === `<p><strong>${message}</strong></p>` : !wire.format && !wire.formatted_body, stage);
      }
      const eventId = (await response.json()).event_id;
      stage = 'reply-peer-preview';
      await peer.bringToFront();
      const tile = peer.locator(`.mx_EventTile[data-scroll-tokens=${JSON.stringify(eventId)}]`);
      await tile.waitFor({ timeout: 60000 });
      await until(() => tile.locator('.mx_ReplyChain').filter({ hasText: original }).isVisible(), stage, 60000);
      invariant(await tile.locator('.mx_ReplyChain').count() === 1, stage);
      stage = 'reply-peer-body';
      // Check the new body separately from Element's native reply preview.
      const text = tile.locator('.mx_MTextBody').last();
      await until(async () => (await text.innerText()).trim() === message, stage);
      invariant(!(await text.innerText()).includes(original) && !(await text.innerText()).includes(peerUserId), stage);
      if (formatted) invariant(await text.locator('strong').innerText() === message, stage);
    }
  } catch { throw new Error(stage); }
}
