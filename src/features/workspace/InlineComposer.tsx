import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

export type InlineComposerToken = {
  id: string;
  shortcode: string;
  src: string;
  alt?: string;
  title?: string;
};

export type InlineComposerTokenOccurrence = InlineComposerToken & {
  /** Serialized, inclusive offset occupied by this token's shortcode. */
  start: number;
  /** Serialized, exclusive offset occupied by this token's shortcode. */
  end: number;
};

export type InlineComposerSelection = {
  /** Offsets in the portable value, where a token occupies shortcode.length. */
  start: number;
  end: number;
  direction?: 'forward' | 'backward' | 'none';
};

export type InlineComposerValue = {
  /** Portable text: every token is represented by its shortcode. */
  text: string;
  /** Explicit token occurrences. Duplicate shortcodes remain unambiguous. */
  tokens: InlineComposerTokenOccurrence[];
};

export type InlineComposerImagePaste = {
  files: File[];
  items: DataTransferItem[];
};

export type InlineComposerHandle = {
  focus(): void;
  clear(): void;
  getSelection(): InlineComposerSelection | null;
  setSelection(selection: InlineComposerSelection): void;
  insertText(text: string, selection?: InlineComposerSelection): void;
  insertToken(token: InlineComposerToken, selection?: InlineComposerSelection): void;
  replaceRange(start: number, end: number, replacement: string | InlineComposerToken): void;
  getValue(): InlineComposerValue;
};

export type InlineComposerProps = {
  value: InlineComposerValue;
  onChange(value: InlineComposerValue): void;
  onSubmit?(value: InlineComposerValue): void;
  onImagePaste?(payload: InlineComposerImagePaste): void;
  onKeyDown?(event: KeyboardEvent<HTMLDivElement>, selection: InlineComposerSelection | null): boolean;
  onSelectionChange?(selection: InlineComposerSelection | null): void;
  onFocus?(): void;
  onBlur?(): void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
};

type Segment = { kind: 'text'; text: string } | { kind: 'token'; token: InlineComposerToken };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function normalizeValue(value: InlineComposerValue): InlineComposerValue {
  const tokens = [...value.tokens]
    .filter((token) => token.start >= 0 && token.end <= value.text.length && token.start < token.end)
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter((token, index, all) => index === 0 || token.start >= all[index - 1].end)
    .map((token) => ({ ...token, shortcode: value.text.slice(token.start, token.end) || token.shortcode }));
  return { text: value.text, tokens };
}

function valueToSegments(value: InlineComposerValue): Segment[] {
  const normalized = normalizeValue(value);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const occurrence of normalized.tokens) {
    if (occurrence.start > cursor) segments.push({ kind: 'text', text: normalized.text.slice(cursor, occurrence.start) });
    segments.push({ kind: 'token', token: occurrence });
    cursor = occurrence.end;
  }
  if (cursor < normalized.text.length) segments.push({ kind: 'text', text: normalized.text.slice(cursor) });
  if (!segments.length) segments.push({ kind: 'text', text: '' });
  return segments;
}

function tokenFromElement(element: Element): InlineComposerToken | null {
  if (!(element instanceof HTMLElement) || element.dataset.inlineComposerToken !== 'true') return null;
  const { tokenId: id, shortcode, src, alt, title } = element.dataset;
  return id && shortcode && src ? { id, shortcode, src, alt, title } : null;
}

function domToValue(root: HTMLElement): InlineComposerValue {
  let text = '';
  const tokens: InlineComposerTokenOccurrence[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      return;
    }
    if (!(node instanceof Element)) return;
    const token = tokenFromElement(node);
    if (token) {
      const start = text.length;
      text += token.shortcode;
      tokens.push({ ...token, start, end: text.length });
      return;
    }
    if (node.tagName === 'BR') {
      text += '\n';
      return;
    }
    const block = node !== root && /^(DIV|P|LI)$/.test(node.tagName);
    if (block && text && !text.endsWith('\n')) text += '\n';
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return { text, tokens };
}

function equivalent(a: InlineComposerValue, b: InlineComposerValue): boolean {
  return a.text === b.text
    && a.tokens.length === b.tokens.length
    && a.tokens.every((token, index) => {
      const other = b.tokens[index];
      return token.id === other.id
        && token.shortcode === other.shortcode
        && token.src === other.src
        && token.alt === other.alt
        && token.title === other.title
        && token.start === other.start
        && token.end === other.end;
    });
}

function boundaryFromPoint(root: HTMLElement, node: Node, offset: number): number {
  let result = 0;
  let found = false;
  const visit = (current: Node) => {
    if (found) return;
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) result += clamp(offset, 0, current.textContent?.length ?? 0);
      else for (let index = 0; index < Math.min(offset, current.childNodes.length); index += 1) addLength(current.childNodes[index]);
      found = true;
      return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      result += current.textContent?.length ?? 0;
      return;
    }
    if (!(current instanceof Element)) return;
    const token = tokenFromElement(current);
    if (token) {
      result += token.shortcode.length;
      return;
    }
    if (current.tagName === 'BR') {
      result += 1;
      return;
    }
    current.childNodes.forEach(visit);
  };
  const addLength = (current: Node) => {
    if (current.nodeType === Node.TEXT_NODE) result += current.textContent?.length ?? 0;
    else if (current instanceof Element) {
      const token = tokenFromElement(current);
      if (token) result += token.shortcode.length;
      else if (current.tagName === 'BR') result += 1;
      else current.childNodes.forEach(addLength);
    }
  };
  visit(root);
  return result;
}

