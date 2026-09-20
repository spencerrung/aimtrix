import { describe, expect, it } from 'vitest';
import { parseIncomingFormatting } from './incomingFormatting';

describe('bounded incoming Matrix formatting', () => {
  it('preserves synthetic cross-client paragraphs, emphasis, lists, quotes, code and nested spoilers', () => {
    expect(parseIncomingFormatting('<p>Hello <b>bold</b> <i>gentle</i><br>next</p><blockquote>Quote</blockquote><ol start="3"><li><span data-mx-spoiler="Plot"><span data-mx-spoiler>Secret</span></span></li></ol><pre><code class="language-TypeScript">const n = &lt;3;</code></pre>')).toEqual([
      { type: 'element', tag: 'p', children: [{ type: 'text', text: 'Hello ' }, { type: 'element', tag: 'strong', children: [{ type: 'text', text: 'bold' }] }, { type: 'text', text: ' ' }, { type: 'element', tag: 'em', children: [{ type: 'text', text: 'gentle' }] }, { type: 'element', tag: 'br', children: [] }, { type: 'text', text: 'next' }] },
      { type: 'element', tag: 'blockquote', children: [{ type: 'text', text: 'Quote' }] },
      { type: 'element', tag: 'ol', start: 3, children: [{ type: 'element', tag: 'li', children: [{ type: 'spoiler', reason: 'Plot', children: [{ type: 'spoiler', reason: undefined, children: [{ type: 'text', text: 'Secret' }] }] }] }] },
      { type: 'element', tag: 'pre', children: [{ type: 'element', tag: 'code', language: 'typescript', children: [{ type: 'text', text: 'const n = <3;' }] }] },
    ]);
  });

  it('removes Matrix reply fallback while keeping genuine quotes and escaped literal HTML', () => {
    expect(parseIncomingFormatting('<mx-reply><blockquote>Old quotation</blockquote></mx-reply><blockquote>Real quote</blockquote>&lt;img src=x onerror=alert(1)&gt;')).toEqual([
      { type: 'element', tag: 'blockquote', children: [{ type: 'text', text: 'Real quote' }] },
      { type: 'text', text: '<img src=x onerror=alert(1)>' },
    ]);
  });

  it.each(['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'java&#10;script:alert(1)', 'data:text/html,attack', 'vbscript:attack', 'file:///etc/passwd', '//tracking.invalid/pixel', '/relative', 'https://user:secret@example.test/', 'https:\\example.test', 'mailto:user@example.test?body=secret'])('strips unsafe link %s while retaining its label', (href) => {
    expect(parseIncomingFormatting(`<a href="${href}">Readable</a>`)).toEqual([{ type: 'text', text: 'Readable' }]);
  });

  it('retains bounded safe links and recognizes only declared mention IDs', () => {
    expect(parseIncomingFormatting('<a href="https://matrix.to/#/%40alice%3Atest" target="_self">Alice</a><a href="https://example.test/a?b=1&amp;c=2">Site</a><a href="matrix:r/test:example.test">Room</a>', ['@alice:test'])).toEqual([
      { type: 'link', href: 'https://matrix.to/#/%40alice%3Atest', userId: '@alice:test', children: [{ type: 'text', text: 'Alice' }] },
      { type: 'link', href: 'https://example.test/a?b=1&c=2', userId: undefined, children: [{ type: 'text', text: 'Site' }] },
      { type: 'link', href: 'matrix:r/test:example.test', userId: undefined, children: [{ type: 'text', text: 'Room' }] },
    ]);
    expect(parseIncomingFormatting('<a href="https://matrix.to/#/@alice:test">Alice</a>')?.[0]).not.toHaveProperty('userId', '@alice:test');
  });

  it('excludes executable namespaces, arbitrary attributes/styles and remote resources', () => {
    const tree = parseIncomingFormatting('<script>alert(1)</script><style>body{display:none}</style><svg><a href="javascript:attack">attack</a></svg><math><mtext>attack</mtext></math><iframe src="https://tracking.invalid"></iframe><img src="https://tracking.invalid/pixel" onerror="attack" alt="Readable picture"><p style="background:url(https://tracking.invalid)" onclick="attack" id="impersonation">Safe</p><object data="https://tracking.invalid"></object>');
    expect(tree).toEqual([{ type: 'text', text: 'Readable picture' }, { type: 'element', tag: 'p', children: [{ type: 'text', text: 'Safe' }] }]);
    expect(JSON.stringify(tree)).not.toMatch(/tracking|onclick|style|attack|impersonation/);
  });

  it('emits only MXC metadata for authenticated emoticons, never image attributes', () => {
    expect(parseIncomingFormatting('<img data-mx-emoticon src="mxc://test/bufo" alt=":bufo:" width="9000" style="position:fixed"><img data-mx-emoticon src="https://tracking.invalid/emoji" alt=":remote:"><img src="mxc://test/photo" alt="Photo">')).toEqual([
      { type: 'emoticon', mxcUrl: 'mxc://test/bufo', alt: ':bufo:' }, { type: 'text', text: ':remote:' }, { type: 'text', text: 'Photo' },
    ]);
  });

  it('keeps malformed foreign-namespace markup inert without reserializing it as HTML', () => {
    const payload = '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=https://tracking.invalid onerror=attack>"></table></mtext></math><p>Readable</p>';
    const tree = parseIncomingFormatting(payload);
    expect(JSON.stringify(tree)).not.toMatch(/tracking|onerror|attack|style/);
    expect(JSON.stringify(tree)).toContain('Readable');
    expect(document.querySelector('img[src*="tracking.invalid"]')).toBeNull();
  });

  it('falls back to plain text for oversized input, node budgets and excessive nesting', () => {
    expect(parseIncomingFormatting('x'.repeat(65_537))).toBeUndefined();
    expect(parseIncomingFormatting('<br>'.repeat(2049))).toBeUndefined();
    expect(parseIncomingFormatting('<div>'.repeat(26) + 'text' + '</div>'.repeat(26))).toBeUndefined();
    expect(parseIncomingFormatting('<script>discarded</script>')).toBeUndefined();
    expect(parseIncomingFormatting({ html: '<b>wrong type</b>' })).toBeUndefined();
  });
});
