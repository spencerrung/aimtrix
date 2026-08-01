const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const formatInline = (value: string) => escapeHtml(value)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/_([^_\n]+)_/g, '<em>$1</em>');

export function matrixFormattedMessage(body: string): { body: string; formattedBody?: string } {
  if (!/[`*_]/.test(body)) return { body };
  const blocks: string[] = [];
  let cursor = 0;
  const fence = /```(?:(typescript|javascript|python|rust|bash|json|yaml)\n)?([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(body))) {
    const before = body.slice(cursor, match.index);
    if (before) blocks.push(`<p>${formatInline(before).replaceAll('\n', '<br>')}</p>`);
    const language = match[1].toLowerCase().replace(/[^a-z0-9+-]/g, '');
    blocks.push(`<pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(match[2])}</code></pre>`);
    cursor = match.index + match[0].length;
  }
  const tail = body.slice(cursor);
  if (tail) blocks.push(`<p>${formatInline(tail).replaceAll('\n', '<br>')}</p>`);
  return { body, formattedBody: blocks.join('') };
}
