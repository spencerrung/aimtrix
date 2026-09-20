import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { BellRing, Film, Paperclip, Plus, Search, Send, Smile, Sticker, X } from 'lucide-react';
import { Popover } from '../../components/Popover';
import { useMediaSource } from '../../matrix/useMediaSource';
import type { MemberSummary } from '../../matrix/viewModels';
import { readNativeClipboardImage } from '../../platform/clipboardImage';
import { emojiReactionKey, loadEmojiPacks, type EmojiPackDefinition, type EmojiPackEntry } from '../media/emojiPacks';
import { GifPicker, type GifChoice } from '../media/GifPicker';
import { loadStickerPack } from '../media/stickerPacks';
import { InlineComposer, type InlineComposerHandle, type InlineComposerSelection } from './InlineComposer';
import type { DraftInlineEmoji, DraftMention, StructuredDraft } from './structuredDrafts';

export type ComposerResult = 'sent' | 'edited' | 'retained' | false;
export interface ComposerSticker { id: string; name: string; src: string }
export interface SharedComposerHandle extends InlineComposerHandle { getElement(): HTMLElement | null }
export interface SharedComposerProps {
  /** Changes reset transient pickers; use room+thread identity, not draft revision. */
  contextKey: string;
  value: StructuredDraft;
  onChange(value: StructuredDraft): void;
  onSubmit(body: string, mentions: DraftMention[], inlineEmojis: DraftInlineEmoji[]): Promise<ComposerResult>;
  stageFiles?(files: File[], codeLanguage?: string): void | Promise<void>;
  sendSticker?(sticker: ComposerSticker): void | Promise<void>;
  sendGif?(gif: GifChoice): void | Promise<void>;
  onNudge?(): void | Promise<void>;
  onEditLatest?(): void;
  onCancelContext?(): void;
  onSubmitted?(result: Exclude<ComposerResult, false>): void;
  members: MemberSummary[];
  emojiPacks: EmojiPackDefinition[];
  emojiAssetBaseUrl?: string;
  stickerPacks: Array<{ name: string; manifestUrl: string }>;
  defaultStickerPack?: string;
  gifEndpoint?: string;
  roomName: string;
  thread?: boolean;
  active?: boolean;
  sending?: boolean;
  disabled?: boolean;
}

