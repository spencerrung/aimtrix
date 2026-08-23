export type MatrixMessageMention = {
  userId: string;
  label: string;
};

export type MatrixFormattedMessage = {
  body: string;
  formattedBody?: string;
  usedMentionUserIds: string[];
};

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const escapeAttribute = (value: string) => escapeHtml(value).replaceAll("'", '&#39;');

const mentionHref = (userId: string) => `https://matrix.to/#/${encodeURIComponent(userId)}`;

export function matrixReplyFormattedBody(
  roomId: string,
  target: { id: string; senderId: string; body: string },
  replyBody: string,
): string {
  const eventHref = `https://matrix.to/#/${encodeURIComponent(roomId)}/${encodeURIComponent(target.id)}`;
  const quotedBody = escapeHtml(target.body).replaceAll('\n', '<br>');
  return `<mx-reply><blockquote><a href="${escapeAttribute(eventHref)}">In reply to</a> <a href="${escapeAttribute(mentionHref(target.senderId))}">${escapeHtml(target.senderId)}</a><br>${quotedBody}</blockquote></mx-reply>${replyBody}`;
}

const formatText = (
  value: string,
  mentions: MatrixMessageMention[],
  usedMentionUserIds: Set<string>,
): string => {
  if (!value || mentions.length === 0) return escapeHtml(value);

  const candidates = mentions
    .filter(({ label, userId }) => label.length > 0 && userId.length > 0)
    .map((mention) => ({ mention, visible: `@${mention.label}` }))
    .sort((left, right) => right.visible.length - left.visible.length);

  let result = '';
  let cursor = 0;
  while (cursor < value.length) {
    const candidate = candidates.find(({ visible }) => {
      if (!value.startsWith(visible, cursor)) return false;
      const previous = value.slice(0, cursor).match(/.$/u)?.[0];
      const next = value.slice(cursor + visible.length).match(/^./u)?.[0];
      return (!previous || !/[\p{L}\p{N}_]/u.test(previous))
        && (!next || !/[\p{L}\p{N}_]/u.test(next));
    });
    if (!candidate) {
      const character = String.fromCodePoint(value.codePointAt(cursor)!);
      result += escapeHtml(character);
      cursor += character.length;
      continue;
    }

    const { mention, visible } = candidate;
    usedMentionUserIds.add(mention.userId);
    result += `<a href="${escapeAttribute(mentionHref(mention.userId))}">${escapeHtml(visible)}</a>`;
    cursor += visible.length;
  }
  return result;
};

const formatInline = (
  value: string,
  mentions: MatrixMessageMention[],
  usedMentionUserIds: Set<string>,
): string => {
  const parts: string[] = [];
  let cursor = 0;
  const inlineMarkup = /`([^`]+)`|\*\*([^*\n]+)\*\*|(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu;
  let match: RegExpExecArray | null;

  while ((match = inlineMarkup.exec(value))) {
    parts.push(formatText(value.slice(cursor, match.index), mentions, usedMentionUserIds));
    if (match[1] !== undefined) parts.push(`<code>${escapeHtml(match[1])}</code>`);
    else if (match[2] !== undefined) parts.push(`<strong>${formatText(match[2], mentions, usedMentionUserIds)}</strong>`);
    else parts.push(`<em>${formatText(match[3], mentions, usedMentionUserIds)}</em>`);
    cursor = match.index + match[0].length;
  }
  parts.push(formatText(value.slice(cursor), mentions, usedMentionUserIds));

  return parts.join('');
};

export function matrixFormattedMessage(
  body: string,
  mentions: MatrixMessageMention[] = [],
): MatrixFormattedMessage {
  const usedMentionUserIds = new Set<string>();
  const hasVisibleMention = mentions.some(({ label }) => label.length > 0 && body.includes(`@${label}`));
  if (!/[`*_]/.test(body) && !hasVisibleMention) return { body, usedMentionUserIds: [] };

  const blocks: string[] = [];
  let cursor = 0;
  const fence = /```(?:(typescript|javascript|python|rust|bash|json|yaml)\n)?([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(body))) {
    const before = body.slice(cursor, match.index);
    if (before) blocks.push(`<p>${formatInline(before, mentions, usedMentionUserIds).replaceAll('\n', '<br>')}</p>`);
    const language = (match[1] ?? '').toLowerCase().replace(/[^a-z0-9+-]/g, '');
    blocks.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(match[2])}</code></pre>`);
    cursor = match.index + match[0].length;
  }
  const tail = body.slice(cursor);
  if (tail) blocks.push(`<p>${formatInline(tail, mentions, usedMentionUserIds).replaceAll('\n', '<br>')}</p>`);

  return { body, formattedBody: blocks.join(''), usedMentionUserIds: [...usedMentionUserIds] };
}
