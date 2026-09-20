import { useEffect, useState, useRef, type CSSProperties, type ReactNode } from 'react';
import { Images, Paperclip, X } from 'lucide-react';
import { Dialog, DialogClose } from '../../components/Dialog';
import { useMediaSource } from '../../matrix/useMediaSource';
import type { MessageSummary } from '../../matrix/viewModels';
import type { FormattedMessageNode } from '../../matrix/incomingFormatting';
import { emojiReactionKey, type EmojiPackEntry } from '../media/emojiPacks';
import { copyMessageText } from './messageClipboard';
import './messagePresentation.css';

export type LinkPreview = { title?: string; description?: string; imageUrl?: string; siteName?: string };
export function EmojiAsset({
  entry,
  alt = '',
  title,
  style,
}: {
  entry: Pick<EmojiPackEntry, 'emoji' | 'name' | 'previewSrc' | 'src'>;
  alt?: string;
  title?: string;
  style?: CSSProperties;
}) {
  const [animated, setAnimated] = useState(false);
  if (!entry.src) return entry.emoji;
  const canAnimate = Boolean(entry.previewSrc && entry.previewSrc !== entry.src);
  return <img
    className="emoji-asset"
    src={animated ? entry.src : entry.previewSrc ?? entry.src}
    alt={alt}
    title={title}
    style={style}
    loading="lazy"
    onPointerEnter={canAnimate ? () => setAnimated(true) : undefined}
    onPointerLeave={canAnimate ? () => setAnimated(false) : undefined}
  />;
}

const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;

function firstSharedUrl(body: string): string | undefined {
  const match = body.match(URL_PATTERN)?.[0];
  return match?.replace(/[),.!?]+$/, '');
}

function LinkifiedText({ body }: { body: string }) {
  const parts = body.split(/(?:https?:\/\/|matrix:)[^\s<>()]+/gi);
  const links = body.match(/(?:https?:\/\/|matrix:)[^\s<>()]+/gi) ?? [];
  return <>{parts.flatMap((part, index) => {
    const link = links[index];
    const url = link && (/^(?:matrix:|https:\/\/matrix\.to\/)/i.test(link) ? link : link.replace(/[),.!?]+$/, ''));
    return [part, url ? <a href={url} target="_blank" rel="noreferrer" key={`${url}:${index}`}>{url}</a> : null];
  })}</>;
}

const codeKeywords: Record<string, string[]> = {
  typescript: ['as', 'async', 'await', 'class', 'const', 'else', 'export', 'extends', 'false', 'for', 'from', 'function', 'if', 'import', 'interface', 'let', 'new', 'null', 'of', 'return', 'this', 'throw', 'true', 'type', 'undefined', 'while'],
  javascript: ['async', 'await', 'class', 'const', 'else', 'export', 'extends', 'false', 'for', 'from', 'function', 'if', 'import', 'let', 'new', 'null', 'of', 'return', 'this', 'throw', 'true', 'undefined', 'while'],
  python: ['and', 'as', 'class', 'def', 'elif', 'else', 'False', 'for', 'from', 'if', 'import', 'in', 'is', 'None', 'not', 'or', 'return', 'True', 'while', 'with'],
  rust: ['as', 'async', 'const', 'else', 'enum', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'pub', 'return', 'self', 'struct', 'trait', 'true', 'type', 'use', 'while'],
  bash: ['case', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in', 'then', 'while'],
  json: [],
  yaml: [],
  text: [],
};
const codeTokenPattern = /(\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*)/g;

function HighlightedCode({ code, language }: { code: string; language: string }) {
  const keywords = new Set(codeKeywords[language] ?? []);
  const hashComments = ['bash', 'python', 'yaml'].includes(language);
  let cursor = 0;
  const parts: ReactNode[] = [];
  for (const match of code.matchAll(codeTokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > cursor) parts.push(code.slice(cursor, index));
    const isComment = token.startsWith('//') || (hashComments && token.startsWith('#'));
    const className = isComment
      ? 'code-token--comment'
      : token.startsWith('"') || token.startsWith("'")
        ? 'code-token--string'
        : /^\d/.test(token)
          ? 'code-token--number'
          : keywords.has(token)
            ? 'code-token--keyword'
            : undefined;
    const color = className === 'code-token--keyword' ? 'var(--code-keyword)' : className === 'code-token--string' ? 'var(--code-string)' : undefined;
    parts.push(className ? <span className={className} style={color ? { color } : undefined} key={`${index}:${token}`}>{token}</span> : token);
    cursor = index + token.length;
  }
  if (cursor < code.length) parts.push(code.slice(cursor));
  return <>{parts}</>;
}

function CodeSnippet({ code, language }: { code: string; language: string }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    setCopyState(await copyMessageText(code) ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState('idle'), 1800);
  };
  return <section className="message-code" aria-label={`${language} code block`}>
    <header><span>{language}</span><button type="button" onClick={() => void copy()}>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}</button></header>
    <pre tabIndex={0}><code><HighlightedCode code={code} language={language} /></code></pre>
  </section>;
}

