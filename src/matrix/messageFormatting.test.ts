import { describe, expect, it } from 'vitest';
import {
  matrixFormattedMessage,
  matrixReplyFormattedBody,
  type MatrixMessageMention,
} from './messageFormatting';

const mentions: MatrixMessageMention[] = [
  { userId: '@alice:example.org', label: 'Alice' },
  { userId: '@bob:example.org', label: 'Bob' },
];

describe('matrixFormattedMessage', () => {
  it('preserves plain messages without formatting', () => {
    expect(matrixFormattedMessage('hello 👩🏽‍💻')).toEqual({ body: 'hello 👩🏽‍💻', usedMentionUserIds: [] });
  });

  it('links exact visible mentions and reports unique used user IDs', () => {
    expect(matrixFormattedMessage('@Alice, meet @Bob and @Alice.', mentions)).toEqual({
      body: '@Alice, meet @Bob and @Alice.',
      formattedBody: '<p><a href="https://matrix.to/#/%40alice%3Aexample.org">@Alice</a>, meet <a href="https://matrix.to/#/%40bob%3Aexample.org">@Bob</a> and <a href="https://matrix.to/#/%40alice%3Aexample.org">@Alice</a>.</p>',
      usedMentionUserIds: ['@alice:example.org', '@bob:example.org'],
    });
  });

  it('does not link partial or differently cased labels', () => {
    const result = matrixFormattedMessage('@Alicea @alice @Alice', mentions);
    expect(result.formattedBody).toBe('@Alicea @alice <a href="https://matrix.to/#/%40alice%3Aexample.org">@Alice</a>'.replace(/^/, '<p>') + '</p>');
    expect(result.usedMentionUserIds).toEqual(['@alice:example.org']);
  });

  it('requires a mention boundary before and after the visible label', () => {
    const result = matrixFormattedMessage('foo@Alice @Alicea', mentions);
    expect(result.formattedBody).toBe('<p>foo@Alice @Alicea</p>');
    expect(result.usedMentionUserIds).toEqual([]);
  });

  it('does not link mentions inside inline or fenced code', () => {
    const result = matrixFormattedMessage('Hi @Alice and `@Bob`\n```typescript\nconst owner = "@Alice";\n```', mentions);
    expect(result.formattedBody).toBe('<p>Hi <a href="https://matrix.to/#/%40alice%3Aexample.org">@Alice</a> and <code>@Bob</code><br></p><pre><code class="language-typescript">const owner = &quot;@Alice&quot;;\n</code></pre>');
    expect(result.usedMentionUserIds).toEqual(['@alice:example.org']);
  });

  it('escapes malicious labels while preserving emoji exactly', () => {
    const malicious = { userId: '@evil:example.org', label: '<img src=x onerror=alert(1)>' };
    const body = 'Hello @<img src=x onerror=alert(1)> 👨‍👩‍👧‍👦🫶🏿';
    const result = matrixFormattedMessage(body, [malicious]);
    expect(result.formattedBody).toBe('<p>Hello <a href="https://matrix.to/#/%40evil%3Aexample.org">@&lt;img src=x onerror=alert(1)&gt;</a> 👨‍👩‍👧‍👦🫶🏿</p>');
    expect(result.usedMentionUserIds).toEqual(['@evil:example.org']);
    expect(result.body).toBe(body);
  });

  it('preserves markdown behavior around mentions', () => {
    const result = matrixFormattedMessage('**Hi @Alice** and _welcome_ 👋', mentions);
    expect(result.formattedBody).toBe('<p><strong>Hi <a href="https://matrix.to/#/%40alice%3Aexample.org">@Alice</a></strong> and <em>welcome</em> 👋</p>');
  });

  it('does not let underscores in mention labels or IDs corrupt generated anchors', () => {
    const result = matrixFormattedMessage('**Hi @Mara_one_two**', [{
      userId: '@mara_one_two:example.org',
      label: 'Mara_one_two',
    }]);
    expect(result.formattedBody).toBe('<p><strong>Hi <a href="https://matrix.to/#/%40mara_one_two%3Aexample.org">@Mara_one_two</a></strong></p>');
    expect(result.usedMentionUserIds).toEqual(['@mara_one_two:example.org']);
  });

  it('builds a standard rich reply fallback before formatted reply content', () => {
    expect(matrixReplyFormattedBody('!room:example.org', {
      id: '$event:example.org',
      senderId: '@alice:example.org',
      body: 'Original <message>',
    }, '<p>Reply</p>')).toBe(
      '<mx-reply><blockquote><a href="https://matrix.to/#/!room%3Aexample.org/%24event%3Aexample.org">In reply to</a> <a href="https://matrix.to/#/%40alice%3Aexample.org">@alice:example.org</a><br>Original &lt;message&gt;</blockquote></mx-reply><p>Reply</p>',
    );
  });
});