function pointFromBoundary(root: HTMLElement, requested: number): { node: Node; offset: number } {
  let remaining = Math.max(0, requested);
  let answer: { node: Node; offset: number } | null = null;
  const visit = (node: Node) => {
    if (answer) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) answer = { node, offset: remaining };
      else remaining -= length;
      return;
    }
    if (!(node instanceof Element)) return;
    const token = tokenFromElement(node);
    if (token) {
      const index = Array.prototype.indexOf.call(node.parentNode?.childNodes ?? [], node);
      if (remaining === 0) answer = { node: node.parentNode ?? root, offset: index };
      else if (remaining <= token.shortcode.length) answer = { node: node.parentNode ?? root, offset: index + 1 };
      else remaining -= token.shortcode.length;
      return;
    }
    if (node.tagName === 'BR') {
      if (remaining === 0) answer = { node: node.parentNode ?? root, offset: Array.prototype.indexOf.call(node.parentNode?.childNodes ?? [], node) };
      else remaining -= 1;
      return;
    }
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return answer ?? { node: root, offset: root.childNodes.length };
}

function occurrencesAfterEdit(value: InlineComposerValue, start: number, end: number, inserted: string, token?: InlineComposerToken): InlineComposerValue {
  const from = clamp(Math.min(start, end), 0, value.text.length);
  const to = clamp(Math.max(start, end), from, value.text.length);
  const expandedFrom = value.tokens.reduce((result, item) => item.start < from && item.end > from ? item.start : result, from);
  const expandedTo = value.tokens.reduce((result, item) => item.start < to && item.end > to ? item.end : result, to);
  const delta = inserted.length - (expandedTo - expandedFrom);
  const tokens = value.tokens
    .filter((item) => item.end <= expandedFrom || item.start >= expandedTo)
    .map((item) => item.start >= expandedTo ? { ...item, start: item.start + delta, end: item.end + delta } : item);
  if (token) tokens.push({ ...token, start: expandedFrom, end: expandedFrom + inserted.length });
  tokens.sort((a, b) => a.start - b.start);
  return {
    text: value.text.slice(0, expandedFrom) + inserted + value.text.slice(expandedTo),
    tokens,
  };
}