const FALLBACK = ['😀', '😂', '🥹', '😍', '😎', '🤔', '😭', '😡', '👍', '👀', '✨', '💙', '🎉', '🔥', '🫧', '☕', '💾', '🌈'];
const LANGUAGES = { text: 'Text', typescript: 'TS', javascript: 'JS', python: 'Py', rust: 'Rust', bash: 'Bash', json: 'JSON', yaml: 'YAML' };
const EXTENSIONS: Record<string, string> = { bash: 'sh', javascript: 'js', json: 'json', python: 'py', rust: 'rs', text: 'txt', typescript: 'ts', yaml: 'yaml' };
function recentEmoji(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem('aimtrix.recent-emoji.v1') ?? '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length <= 128).slice(0, 18) : []; } catch { return []; }
}
function visibleMention(body: string, label: string) {
  const escaped = `@${label}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'u').test(body);
}
function Asset({ entry }: { entry: Pick<EmojiPackEntry, 'emoji' | 'src' | 'previewSrc' | 'name'> }) {
  const [animated, setAnimated] = useState(false);
  const source = useMediaSource(animated ? entry.src : entry.previewSrc ?? entry.src, 180);
  return entry.emoji ? <>{entry.emoji}</> : source ? <img className="emoji-asset" src={source} alt="" loading="lazy" onPointerEnter={() => setAnimated(true)} onPointerLeave={() => setAnimated(false)} /> : <span className="spinner" aria-label={`Loading ${entry.name}`} />;
}

/** Shared room/thread tools; the owner performs revision-safe send cleanup. */
export const SharedComposer = forwardRef<SharedComposerHandle, SharedComposerProps>(function SharedComposer(props, forwardedRef) {
  const { value, onChange, members, emojiPacks, emojiAssetBaseUrl, stickerPacks, defaultStickerPack, gifEndpoint, thread, roomName, active = true, disabled = false, sending = false } = props;
  const composer = useRef<InlineComposerHandle>(null);
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = useRef(props);
  const mounted = useRef(true);
  useLayoutEffect(() => { current.current = props; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const change = (next: StructuredDraft) => { current.current = { ...current.current, value: next }; onChange(next); };
  useImperativeHandle(forwardedRef, () => ({
    focus: () => composer.current?.focus(), clear: () => composer.current?.clear(),
    getSelection: () => composer.current?.getSelection() ?? null, setSelection: (selection) => composer.current?.setSelection(selection),
    insertText: (text, selection) => composer.current?.insertText(text, selection), insertToken: (token, selection) => composer.current?.insertToken(token, selection),
    replaceRange: (start, end, replacement) => composer.current?.replaceRange(start, end, replacement), getValue: () => composer.current?.getValue() ?? { text: '', tokens: [] },
    getElement: () => form.current?.querySelector<HTMLElement>('[contenteditable]') ?? null,
  }), []);
  const [picker, setPicker] = useState<'emoji' | 'sticker' | 'gif'>();
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<EmojiPackEntry[]>([]);
  const requested = useRef('');
  const [focused, setFocused] = useState(false);
  const [caret, setCaret] = useState(value.body.length);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [dismissed, setDismissed] = useState('');
  const [recent, setRecent] = useState<string[]>(recentEmoji);
  const [manifest, setManifest] = useState(defaultStickerPack ?? stickerPacks[0]?.manifestUrl ?? '');
  const [stickers, setStickers] = useState<ComposerSticker[]>([]);
  const [stickerCache, setStickerCache] = useState<Record<string, ComposerSticker[]>>({});
  const [stickerStatus, setStickerStatus] = useState<'loading' | 'ready' | 'error'>('ready');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sendGeneration = useRef(0);
  const contextGeneration = useRef(0);
  const [error, setError] = useState('');
  const identity = props.contextKey;
  const previousContext = useRef({ identity, active });
  useLayoutEffect(() => { sendGeneration.current++; contextGeneration.current++; busyRef.current = false; }, [identity]);
  const mentionMatch = focused ? /(?:^|\s)@([^\s@]*)$/.exec(value.body.slice(0, caret)) : null;
  const colonMatch = focused ? /(?:^|\s):([a-z0-9_+-]{2,})$/i.exec(value.body.slice(0, caret)) : null;
  const suggestionKey = mentionMatch ? `@${mentionMatch[1]}` : colonMatch ? `:${colonMatch[1]}` : '';
  const [previousSuggestion, setPreviousSuggestion] = useState(suggestionKey);
  if (previousSuggestion !== suggestionKey) { setPreviousSuggestion(suggestionKey); setSuggestionIndex(0); }
  const mentionResults = mentionMatch && dismissed !== suggestionKey ? members.filter((member) => `${member.id} ${member.displayName}`.toLowerCase().includes(mentionMatch[1].toLowerCase())).slice(0, 6) : [];
  const colonResults: EmojiPackEntry[] = colonMatch && dismissed !== suggestionKey
    ? [...catalog, ...Object.values(stickerCache).flat()].filter((entry) => `${entry.name} ${'aliases' in entry ? entry.aliases?.join(' ') : ''}`.toLowerCase().includes(colonMatch[1].toLowerCase())).slice(0, 10) : [];
  const loadCatalog = useCallback(() => {
    const key = JSON.stringify([emojiPacks, emojiAssetBaseUrl]);
    if (!emojiPacks.length || requested.current === key) return;
    requested.current = key;
    void loadEmojiPacks(emojiPacks, emojiAssetBaseUrl).then((entries) => { if (mounted.current && requested.current === key) setCatalog(entries); }).catch(() => { if (requested.current === key) requested.current = ''; });
  }, [emojiPacks, emojiAssetBaseUrl]);
  useEffect(() => { if (active && (picker === 'emoji' || colonMatch)) loadCatalog(); }, [active, picker, colonMatch, loadCatalog]);
  useEffect(() => {
    if (!active || picker !== 'sticker' || !manifest) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) setStickerStatus('loading'); });
    void loadStickerPack(manifest, controller.signal).then((entries) => {
      if (controller.signal.aborted) return;
      setStickers(entries); setStickerCache((cache) => ({ ...cache, [manifest]: entries })); setStickerStatus('ready');
    }).catch(() => { if (!controller.signal.aborted) setStickerStatus('error'); });
    return () => controller.abort();
  }, [active, manifest, picker]);
  useEffect(() => {
    if (previousContext.current.identity === identity && previousContext.current.active === active) return;
    previousContext.current = { identity, active };
    queueMicrotask(() => { if (mounted.current && current.current.contextKey === identity) { setPicker(undefined); setMore(false); setDismissed(''); setFocused(false); setError(''); if (!busyRef.current) setBusy(false); } });
  }, [identity, active]);
  const focus = () => {
    const generation = contextGeneration.current;
    const previousFocus = document.activeElement;
    requestAnimationFrame(() => {
      if (mounted.current && contextGeneration.current === generation && current.current.contextKey === identity && current.current.active !== false
        && (document.activeElement === previousFocus || document.activeElement === document.body || form.current?.contains(document.activeElement))) composer.current?.focus();
    });
  };
  const remember = (entry: string) => setRecent((entries) => {
    const next = [entry, ...entries.filter((item) => item !== entry)].slice(0, 18);
    try { localStorage.setItem('aimtrix.recent-emoji.v1', JSON.stringify(next)); } catch { /* Cosmetic recents can remain in memory. */ }
    return next;
  });
  const insertEmoji = (entry: EmojiPackEntry, start?: number, end?: number) => {
    if (entry.emoji) {
      if (start !== undefined) composer.current?.replaceRange(start, end ?? start, entry.emoji);
      else composer.current?.insertText(entry.emoji);
      remember(entry.emoji);
    } else if (entry.src) {
      const token = { id: entry.id, shortcode: `:${entry.id}:`, src: entry.src, alt: entry.name, title: entry.name };
      if (start !== undefined) composer.current?.replaceRange(start, end ?? start, token); else composer.current?.insertToken(token);
      remember(token.shortcode);
    }
    setDismissed(suggestionKey); focus();
  };
  const insertMention = (member: MemberSummary) => {
    if (!mentionMatch) return;
    const label = member.displayName;
    const mentions = [...(current.current.value.mentions ?? []).filter((item) => item.userId !== member.id || item.label !== label), { userId: member.id, label }];
    current.current = { ...current.current, value: { ...current.current.value, mentions } };
    composer.current?.replaceRange(caret - mentionMatch[1].length - 1, caret, `@${label} `);
    setDismissed(suggestionKey); focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, selection: InlineComposerSelection | null) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return false;
    const length = colonResults.length || mentionResults.length;
    if (length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSuggestionIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : length - 1)) % length); return true; }
      if (event.key === 'Escape') { event.preventDefault(); setDismissed(suggestionKey); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        if (colonResults.length && colonMatch) insertEmoji(colonResults[suggestionIndex % length], caret - colonMatch[1].length - 1, caret);
        else insertMention(mentionResults[suggestionIndex % length]);
        return true;
      }
    }
    if (event.key === 'ArrowUp' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !value.body && selection?.start === 0 && selection.end === 0 && props.onEditLatest) { event.preventDefault(); props.onEditLatest(); return true; }
    return false;
  };
  const runTool = (operation: () => void | Promise<void>) => { const generation = contextGeneration.current; setError(''); void Promise.resolve().then(() => { if (mounted.current && contextGeneration.current === generation) return operation(); }).catch(() => { if (mounted.current && contextGeneration.current === generation) setError('That action could not finish. Try again.'); }); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || sending || busyRef.current || !value.body.trim()) return;
    const submitted = current.current.value;
    const mentions = [...(submitted.mentions ?? []), ...(submitted.edit?.mentions ?? [])].filter((mention, index, items) => visibleMention(submitted.body, mention.label) && items.findIndex((item) => item.userId === mention.userId && item.label === mention.label) === index);
    const body = submitted.codeMode ? `\`\`\`${submitted.codeLanguage ?? 'text'}\n${submitted.body}\n\`\`\`` : submitted.body;
    busyRef.current = true; setBusy(true); setError('');
    const generation = ++sendGeneration.current;
    void props.onSubmit(body, mentions, submitted.inlineEmojis ?? []).then((result) => {
      if (result && mounted.current && current.current.contextKey === identity && sendGeneration.current === generation) props.onSubmitted?.(result);
    }).catch(() => { if (mounted.current && current.current.contextKey === identity && sendGeneration.current === generation) setError('The message could not be sent. Your draft is still here.'); }).finally(() => {
      if (!mounted.current || sendGeneration.current !== generation) return;
      busyRef.current = false;
      setBusy(false);
      if (current.current.contextKey === identity && current.current.value === submitted && (document.activeElement === document.body || form.current?.contains(document.activeElement))) focus();
    });
  };
  const stage = (files: File[], codeLanguage?: string) => {
    const prepared = files.map((file) => !file.name && file.type.startsWith('image/') ? new File([file], `pasted-image.${file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'png'}`, { type: file.type }) : file);
    if (prepared.length && props.stageFiles) runTool(() => props.stageFiles!(prepared, codeLanguage));
  };
  const visibleEmoji = [...FALLBACK.map((emoji) => ({ id: emoji, name: emoji, emoji })), ...catalog.filter((entry) => !entry.emoji || !FALLBACK.includes(entry.emoji))]
    .filter((entry) => !query.trim() || `${entry.name} ${entry.emoji ?? ''} ${'aliases' in entry ? entry.aliases?.join(' ') : ''}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => { const rank = (entry: EmojiPackEntry) => { const index = recent.indexOf(emojiReactionKey(entry)); return index < 0 ? 999 : index; }; return rank(a) - rank(b); }).slice(0, query.trim() ? 48 : 240);
  const closeMore = () => { setMore(false); form.current?.querySelector<HTMLButtonElement>('.composer__more')?.focus(); };
  const button = (label: string, action: () => void, icon: React.ReactNode) => <button type="button" className="icon-button" aria-label={label} onClick={action} disabled={disabled}>{icon}</button>;
  return <>
    {value.reply || value.edit ? <div className="composer-context"><div><strong>{value.edit ? 'Editing message' : `Replying to ${value.reply?.senderName}`}</strong><span>{value.edit?.body ?? value.reply?.body}</span></div>{props.onCancelContext ? <button type="button" aria-label="Cancel reply or edit" onClick={props.onCancelContext}><X size={15} /></button> : null}</div> : null}
    {error ? <p role="alert" className="history-feedback">{error}</p> : null}
    {active && picker === 'gif' && gifEndpoint && props.sendGif ? <Popover className="gif-popover" label="GIF picker" onClose={() => setPicker(undefined)}><GifPicker endpoint={gifEndpoint} onSelect={(gif) => { runTool(() => props.sendGif!(gif)); setPicker(undefined); }} /></Popover> : null}
    {active && picker === 'sticker' ? <Popover className="sticker-tray" label="Sticker picker" onClose={() => setPicker(undefined)}><header><strong>Sticker packs</strong><select aria-label="Sticker pack" value={manifest} onChange={(event) => setManifest(event.target.value)}>{stickerPacks.map((pack) => <option value={pack.manifestUrl} key={pack.manifestUrl}>{pack.name}</option>)}</select></header><div aria-busy={stickerStatus === 'loading'}>{stickerStatus === 'loading' ? <p>Loading stickers…</p> : stickerStatus === 'error' ? <p role="alert">This sticker pack could not be loaded.</p> : stickers.map((sticker) => <button type="button" key={`${sticker.id}:${sticker.src}`} aria-label={`Send ${sticker.name}`} onClick={() => { if (props.sendSticker) runTool(() => props.sendSticker!(sticker)); setPicker(undefined); }}><Asset entry={sticker} /></button>)}</div></Popover> : null}
    {active && picker === 'emoji' ? <Popover className="emoji-tray" label="Emoji picker" onClose={() => setPicker(undefined)}><header><strong>Emoji</strong><span>{recent.length ? 'Recents first' : 'Search by name'}</span></header><label className="emoji-search"><Search size={13} /><span className="sr-only">Search emoji</span><input value={query} placeholder="Search emoji" onChange={(event) => setQuery(event.target.value)} /></label><div>{visibleEmoji.map((entry) => <button type="button" key={emojiReactionKey(entry)} aria-label={entry.emoji ? `Insert ${entry.emoji}` : `Insert :${entry.id}:`} title={entry.name} onClick={() => { insertEmoji(entry); setPicker(undefined); setQuery(''); }}><Asset entry={entry} /></button>)}</div></Popover> : null}
    {active && colonResults.length ? <div className="colon-complete" role="listbox" aria-label="Emoji and sticker suggestions">{colonResults.map((entry, index) => <button type="button" role="option" aria-selected={index === suggestionIndex % colonResults.length} className={index === suggestionIndex % colonResults.length ? 'is-active' : ''} key={emojiReactionKey(entry)} onMouseDown={(event) => event.preventDefault()} onClick={() => { if (colonMatch) insertEmoji(entry, caret - colonMatch[1].length - 1, caret); }}><span className="colon-complete__emoji"><Asset entry={entry} /></span><span className="colon-complete__name">{entry.name}</span></button>)}</div> : null}
    {active && mentionResults.length ? <div className="mention-complete" role="listbox" aria-label="Mention a room member">{mentionResults.map((member, index) => <button type="button" role="option" aria-selected={index === suggestionIndex % mentionResults.length} className={index === suggestionIndex % mentionResults.length ? 'is-active' : ''} key={member.id} onMouseDown={(event) => event.preventDefault()} onClick={() => insertMention(member)}><span><strong>{member.displayName}</strong><small>{member.id}</small></span></button>)}</div> : null}
    <form ref={form} className="composer" aria-label={thread ? 'Thread message composer' : 'Message composer'} onSubmit={submit} onKeyDown={(event) => { if (event.key === 'Escape' && more) { event.preventDefault(); event.stopPropagation(); closeMore(); } }}>
      <input ref={fileInput} className="sr-only" type="file" multiple aria-label={thread ? 'Choose thread attachment' : 'Choose attachment'} onChange={(event) => { stage(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <label className="composer__field"><span className="sr-only">{thread ? 'Message thread' : `Message ${roomName}`}</span>{value.codeMode || value.body.startsWith('```') ? <span className="composer-code-preview" aria-label="Code block mode">{value.codeLanguage ?? 'text'} code</span> : null}<InlineComposer ref={composer} ariaLabel={thread ? 'Message thread' : `Message ${roomName}`} placeholder={thread ? 'Message thread' : `Message ${roomName}`} disabled={disabled}
        value={{ text: value.body, tokens: (value.inlineEmojis ?? []).map(({ name, ...token }) => ({ ...token, alt: name, title: name })) }}
        onChange={(next) => { const prior = current.current.value; change({ ...prior, body: next.text === '```' ? '' : next.text, mentions: prior.mentions?.filter((mention) => visibleMention(next.text, mention.label)), inlineEmojis: next.tokens.map(({ alt, title, ...token }) => ({ ...token, name: alt ?? title ?? token.id })), ...(next.text === '```' ? { codeMode: true, codeLanguage: 'text' } : {}) }); }}
        onSelectionChange={(selection) => setCaret(selection?.end ?? current.current.value.body.length)} onKeyDown={onKeyDown} onSubmit={() => form.current?.requestSubmit()}
        onImagePaste={props.stageFiles ? ({ files }) => { if (files.length) stage(files); else { const stageFiles = props.stageFiles; const generation = contextGeneration.current; runTool(async () => { const file = await readNativeClipboardImage(); if (file && mounted.current && contextGeneration.current === generation) await stageFiles?.([file]); }); } } : undefined}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} /></label>
      <button type="button" className="icon-button composer__more" aria-label="More message tools" aria-expanded={more} onClick={() => setMore((open) => !open)}><Plus size={18} /></button>
      <div aria-label="Message tools" className={`composer__actions${more ? ' is-open' : ''}`}>
        {props.stageFiles ? <button type="button" className="icon-button composer__attachment-more" aria-label="Attach a file" onClick={() => fileInput.current?.click()} disabled={disabled}><Paperclip size={18} /></button> : null}
        {gifEndpoint && props.sendGif ? button('Search GIFs', () => setPicker(picker === 'gif' ? undefined : 'gif'), <Film size={18} />) : null}
        {stickerPacks.length && props.sendSticker ? button('Open sticker pack', () => {
          if (picker !== 'sticker') setManifest(stickerPacks.find((pack) => pack.manifestUrl === defaultStickerPack)?.manifestUrl ?? stickerPacks.find((pack) => pack.manifestUrl === manifest)?.manifestUrl ?? stickerPacks[0].manifestUrl);
          setPicker(picker === 'sticker' ? undefined : 'sticker');
        }, <Sticker size={18} />) : null}
        {button('Add emoji', () => setPicker(picker === 'emoji' ? undefined : 'emoji'), <Smile size={19} />)}
        {props.onNudge ? button('Send a nudge', () => runTool(props.onNudge!), <BellRing size={18} />) : null}
        <select className="composer__code-language" aria-label="Code language" value={value.codeLanguage ?? 'text'} disabled={disabled} onChange={(event) => change({ ...value, codeLanguage: event.target.value })}>{Object.entries(LANGUAGES).map(([language, label]) => <option key={language} value={language}>{label}</option>)}</select>
        {button(value.codeMode ? 'Exit code mode' : 'Insert code block', () => { if (value.codeMode) { change({ ...value, codeMode: false }); focus(); return; } const selection = composer.current?.getSelection(); const body = selection && selection.end > selection.start ? value.body.slice(selection.start, selection.end) : value.body; change({ ...value, body, codeMode: true, inlineEmojis: [], mentions: [] }); focus(); }, <span aria-hidden="true">&lt;/&gt;</span>)}
        {(value.codeMode || value.body.startsWith('```')) && props.stageFiles ? button('Send code as file', () => { if (value.body.trim()) stage([new File([value.body], `snippet.${EXTENSIONS[value.codeLanguage ?? 'text'] ?? 'txt'}`, { type: 'text/plain' })], value.codeLanguage ?? 'text'); }, <span aria-hidden="true">▤</span>) : null}
      </div>
      <button className="send-button" type="submit" aria-label={thread ? 'Send thread reply' : 'Send message'} disabled={disabled || !value.body.trim() || sending || busy}><Send size={17} /></button>
    </form>
  </>;
});