function CodeFileMessage({ message, source }: { message: MessageSummary; source: string }) {
  const [expanded, setExpanded] = useState(false);
  const [contents, setContents] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    let active = true;
    void fetch(source).then((response) => response.text()).then((text) => {
      if (active) setContents(text);
    }).catch(() => {
      if (active) setLoadFailed(true);
    });
    return () => { active = false; };
  }, [source]);
  const language = message.codeLanguage ?? 'text';
  const preview = contents?.split('\n').slice(0, 5).join('\n') ?? '';
  const copy = async () => {
    setCopyState(await copyMessageText(contents ?? '') ? 'copied' : 'failed');
    window.setTimeout(() => setCopyState('idle'), 1800);
  };
  return <section className="message-code code-file" aria-label={`${message.fileName ?? message.body} code file`}>
    <header style={{ gap: 8 }}><span style={{ display: 'grid', minWidth: 0, gap: 2 }}><strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{message.fileName ?? message.body}</strong><small style={{ color: 'var(--text-faint)', font: '700 0.58rem ui-monospace, monospace', textTransform: 'uppercase' }}>{language}</small></span><span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4 }}>
      <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? 'Collapse' : 'Expand'}</button>
      <button type="button" onClick={() => void copy()} disabled={!contents}>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}</button>
      <a href={source} download={message.fileName ?? message.body} style={{ padding: '2px 5px', color: 'var(--blue-deep)', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface-raised)', font: 'inherit', textDecoration: 'none' }}>Download</a>
    </span></header>
    {loadFailed ? <p role="status">This code file could not be loaded.</p> : <pre tabIndex={0}><code><HighlightedCode code={expanded ? contents ?? '' : preview} language={language} /></code></pre>}
    {!expanded && contents && contents.split('\n').length > 5 ? <button type="button" style={{ margin: '0 9px 8px' }} onClick={() => setExpanded(true)}>Show full file</button> : null}
  </section>;
}

const CUSTOM_EMOJI_PATTERN = /(:[a-z0-9][a-z0-9_+-]*:)/gi;

function MentionedText({ body, mentions, keyPrefix }: { body: string; mentions: NonNullable<MessageSummary['mentions']>; keyPrefix: string }) {
  const segments: ReactNode[] = [];
  let cursor = 0;
  const candidates = mentions
    .filter((mention) => mention.label && body.includes(mention.label))
    .sort((left, right) => right.label.length - left.label.length);
  while (cursor < body.length) {
    let selected: (typeof candidates)[number] | undefined;
    let selectedIndex = -1;
    for (const candidate of candidates) {
      let index = body.indexOf(candidate.label, cursor);
      while (index >= 0) {
        const previous = body.slice(0, index).match(/.$/u)?.[0];
        const next = body.slice(index + candidate.label.length).match(/^./u)?.[0];
        if (
          (!previous || !/[\p{L}\p{N}_]/u.test(previous)) &&
          (!next || !/[\p{L}\p{N}_]/u.test(next))
        ) break;
        index = body.indexOf(candidate.label, index + candidate.label.length);
      }
      if (index >= 0 && (selectedIndex < 0 || index < selectedIndex)) {
        selected = candidate;
        selectedIndex = index;
      }
    }
    if (!selected || selectedIndex < 0) {
      segments.push(<LinkifiedText body={body.slice(cursor)} key={`${keyPrefix}:tail`} />);
      break;
    }
    if (selectedIndex > cursor) {
      segments.push(<LinkifiedText body={body.slice(cursor, selectedIndex)} key={`${keyPrefix}:text:${cursor}`} />);
    }
    segments.push(
      <a
        className="message-mention"
        href={`https://matrix.to/#/${encodeURIComponent(selected.userId)}`}
        target="_blank"
        rel="noreferrer"
        key={`${keyPrefix}:mention:${selected.userId}:${selectedIndex}`}
      >{selected.label}</a>,
    );
    cursor = selectedIndex + selected.label.length;
  }
  return <>{segments}</>;
}