export const InlineComposer = forwardRef<InlineComposerHandle, InlineComposerProps>(function InlineComposer({
  value,
  onChange,
  onSubmit,
  onImagePaste,
  onKeyDown,
  onSelectionChange,
  onFocus,
  onBlur,
  ariaLabel,
  placeholder,
  disabled = false,
  className,
  style,
  autoFocus,
}, forwardedRef) {
  const rootRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef(normalizeValue(value));
  const composingRef = useRef(false);
  const pendingSelectionRef = useRef<InlineComposerSelection | null>(null);
  valueRef.current = normalizeValue(value);

  const getSelection = (): InlineComposerSelection | null => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection || !selection.rangeCount || !selection.anchorNode || !selection.focusNode || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
    const anchor = boundaryFromPoint(root, selection.anchorNode, selection.anchorOffset);
    const focus = boundaryFromPoint(root, selection.focusNode, selection.focusOffset);
    return { start: Math.min(anchor, focus), end: Math.max(anchor, focus), direction: anchor <= focus ? 'forward' : 'backward' };
  };

  const setSelection = (selectionValue: InlineComposerSelection) => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection) return;
    const start = pointFromBoundary(root, selectionValue.start);
    const end = pointFromBoundary(root, selectionValue.end);
    selection.removeAllRanges();
    if (selectionValue.direction === 'backward' && selection.setBaseAndExtent) {
      selection.setBaseAndExtent(end.node, end.offset, start.node, start.offset);
    } else {
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      selection.addRange(range);
    }
  };

  const commitEdit = (start: number, end: number, replacement: string | InlineComposerToken) => {
    const token = typeof replacement === 'string' ? undefined : replacement;
    const inserted = typeof replacement === 'string' ? replacement : replacement.shortcode;
    const next = occurrencesAfterEdit(valueRef.current, start, end, inserted, token);
    valueRef.current = next;
    pendingSelectionRef.current = { start: Math.min(start, end) + inserted.length, end: Math.min(start, end) + inserted.length };
    onChange(next);
  };

  useImperativeHandle(forwardedRef, () => ({
    focus: () => rootRef.current?.focus(),
    clear: () => {
      const next = { text: '', tokens: [] };
      valueRef.current = next;
      pendingSelectionRef.current = { start: 0, end: 0 };
      onChange(next);
    },
    getSelection,
    setSelection,
    insertText: (text, selection) => {
      const target = selection ?? getSelection() ?? { start: valueRef.current.text.length, end: valueRef.current.text.length };
      commitEdit(target.start, target.end, text);
    },
    insertToken: (token, selection) => {
      const target = selection ?? getSelection() ?? { start: valueRef.current.text.length, end: valueRef.current.text.length };
      commitEdit(target.start, target.end, token);
    },
    replaceRange: commitEdit,
    getValue: () => valueRef.current,
  }));

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const domValue = domToValue(root);
    if (!equivalent(domValue, valueRef.current)) {
      root.replaceChildren();
      for (const segment of valueToSegments(valueRef.current)) {
        if (segment.kind === 'text') {
          const lines = segment.text.split('\n');
          lines.forEach((line, index) => {
            if (index) root.append(document.createElement('br'));
            if (line) root.append(document.createTextNode(line));
          });
        } else {
          const wrapper = document.createElement('span');
          wrapper.contentEditable = 'false';
          wrapper.dataset.inlineComposerToken = 'true';
          wrapper.dataset.tokenId = segment.token.id;
          wrapper.dataset.shortcode = segment.token.shortcode;
          wrapper.dataset.src = segment.token.src;
          if (segment.token.alt) wrapper.dataset.alt = segment.token.alt;
          if (segment.token.title) wrapper.dataset.title = segment.token.title;
          wrapper.setAttribute('aria-label', segment.token.alt ?? segment.token.shortcode);
          wrapper.style.cssText = 'display:inline-block;vertical-align:text-bottom;line-height:1';
          const image = document.createElement('img');
          image.src = segment.token.src;
          image.alt = segment.token.alt ?? segment.token.shortcode;
          image.title = segment.token.title ?? segment.token.shortcode;
          image.draggable = false;
          image.style.cssText = 'display:block;width:1.25em;height:1.25em;object-fit:contain;pointer-events:none';
          wrapper.append(image);
          root.append(wrapper);
        }
      }
    }
    if (pendingSelectionRef.current) {
      setSelection(pendingSelectionRef.current);
      pendingSelectionRef.current = null;
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus) rootRef.current?.focus();
  }, [autoFocus]);

  const handleInput = (event: FormEvent<HTMLDivElement>) => {
    if (composingRef.current) return;
    const next = domToValue(event.currentTarget);
    valueRef.current = next;
    onChange(next);
    onSelectionChange?.(getSelection());
  };

  const serializeSelection = (event: ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    const selected = getSelection();
    if (!selected || selected.start === selected.end) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', valueRef.current.text.slice(selected.start, selected.end));
    if (cut && !disabled) commitEdit(selected.start, selected.end, '');
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const items = Array.from(event.clipboardData.items ?? []);
    const files = Array.from(event.clipboardData.files ?? []);
    const itemFiles = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((file): file is File => Boolean(file));
    const imageFiles = [...files.filter((file) => file.type.startsWith('image/')), ...itemFiles].filter((file, index, all) => all.indexOf(file) === index);
    const text = event.clipboardData.getData('text/plain');
    if (onImagePaste && (imageFiles.length || !text)) {
      event.preventDefault();
      onImagePaste({ files: imageFiles, items });
      return;
    }
    event.preventDefault();
    const target = getSelection() ?? { start: valueRef.current.text.length, end: valueRef.current.text.length };
    commitEdit(target.start, target.end, text.replace(/\r\n?/g, '\n'));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return;
    const selection = getSelection();
    if (onKeyDown?.(event, selection)) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onSubmit?.(valueRef.current);
      return;
    }
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      const target = selection ?? { start: valueRef.current.text.length, end: valueRef.current.text.length };
      commitEdit(target.start, target.end, '\n');
      return;
    }
    if (!selection || selection.start !== selection.end || (event.key !== 'Backspace' && event.key !== 'Delete')) return;
    const token = event.key === 'Backspace'
      ? valueRef.current.tokens.find((item) => item.end === selection.start)
      : valueRef.current.tokens.find((item) => item.start === selection.start);
    if (token) {
      event.preventDefault();
      commitEdit(token.start, token.end, '');
    }
  };

  return <div style={{ position: 'relative', minWidth: 0 }} className={className}>
    <div
      ref={rootRef}
      role="textbox"
      aria-label={ariaLabel}
      aria-multiline="true"
      aria-disabled={disabled || undefined}
      contentEditable={!disabled}
      suppressContentEditableWarning
      spellCheck
      data-inline-composer="true"
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onKeyUp={() => onSelectionChange?.(getSelection())}
      onMouseUp={() => onSelectionChange?.(getSelection())}
      onFocus={() => {
        onFocus?.();
        onSelectionChange?.(getSelection());
      }}
      onBlur={onBlur}
      onCopy={(event) => serializeSelection(event, false)}
      onCut={(event) => serializeSelection(event, true)}
      onPaste={handlePaste}
      onCompositionStart={() => { composingRef.current = true; }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        handleInput(event);
      }}
      style={{
        maxHeight: 130,
        overflowY: 'auto',
        overflowX: 'hidden',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        cursor: disabled ? 'not-allowed' : 'text',
        opacity: disabled ? 0.6 : undefined,
        ...style,
      }}
    />
  </div>;
});
