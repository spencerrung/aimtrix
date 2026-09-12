/* global document, window, ResizeObserver */
const $ = (selector) => document.querySelector(selector);
const frame = $('#frame');
const dialog = $('#reference-dialog');
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paths = {
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  inbox: '<path d="M3 4h18v16H3zM3 13h5l2 3h4l2-3h5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>',
  back: '<path d="m13 5-7 7 7 7M6 12h15"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  cloud: '<path d="M7 18a5 5 0 0 1-1-10 6 6 0 0 1 11-1 5 5 0 0 1 1 10M12 10v4m0 4h.01"/>',
  file: '<path d="M5 2h9l5 5v15H5zM14 2v6h5M8 13h8m-8 4h6"/>',
  attach: '<path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2m-8 14 10-10"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 4 7 4 8 0M8 9h.01M16 9h.01"/>',
  send: '<path d="m3 3 19 9-19 9 3-9-3-9Zm3 9h16"/>', more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  thread: '<path d="M4 3h16v13H9l-5 5V3Z"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.more}</svg>`;
const icons = () => document.querySelectorAll('[data-icon]').forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
const rooms = ['Welcome Lounge', 'Mara Chen', 'Garden club', 'Dev Shack', 'Late night radio', 'PixelGhost'];
const people = { Mara: ['Mara Chen', 'mc', 'peach'], Spencer: ['Spencer', 'sp', 'berry'], Pixel: ['PixelGhost', 'pg', 'purple'] };
let messages = [];
let replies = [];
let context = 'none';
let route = 'conversation';
let room = 'Welcome Lounge';
let attached = false;
let threadDraft = '';
let failed = false;
let width = 1440;
let previousWide;
let opener;
const announce = (text) => { $('#announcer').textContent = text; };
const fileCard = () => `<div class="sample-file"><span class="file-symbol">${icon('file')}</span><span><strong>weekend-plan.txt</strong><small>2 KB · synthetic attachment</small></span></div>`;
function messageMarkup(message, index, thread = false) {
  const [name, initials, color] = people[message.author];
  return `<article class="message ${message.author === 'Spencer' ? 'own' : ''} ${message.failed ? 'failed' : ''}" id="${thread ? 'reply' : 'message'}-${index}" tabindex="-1"><span class="avatar ${color}" aria-hidden="true">${initials}</span><div class="bubble"><div class="message-meta"><strong>${name}</strong><time>${message.time || '10:42'}</time></div><p class="message-text">${escape(message.text)}</p>${message.file ? fileCard() : ''}${message.reaction ? `<div class="reactions"><button class="reaction" type="button" data-react="${index}" aria-pressed="${Boolean(message.reacted)}" aria-label="${message.reacted ? 'Remove' : 'Add'} sparkle reaction">✦ ${message.reacted ? 4 : 3}</button></div>` : ''}${message.thread ? `<button class="thread-link" type="button" data-thread="true">${icon('thread')} ${replies.length} replies <small>Open thread</small></button>` : ''}${message.failed ? '<div class="failure-actions"><span>Not sent · connection lost</span><button type="button" data-retry>Retry</button><button type="button" data-edit>Keep editing</button></div>' : message.author === 'Spencer' ? '<p class="read-status">Preview sent</p>' : ''}</div></article>`;
}
function renderTimeline() {
  const scene = $('#scene').value;
  $('#timeline').innerHTML = scene === 'empty' && !messages.length ? '<div class="empty-card"><span class="avatar blue" aria-hidden="true">wl</span><h3>A little hello goes a long way.</h3><p>This is the start of your conversation. Bring your ideas, small victories, and very good snacks.</p><button type="button" data-greet>Say hello</button></div>' : `${scene === 'loading' ? '<button type="button" class="history-loader" data-history>Earlier messages loading · finish sample load</button>' : '<div class="day-divider">Today · September 11</div>'}${messages.map((message, index) => `${index === 2 ? '<div class="unread-divider">3 new messages</div>' : ''}${messageMarkup(message, index)}`).join('')}`;
  $('#typing').hidden = ['empty', 'failure', 'loading'].includes(scene);
  $('#connection-banner').hidden = !failed;
  $('#connection-copy').textContent = failed ? 'Reconnecting' : 'Online';
}
function applyRoute() {
  frame.dataset.context = context;
  frame.dataset.route = route;
  $('#room-title').setAttribute('aria-level', width < 768 ? '1' : '2');
  $('#panel-title')?.setAttribute('aria-level', width < 768 ? '1' : '2');
  frame.querySelectorAll('h3').forEach((heading) => heading.setAttribute('aria-level', width < 768 ? '2' : '3'));
  $('#details').setAttribute('aria-pressed', String(context === 'details'));
}
function openContext(next, source) {
  if ($('#thread-message')) threadDraft = $('#thread-message').value;
  opener = source || document.activeElement;
  context = next;
  route = 'context';
  renderContext();
  applyRoute();
  $('#panel-title')?.focus();
}
function closeContext() {
  if ($('#thread-message')) threadDraft = $('#thread-message').value;
  context = 'none'; route = 'conversation'; applyRoute();
  if (opener?.isConnected && opener.getClientRects().length) opener.focus();
  else $('#room-title').focus();
}
function panelHeader(title) {
  return `<header class="panel-header"><h2 id="panel-title" tabindex="-1">${title}</h2><button class="icon-button" type="button" data-close-context aria-label="Back to conversation">${icon('back')}</button></header>`;
}
function renderContext() {
  const panel = $('#context-panel');
  panel.setAttribute('aria-label', context === 'thread' ? 'Thread' : context === 'search' ? 'Search conversation' : context === 'activity' ? 'Catch up' : 'Room details');
  if (context === 'thread') {
    panel.innerHTML = `${panelHeader('Thread')}<div class="panel-content" id="thread-timeline"><div class="root-message"><div class="message-meta"><strong>Mara Chen</strong><time>10:42</time></div><p>I made a tiny plan for Saturday. Nothing ambitious. Just good company. ✨</p></div><p class="thread-label">${replies.length} replies · ${escape(room)}</p>${replies.map((message, index) => messageMarkup(message, index, true)).join('')}</div><form class="composer" id="thread-form"><div class="composer-input"><label class="sr-only" for="thread-message">Reply in thread</label><textarea id="thread-message" rows="1" placeholder="Reply in thread">${escape(threadDraft)}</textarea><button class="icon-button" type="button" data-thread-tools aria-label="More thread message tools">${icon('smile')}</button><button class="send" type="submit" aria-label="Send preview reply">${icon('send')}</button></div></form>`;
  } else if (context === 'search') {
    panel.innerHTML = `${panelHeader('Search conversation')}<div class="panel-content"><label class="sr-only" for="search-query">Search sample messages</label><input id="search-query" class="search-input" type="search" placeholder="Search this conversation"><div id="search-results"></div></div>`;
    searchResults('');
  } else if (context === 'activity') {
    panel.innerHTML = `${panelHeader('Catch up')}<div class="panel-content"><p class="panel-note">A preview of your mentions and thread replies, with enough context to choose where to go.</p><button class="result-button" data-activity-thread type="button"><strong>Mara replied to your thread</strong><span>Welcome Lounge · “I’m bringing the good cookies.”</span></button><button class="result-button" data-jump="2" type="button"><strong>PixelGhost mentioned you</strong><span>Welcome Lounge · @Spencer, saved you a spot.</span></button></div>`;
  } else if (context === 'details') {
    panel.innerHTML = `${panelHeader(room === 'Mara Chen' ? 'Buddy card' : 'Room details')}<div class="panel-content"><div class="room-card"><div class="landscape-art" aria-hidden="true"></div><span class="avatar blue" aria-hidden="true">${room === 'Mara Chen' ? 'mc' : 'wl'}</span><h3>${escape(room)}</h3><p>${room === 'Mara Chen' ? 'making a mix for the walk home' : 'A soft landing for the everyday.<br>Make yourself at home.'}</p><span class="privacy">${icon('lock')} Encrypted · sample state</span></div><p class="panel-section-title">Good company <span>${room === 'Mara Chen' ? '2' : '3'} members</span></p>${Object.values(people).filter(([name]) => room !== 'Mara Chen' || name !== 'PixelGhost').map(([name, initials, color]) => `<div class="member"><span class="avatar ${color}" aria-hidden="true">${initials}</span><span><strong>${name}</strong><small>${name === 'Mara Chen' ? 'making a mix for the walk home' : name === 'Spencer' ? 'You · just arrived' : 'one more save point'}</small></span><button class="icon-button" data-member="${name}" type="button" aria-label="View ${name} buddy card">${icon('more')}</button></div>`).join('')}<div class="panel-note"><strong>Room to be yourself.</strong>Personality belongs around the conversation. Messages stay easy to read, even when the room gets lively.</div></div>`;
  } else panel.innerHTML = '';
}
function searchResults(query) {
  const results = messages.map((message, index) => ({ message, index })).filter(({ message }) => message.text.toLowerCase().includes(query.toLowerCase()));
  $('#search-results').innerHTML = results.length ? results.map(({ message, index }) => `<button class="result-button" type="button" data-jump="${index}"><strong>${people[message.author][0]}</strong><span>${escape(message.text)}</span></button>`).join('') : '<p class="panel-note">No sample messages match. Try “Saturday”.</p>';
}
function showDialog(title, content) {
  if (dialog.open) dialog.close();
  $('#dialog-title').textContent = title;
  $('#dialog-content').innerHTML = content;
  dialog.showModal();
}
function toolsMenu(thread = false) {
  showDialog('Message tools', `<p>Local samples for reviewing the menu. Your draft stays here.</p>${['🙂', '✨', '🌱'].map((emoji) => `<button type="button" data-insert="${emoji}" data-target="${thread ? 'thread-message' : 'message'}">${emoji} Add ${emoji} to draft</button>`).join('')}<button type="button" data-insert="code" data-target="${thread ? 'thread-message' : 'message'}">${icon('file')} Insert code block</button>${thread ? '' : `<button type="button" data-stage>${icon('attach')} Stage sample attachment</button>`}<small>Emoji, sticker, and media catalogs stay lazy in the application. This reference does not load a catalog.</small>`);
}
function selectRoom(name, focus = true) {
  room = name;
  $('#room-title').textContent = name;
  $('.room-avatar').textContent = name === 'Mara Chen' ? 'mc' : name === 'PixelGhost' ? 'pg' : name === 'Welcome Lounge' ? 'wl' : '#';
  $('#room-subtitle').innerHTML = `${name === 'Mara Chen' ? 'making a mix for the walk home' : 'The little things, together.'} <span class="privacy">${icon('lock')} Encrypted · sample state</span>`;
  $('#message').placeholder = `Message ${name}`;
  $('label[for="message"]').textContent = `Message ${name}`;
  document.querySelectorAll('[data-room]').forEach((button) => { button.classList.toggle('selected', button.dataset.room === name); button.setAttribute('aria-current', String(button.dataset.room === name)); });
  context = 'none'; route = 'conversation'; applyRoute(); if (focus) $('#room-title').focus();
  announce(`Opened ${name}. All conversations use the same synthetic sample data.`);
}
function switcher() {
  showDialog('Find a conversation', '<label class="sr-only" for="switch-query">Conversation name</label><input id="switch-query" class="search-input" placeholder="Type a room or buddy name"><div id="switch-results"></div>');
  switchResults(''); $('#switch-query').focus();
}
function switchResults(query) {
  const matches = rooms.filter((name) => name.toLowerCase().includes(query.toLowerCase()));
  $('#switch-results').innerHTML = matches.length ? matches.map((name) => `<button class="result-button" type="button" data-switch="${name}"><strong>${name}</strong></button>`).join('') : '<p>No conversations match.</p>';
}
function stageAttachment() { attached = true; $('#attachment-stage').hidden = false; $('#message').focus(); announce('Synthetic attachment staged. No file was uploaded.'); }
function send(thread = false) {
  const input = $(thread ? '#thread-message' : '#message');
  if (!input.value.trim() && (thread || !attached)) { input.focus(); announce('Write a message first.'); return; }
  const message = { author: 'Spencer', text: input.value.trim(), time: 'Now', file: !thread && attached, failed: !thread && failed };
  if (thread) { replies.push(message); threadDraft = ''; document.querySelectorAll('[data-thread]').forEach((button) => { button.innerHTML = `${icon('thread')} ${replies.length} replies <small>Open thread</small>`; }); renderContext(); $('#thread-message').focus(); $('#thread-timeline').scrollTop = $('#thread-timeline').scrollHeight; }
  else { messages.push(message); input.value = ''; input.style.height = ''; attached = false; $('#attachment-stage').hidden = true; renderTimeline(); $('#timeline').scrollTop = $('#timeline').scrollHeight; input.focus(); }
  announce(message.failed ? 'Preview message not sent. Retry or keep editing.' : 'Preview message added locally. Nothing was sent to Matrix.');
}
function setupScene() {
  const scene = $('#scene').value;
  failed = scene === 'failure'; attached = false; threadDraft = ''; $('#message').value = ''; $('#message').style.height = ''; $('#attachment-stage').hidden = true;
  replies = [{ author: 'Pixel', text: 'A slow Saturday sounds perfect.', time: '10:44' }, { author: 'Mara', text: 'I’m bringing the good cookies.', time: '10:46' }];
  messages = scene === 'empty' ? [] : [
    { author: 'Mara', text: 'I made a tiny plan for Saturday. Nothing ambitious. Just good company. ✨', time: '10:42', thread: true, reaction: true },
    { author: 'Spencer', text: 'This is exactly my kind of plan.', time: '10:43' },
    { author: 'Pixel', text: '@Spencer, saved you a spot. And yes, the playlist is coming with us.', time: '10:45' },
    { author: 'Mara', text: 'A little map, a snack stop, and room to wander.', time: '10:47', file: true },
  ];
  if (scene === 'dm') messages = [
    { author: 'Mara', text: 'Found a little sunshine on the walk home. Made me think of you. 🌱', time: '10:42', reaction: true },
    { author: 'Spencer', text: 'A very good reason to take the long way home.', time: '10:43' },
    { author: 'Mara', text: 'Saved you the playlist. Let’s walk together next time.', time: '10:45', file: true },
  ];
  if (scene === 'busy') messages.push({ author: 'Pixel', text: 'A longer message should still be comfortable to read, with room for the words to wrap.\n\nHere is a deliberately long address to check wrapping:\nhttps://example.invalid/a-very-long-synthetic-path-without-spaces-for-checking-the-message-layout-and-keeping-the-composer-reachable\n\nconst weekend = { pace: "slow", company: "good" };', time: '10:49' });
  if (failed) messages.push({ author: 'Spencer', text: 'I’ll bring the snacks. See you at ten!', time: '10:50', failed: true });
  selectRoom(scene === 'dm' ? 'Mara Chen' : 'Welcome Lounge', false);
  context = scene === 'thread' ? 'thread' : width >= 1200 && !['empty', 'loading', 'failure', 'list'].includes(scene) ? 'details' : 'none';
  route = scene === 'list' && width < 768 ? 'list' : context === 'none' ? 'conversation' : 'context';
  renderTimeline(); renderContext(); applyRoute(); $('#timeline').scrollTop = 0;
}
function syncControls() {
  document.documentElement.dataset.theme = $('#theme').value;
  frame.dataset.device = $('#device').value; frame.dataset.reading = $('#reading').value;
  const url = new window.URL(window.location.href);
  ['theme', 'scene', 'device', 'reading'].forEach((key) => url.searchParams.set(key, $(`#${key}`).value));
  window.history.replaceState(null, '', url);
}
$('#reference-controls').addEventListener('submit', (event) => event.preventDefault());
$('#reference-controls').addEventListener('change', (event) => { syncControls(); if (event.target.id === 'scene') setupScene(); });
$('#reset').onclick = () => { ['theme', 'scene', 'device', 'reading'].forEach((key) => { $(`#${key}`).selectedIndex = 0; }); syncControls(); setupScene(); };
$('#composer-form').onsubmit = (event) => { event.preventDefault(); send(); };
$('#attach').onclick = stageAttachment;
$('#remove-attachment').onclick = () => { attached = false; $('#attachment-stage').hidden = true; $('#attach').focus(); };
$('#more-tools').onclick = () => toolsMenu();
$('#details').onclick = (event) => context === 'details' ? closeContext() : openContext('details', event.currentTarget);
$('#search-room').onclick = (event) => { openContext('search', event.currentTarget); $('#search-query').focus(); };
$('#activity').onclick = (event) => openContext('activity', event.currentTarget);
$('#back-list').onclick = () => { route = 'list'; context = 'none'; applyRoute(); $('#switcher').focus(); };
$('#switcher').onclick = switcher;
$('#shortcuts').onclick = () => showDialog('Keyboard shortcuts', '<div class="shortcut-row">Find a conversation<kbd>Ctrl / ⌘ K</kbd></div><div class="shortcut-row">Send message<kbd>Enter</kbd></div><div class="shortcut-row">New line<kbd>Shift Enter</kbd></div><div class="shortcut-row">Close dialog or panel<kbd>Esc</kbd></div><p class="panel-note">Tab moves through controls. Opening and closing a panel preserves your draft.</p>');
$('#self-card').onclick = () => showDialog('Your personality', '<span class="avatar berry" aria-hidden="true">sp</span><p><strong>Spencer</strong><br>Making room for good company ✨</p><p class="panel-note">Synthetic buddy card. In the product, status sharing must identify its audience before saving.</p>');
$('#reconnect').onclick = () => { failed = false; renderTimeline(); announce('Sample connection restored. Failed messages still need Retry.'); };
document.addEventListener('submit', (event) => { if (event.target.id === 'thread-form') { event.preventDefault(); send(true); } });
document.addEventListener('input', (event) => {
  if (event.target.id === 'search-query') searchResults(event.target.value);
  if (event.target.id === 'switch-query') switchResults(event.target.value);
  if (event.target.tagName === 'TEXTAREA') { event.target.style.height = 'auto'; event.target.style.height = `${Math.min(128, event.target.scrollHeight)}px`; if (event.target.id === 'thread-message') threadDraft = event.target.value; }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && dialog.open) {
    const stops = [...dialog.querySelectorAll('button:not(:disabled), input, textarea, [tabindex="0"]')];
    const first = stops[0], last = stops.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if (event.key === 'k' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); switcher(); }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.target.tagName === 'TEXTAREA') { event.preventDefault(); send(event.target.id === 'thread-message'); }
  if (event.key === 'Escape' && !dialog.open && context !== 'none') { event.preventDefault(); closeContext(); }
});
document.addEventListener('click', (event) => {
  const button = event.target.closest('button'); if (!button) return;
  const data = button.dataset;
  if ('room' in data) selectRoom(data.room);
  if ('space' in data) { $('#space-title').textContent = data.space; document.querySelectorAll('[data-space]').forEach((item) => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); }); if (width < 768) { route = 'list'; context = 'none'; applyRoute(); } announce(`${data.space} selected. Reference rooms are synthetic.`); }
  if ('thread' in data || 'activityThread' in data) openContext('thread', button);
  if ('closeContext' in data) closeContext();
  if ('react' in data) { const message = messages[Number(data.react)]; message.reacted = !message.reacted; button.setAttribute('aria-pressed', String(message.reacted)); button.setAttribute('aria-label', `${message.reacted ? 'Remove' : 'Add'} sparkle reaction`); button.textContent = `✦ ${message.reacted ? 4 : 3}`; }
  if ('greet' in data) { $('#message').value = 'Hello, everyone! ✨'; $('#message').focus(); }
  if ('retry' in data) { const index = Number(button.closest('article').id.split('-')[1]); failed = false; messages[index].failed = false; renderTimeline(); announce('Sample retry succeeded. Nothing was sent to Matrix.'); }
  if ('edit' in data) { const index = Number(button.closest('article').id.split('-')[1]); $('#message').value = [$('#message').value, messages[index].text].filter(Boolean).join('\n'); if (messages[index].file) stageAttachment(); messages.splice(index, 1); renderTimeline(); $('#message').focus(); }
  if ('history' in data) { button.outerHTML = messageMarkup({ author: 'Mara', text: 'Earlier that morning: let’s keep Saturday simple.', time: '09:10' }, 'history'); announce('Earlier sample message loaded.'); }
  if ('member' in data) showDialog(`${data.member} · buddy card`, `<p><strong>${escape(data.member)}</strong></p><p class="panel-note">This card previews a member action destination. Roles and moderation belong in a permission-aware menu in the application.</p>`);
  if ('threadTools' in data) toolsMenu(true);
  if ('insert' in data) { const target = $(`#${data.target}`); const text = data.insert === 'code' ? '\n```\ncode goes here\n```\n' : data.insert; target.setRangeText(text, target.selectionStart, target.selectionEnd, 'end'); if (data.target === 'thread-message') threadDraft = target.value; dialog.close(); target.focus(); }
  if ('stage' in data) { dialog.close(); stageAttachment(); }
  if ('switch' in data) { dialog.close(); selectRoom(data.switch); }
  if ('jump' in data) { const index = data.jump; closeContext(); const target = $(`#message-${index}`); target?.scrollIntoView({ block: 'center' }); target?.focus(); }
});
const params = new window.URL(window.location.href).searchParams;
['theme', 'scene', 'device', 'reading'].forEach((key) => { if ([...$(`#${key}`).options].some((option) => option.value === params.get(key))) $(`#${key}`).value = params.get(key); });
document.documentElement.dataset.presentation = String(params.get('presentation') === '1');
syncControls(); icons(); width = frame.clientWidth; previousWide = width >= 1200; setupScene();
new ResizeObserver(([entry]) => {
  width = entry.contentRect.width;
  const wide = width >= 1200;
  if (wide !== previousWide) { if (context === 'details') context = 'none'; route = context === 'none' ? 'conversation' : 'context'; previousWide = wide; }
  applyRoute();
}).observe(frame);