function InlineMessageText({ body, emojiCatalog, mentions = [] }: { body: string; emojiCatalog: EmojiPackEntry[]; mentions?: MessageSummary['mentions'] }) {
  const renderPlainText = (text: string, keyPrefix: string) => text.split(CUSTOM_EMOJI_PATTERN).map((token, tokenIndex) => {
    const entry = token.startsWith(':') && token.endsWith(':')
      ? emojiCatalog.find((candidate) => candidate.src && emojiReactionKey(candidate).toLowerCase() === token.toLowerCase())
      : undefined;
    if (entry?.src) {
      return <EmojiAsset entry={entry} style={{ verticalAlign: 'middle' }} alt={entry.name} title={entry.name} key={`${keyPrefix}:emoji:${tokenIndex}`} />;
    }
    if (!mentions.length) return <LinkifiedText body={token} key={`${keyPrefix}:text:${tokenIndex}`} />;
    return <MentionedText body={token} mentions={mentions} keyPrefix={`${keyPrefix}:${tokenIndex}`} key={`${keyPrefix}:mentions:${tokenIndex}`} />;
  });
  return <>{renderPlainText(body, 'inline')}</>;
}

function MessageText({ body, emojiCatalog, mentions }: { body: string; emojiCatalog: EmojiPackEntry[]; mentions?: MessageSummary['mentions'] }) {
  const blocks = body.split(/```(?:(typescript|javascript|python|rust|bash|json|yaml)\n)?([\s\S]*?)```/gi);
  return <>{blocks.map((block, index) => {
    if (index % 3 === 1) return null;
    if (index % 3 === 2) {
      const language = blocks[index - 1] || 'text';
      return <CodeSnippet code={block} language={language} key={`code:${index}`} />;
    }
    if (!block) return null;
    const inline = block.split(/(`[^`]+`|\*\*[^*]+\*\*|_[^_\n]+_)/g);
    return <p key={`text:${index}`}>{inline.map((part, partIndex) => {
      if (part.startsWith('`') && part.endsWith('`')) return <code key={partIndex}>{part.slice(1, -1)}</code>;
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={partIndex}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('_') && part.endsWith('_')) return <em key={partIndex}>{part.slice(1, -1)}</em>;
      return <InlineMessageText body={part} emojiCatalog={emojiCatalog} mentions={mentions} key={partIndex} />;
    })}</p>;
  })}</>;
}


export function MessageContent({ message, dataSaver = false, autoplayMedia = true, emojiCatalog = [], onMediaLoad = () => {} }: {
  message: MessageSummary; dataSaver?: boolean; autoplayMedia?: boolean;
  emojiCatalog?: EmojiPackEntry[]; onMediaLoad?: () => void;
}) {
  const gated = Boolean(message.mediaUrl) && (dataSaver || (!autoplayMedia && message.mimeType === 'image/gif'));
  const [revealed, setRevealed] = useState(!gated);
  const [viewer, setViewer] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const mediaTrigger = useRef<HTMLButtonElement>(null);
  const mediaSrc = useMediaSource(revealed ? message.mediaUrl : undefined, message.kind === 'sticker' ? 320 : 720, message.encryptedFile, message.mimeType);
  const viewerSource = useMediaSource(viewer ? message.mediaUrl : undefined, 2400, message.encryptedFile, message.mimeType);
  return <>
    {!revealed && message.mediaUrl ? <button className="message-media-gate" type="button" onClick={() => setRevealed(true)}><Images size={16} /> Load {message.mimeType === 'image/gif' ? 'animated media' : 'media'}</button>
      : mediaSrc && message.mediaKind === 'video' ? <video className="message-media" src={mediaSrc} controls preload="metadata" onLoadedMetadata={onMediaLoad} />
      : mediaSrc && message.mediaKind === 'audio' ? <audio className="message-audio" src={mediaSrc} controls preload="metadata" />
      : mediaSrc && message.mediaKind === 'file' ? message.codeFile ? <CodeFileMessage message={message} source={mediaSrc} /> : <a className="message-file" href={mediaSrc} download={message.fileName ?? message.body}><Paperclip size={15} /> {message.fileName ?? message.body}</a>
      : mediaSrc ? message.mediaKind === 'image' && message.kind !== 'sticker'
        ? <button ref={mediaTrigger} className="message-media-button" type="button" aria-label={`View ${message.body} full size`} onClick={() => setViewer(true)}><img className="message-media" src={mediaSrc} alt={message.body} loading="lazy" onLoad={onMediaLoad} /></button>
        : <img className="message-sticker" src={mediaSrc} alt={message.body} loading="lazy" onLoad={onMediaLoad} />
      : <div className={`message-kind--${message.kind}`}>
        {message.kind === 'emote' ? `${message.senderName} ` : ''}
        {message.kind === 'unsupported' ? <p className="message-unsupported">{message.body || 'This message type is not supported yet.'}</p>
          : message.formatted?.length ? <RichMessage nodes={message.formatted} dataSaver={dataSaver} autoplayMedia={autoplayMedia} onMediaLoad={onMediaLoad} />
          : <MessageText body={message.body} emojiCatalog={emojiCatalog} mentions={message.mentions} />}
      </div>}
    {message.fileName && message.body !== message.fileName && (mediaSrc || !revealed) ? <div className="message-caption">{message.formatted?.length ? <RichMessage nodes={message.formatted} dataSaver={dataSaver} autoplayMedia={autoplayMedia} onMediaLoad={onMediaLoad} /> : <MessageText body={message.body} emojiCatalog={emojiCatalog} mentions={message.mentions} />}</div> : null}
    {viewer ? <Dialog className="media-viewer" backdropClassName="media-viewer-backdrop" aria-label={`Viewing ${message.body}`} onClose={() => { setViewer(false); setActualSize(false); }}>
      <header><strong>{message.body}</strong><span><button type="button" aria-pressed={actualSize} onClick={() => setActualSize((value) => !value)}>{actualSize ? 'Fit image' : 'Actual size'}</button><DialogClose aria-label="Close image viewer"><X size={18} /></DialogClose></span></header>
      {viewerSource ? <img className={actualSize ? 'is-actual-size' : undefined} src={viewerSource} alt={message.body} /> : <p role="status">Loading image…</p>}
    </Dialog> : null}
  </>;
}
export function LinkPreviewCard({ message, onLoad }: { message: MessageSummary; onLoad?: (url: string) => Promise<LinkPreview | undefined> }) {
  const url = firstSharedUrl(message.body);
  const [preview, setPreview] = useState<LinkPreview>();
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(`aimtrix.dismissed-link-preview.v1:${message.id}`) === '1'; } catch { return false; } });

  useEffect(() => {
    if (!url || !onLoad || dismissed) return;
    let active = true;
    const request = onLoad(url);
    void request.then((result) => { if (active) setPreview(result); }).catch(() => { /* The original link remains available. */ });
    return () => { active = false; };
  }, [dismissed, onLoad, url]);

  if (!url || dismissed || !preview || (!preview.title && !preview.description && !preview.imageUrl)) return null;
  return (
    <article className="link-preview">
      {preview.imageUrl ? <img src={preview.imageUrl} alt="" loading="lazy" /> : null}
      <div>
        <small>{preview.siteName || new URL(url).hostname}</small>
        {preview.title ? <a href={url} target="_blank" rel="noreferrer">{preview.title}</a> : null}
        {preview.description ? <p>{preview.description}</p> : null}
      </div>
      <button type="button" aria-label="Hide link preview" title="Hide preview" onClick={() => {
        try { localStorage.setItem(`aimtrix.dismissed-link-preview.v1:${message.id}`, '1'); } catch { /* Dismiss for this view when storage is unavailable. */ }
        setDismissed(true);
      }}><X size={14} /></button>
    </article>
  );
}


const hasBlock = (nodes: FormattedMessageNode[]): boolean => nodes.some((node) => node.type === 'element' && ['p', 'pre', 'blockquote', 'ul', 'ol', 'hr'].includes(node.tag) || 'children' in node && hasBlock(node.children));

const nodeText = (nodes: FormattedMessageNode[]): string => nodes.map((node): string => node.type === 'text' ? node.text : node.type === 'emoticon' ? node.alt : nodeText(node.children)).join('');

function Spoiler({ node, children, onMediaLoad }: { node: Extract<FormattedMessageNode, { type: 'spoiler' }>; children: ReactNode; onMediaLoad: () => void }) {
  const [revealed, setRevealed] = useState(false);
  return <span className="message-spoiler"><button type="button" aria-expanded={revealed} onClick={() => {
    setRevealed((value) => !value);
    requestAnimationFrame(onMediaLoad);
  }}>{revealed ? 'Hide spoiler' : node.reason ? `Reveal spoiler: ${node.reason}` : 'Reveal spoiler'}</button><span hidden={!revealed}>{revealed ? children : null}</span></span>;
}

function RichEmoticon({ node, dataSaver, autoplayMedia, onMediaLoad }: { node: Extract<FormattedMessageNode, { type: 'emoticon' }>; dataSaver: boolean; autoplayMedia: boolean; onMediaLoad: () => void }) {
  const [revealed, setRevealed] = useState(!dataSaver && autoplayMedia);
  const source = useMediaSource(revealed ? node.mxcUrl : undefined, 64);
  return !revealed ? <button className="message-emoticon-load" type="button" aria-label={`Load emoji ${node.alt}`} onClick={() => setRevealed(true)}>{node.alt}</button>
    : source ? <img className="emoji-asset" src={source} alt={node.alt} loading="lazy" onLoad={onMediaLoad} /> : <span>{node.alt}</span>;
}

function RichMessage({ nodes, dataSaver, autoplayMedia, onMediaLoad }: { nodes: FormattedMessageNode[]; dataSaver: boolean; autoplayMedia: boolean; onMediaLoad: () => void }) {
  return <>{nodes.map((node, index) => {
    if (node.type === 'text') return node.text;
    if (node.type === 'emoticon') return <RichEmoticon key={index} node={node} dataSaver={dataSaver} autoplayMedia={autoplayMedia} onMediaLoad={onMediaLoad} />;
    const children = <RichMessage nodes={node.children} dataSaver={dataSaver} autoplayMedia={autoplayMedia} onMediaLoad={onMediaLoad} />;
    if (node.type === 'spoiler') return <Spoiler key={index} node={node} onMediaLoad={onMediaLoad}>{children}</Spoiler>;
    if (node.type === 'link') return <a key={index} href={node.href} className={node.userId ? 'message-mention' : undefined} target="_blank" rel="noreferrer noopener">{children}</a>;
    if (node.tag === 'br') return <br key={index} />;
    if (node.tag === 'hr') return <hr key={index} />;
    if (node.tag === 'pre') {
      const code = node.children.find((child) => child.type === 'element' && child.tag === 'code');
      return <CodeSnippet key={index} code={nodeText(node.children)} language={node.language ?? (code?.type === 'element' ? code.language : undefined) ?? 'text'} />;
    }
    const Tag = node.tag === 'p' && hasBlock(node.children) ? 'div' : node.tag;
    return <Tag key={index} {...(Tag === 'ol' && node.start !== undefined ? { start: node.start } : {})}>{children}</Tag>;
  })}</>;
}
