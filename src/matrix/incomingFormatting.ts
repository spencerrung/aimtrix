/** Data-only HTML subset. Render these nodes with React; never insert their source HTML. */
export type FormattedMessageNode =
  | { type: 'text'; text: string }
  | { type: 'element'; tag: 'p' | 'strong' | 'em' | 'u' | 's' | 'blockquote' | 'ul' | 'ol' | 'li' | 'br' | 'hr' | 'code' | 'pre'; children: FormattedMessageNode[]; language?: string; start?: number }
  | { type: 'link'; href: string; children: FormattedMessageNode[]; userId?: string }
  | { type: 'spoiler'; reason?: string; children: FormattedMessageNode[] }
  | { type: 'emoticon'; mxcUrl: string; alt: string };

export const MAX_FORMATTED_BODY_LENGTH = 65_536;
const MAX_NODES = 2048;
const MAX_DEPTH = 24;
const dropped = new Set(['mx-reply', 'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'video', 'audio', 'source', 'picture', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'template', 'noscript']);
const tags = new Map<string, Extract<FormattedMessageNode, { type: 'element' }>['tag']>([
  ['p', 'p'], ['div', 'p'], ['b', 'strong'], ['strong', 'strong'], ['i', 'em'], ['em', 'em'], ['u', 'u'], ['s', 's'], ['del', 's'], ['strike', 's'],
  ['blockquote', 'blockquote'], ['ul', 'ul'], ['ol', 'ol'], ['li', 'li'], ['br', 'br'], ['hr', 'hr'], ['code', 'code'], ['pre', 'pre'],
  ...['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((tag) => [tag, 'p'] as const),
]);

function safeHref(raw: string | null): string | undefined {
  if (!raw || raw.length > 2048 || [...raw].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\')) return;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return;
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    if (url.protocol === 'mailto:' && url.pathname && !url.search && !url.hash) return url.href;
    if (url.protocol === 'matrix:' && /^(?:r|roomid|u)\//u.test(url.pathname)) return url.href;
  } catch { /* Invalid links retain their readable label. */ }
}

function mentionId(href: string, allowed: ReadonlySet<string>): string | undefined {
  try {
    const url = new URL(href);
    const id = url.origin === 'https://matrix.to' && url.hash.startsWith('#/')
      ? decodeURIComponent(url.hash.slice(2).split('?')[0])
      : url.protocol === 'matrix:' && url.pathname.startsWith('u/') ? `@${decodeURIComponent(url.pathname.slice(2))}` : undefined;
    return id && allowed.has(id) ? id : undefined;
  } catch { return; }
}

/** Bounded, inert parsing: no parsed DOM is attached and no HTML/attributes escape. */
export function parseIncomingFormatting(html: unknown, mentionUserIds: readonly string[] = []): FormattedMessageNode[] | undefined {
  if (typeof html !== 'string' || !html || html.length > MAX_FORMATTED_BODY_LENGTH || typeof document === 'undefined') return;
  // Template contents are inert, unlike a DOMParser document which may load resources.
  const template = document.createElement('template');
  template.innerHTML = html;
  const allowedMentions = new Set(mentionUserIds.slice(0, 100));
  let visited = 0;
  let exceeded = false;
  const walk = (parent: ParentNode, depth: number): FormattedMessageNode[] => {
    if (depth > MAX_DEPTH) { exceeded = true; return []; }
    const output: FormattedMessageNode[] = [];
    for (const node of parent.childNodes) {
      if (++visited > MAX_NODES) { exceeded = true; break; }
      if (node.nodeType === 3) { if (node.textContent) output.push({ type: 'text', text: node.textContent }); continue; }
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      const name = element.localName.toLowerCase();
      if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || dropped.has(name)) continue;
      if (name === 'img') {
        const alt = (element.getAttribute('alt') ?? '').slice(0, 256);
        const src = element.getAttribute('src') ?? '';
        if (element.hasAttribute('data-mx-emoticon') && /^mxc:\/\/[a-z0-9.:[\]-]+\/[a-z0-9_-]+$/iu.test(src) && src.length <= 2048) {
          output.push({ type: 'emoticon', mxcUrl: src, alt: alt || 'Custom emoji' });
        } else if (alt) output.push({ type: 'text', text: alt });
        continue;
      }
      const children = walk(element, depth + 1);
      if (exceeded) break;
      if (name === 'span' && element.hasAttribute('data-mx-spoiler')) {
        output.push({ type: 'spoiler', reason: element.getAttribute('data-mx-spoiler')?.slice(0, 200) || undefined, children });
      } else if (name === 'a') {
        const href = safeHref(element.getAttribute('href'));
        if (href) output.push({ type: 'link', href, children, userId: mentionId(href, allowedMentions) });
        else output.push(...children);
      } else {
        const tag = tags.get(name);
        if (!tag) { output.push(...children); continue; }
        const language = tag === 'code' ? /^language-([a-z0-9_+-]{1,40})$/iu.exec(element.getAttribute('class') ?? '')?.[1].toLowerCase() : undefined;
        const start = tag === 'ol' && /^-?\d{1,6}$/u.test(element.getAttribute('start') ?? '') ? Number(element.getAttribute('start')) : undefined;
        output.push({ type: 'element', tag, children, ...(language ? { language } : {}), ...(start !== undefined ? { start } : {}) });
      }
    }
    return output;
  };
  const result = walk(template.content, 0);
  return !exceeded && result.length ? result : undefined;
}
