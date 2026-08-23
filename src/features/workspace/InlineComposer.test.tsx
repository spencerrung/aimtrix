import { createRef, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  InlineComposer,
  type InlineComposerHandle,
  type InlineComposerToken,
  type InlineComposerValue,
} from './InlineComposer';

const wave: InlineComposerToken = {
  id: 'wave',
  shortcode: ':wave:',
  src: '/wave.png',
  alt: 'wave',
};

function Harness({ initial = { text: '', tokens: [] }, onSubmit, onImagePaste, composerRef }: {
  initial?: InlineComposerValue;
  onSubmit?: (value: InlineComposerValue) => void;
  onImagePaste?: React.ComponentProps<typeof InlineComposer>['onImagePaste'];
  composerRef?: React.RefObject<InlineComposerHandle | null>;
}) {
  const [value, setValue] = useState(initial);
  return <>
    <InlineComposer
      ref={composerRef}
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      onImagePaste={onImagePaste}
      ariaLabel="Message"
      placeholder="Write a message"
    />
    <output data-testid="value">{JSON.stringify(value)}</output>
  </>;
}

function setCaret(element: HTMLElement, offset: number) {
  const node = element.firstChild ?? element;
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe('InlineComposer', () => {
  it('renders explicit duplicate token occurrences atomically and exposes portable value', () => {
    const ref = createRef<InlineComposerHandle>();
    const initial: InlineComposerValue = {
      text: 'a :wave: b :wave:',
      tokens: [
        { ...wave, start: 2, end: 8 },
        { ...wave, start: 11, end: 17 },
      ],
    };
    render(<Harness initial={initial} composerRef={ref} />);

    expect(screen.getByRole('textbox').querySelectorAll('[data-inline-composer-token="true"]')).toHaveLength(2);
    expect(ref.current?.getValue()).toEqual(initial);
  });

  it('inserts and replaces tokens at serialized offsets', () => {
    const ref = createRef<InlineComposerHandle>();
    render(<Harness initial={{ text: 'hello world', tokens: [] }} composerRef={ref} />);

    act(() => ref.current?.replaceRange(6, 11, wave));

    expect(JSON.parse(screen.getByTestId('value').textContent ?? '')).toEqual({
      text: 'hello :wave:',
      tokens: [{ ...wave, start: 6, end: 12 }],
    });
  });

  it('removes an adjacent token in one Backspace action', () => {
    const ref = createRef<InlineComposerHandle>();
    render(<Harness initial={{ text: 'a:wave:b', tokens: [{ ...wave, start: 1, end: 7 }] }} composerRef={ref} />);
    const editor = screen.getByRole('textbox');
    editor.focus();
    ref.current?.setSelection({ start: 7, end: 7 });

    fireEvent.keyDown(editor, { key: 'Backspace' });

    expect(JSON.parse(screen.getByTestId('value').textContent ?? '')).toEqual({ text: 'ab', tokens: [] });
  });

  it('submits on Enter and inserts newline on Shift+Enter', () => {
    const onSubmit = vi.fn();
    const ref = createRef<InlineComposerHandle>();
    render(<Harness initial={{ text: 'hello', tokens: [] }} onSubmit={onSubmit} composerRef={ref} />);
    const editor = screen.getByRole('textbox');
    editor.focus();
    setCaret(editor, 5);

    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith({ text: 'hello', tokens: [] });

    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '').text).toBe('hello\n');
  });

  it('pastes plain text and forwards image files and items', () => {
    const onImagePaste = vi.fn();
    const ref = createRef<InlineComposerHandle>();
    render(<Harness onImagePaste={onImagePaste} composerRef={ref} />);
    const editor = screen.getByRole('textbox');
    editor.focus();
    const textClipboard = { items: [], files: [], getData: () => 'plain\r\ntext', setData: vi.fn() };
    fireEvent.paste(editor, { clipboardData: textClipboard });
    expect(JSON.parse(screen.getByTestId('value').textContent ?? '').text).toBe('plain\ntext');

    const image = new File(['image'], 'paste.png', { type: 'image/png' });
    const item = { kind: 'file', type: 'image/png', getAsFile: () => image } as DataTransferItem;
    fireEvent.paste(editor, { clipboardData: { items: [item], files: [], getData: () => '', setData: vi.fn() } });
    expect(onImagePaste).toHaveBeenCalledWith({ files: [image], items: [item] });
  });

  it('serializes selected tokens as shortcodes when copied', () => {
    const ref = createRef<InlineComposerHandle>();
    render(<Harness initial={{ text: ':wave:', tokens: [{ ...wave, start: 0, end: 6 }] }} composerRef={ref} />);
    const editor = screen.getByRole('textbox');
    editor.focus();
    ref.current?.setSelection({ start: 0, end: 6 });
    const setData = vi.fn();

    fireEvent.copy(editor, { clipboardData: { setData, getData: vi.fn(), items: [], files: [] } });

    expect(setData).toHaveBeenCalledWith('text/plain', ':wave:');
  });

  it('supports external clear and keeps composing Enter safe', () => {
    const onSubmit = vi.fn();
    const ref = createRef<InlineComposerHandle>();
    render(<Harness initial={{ text: 'draft', tokens: [] }} onSubmit={onSubmit} composerRef={ref} />);
    const editor = screen.getByRole('textbox');

    fireEvent.compositionStart(editor);
    fireEvent.keyDown(editor, { key: 'Enter', keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(editor);

    act(() => ref.current?.clear());
    expect(screen.getByTestId('value')).toHaveTextContent('{"text":"","tokens":[]}');
    expect(screen.getByText('Write a message')).toBeInTheDocument();
    expect(editor).toHaveStyle({ maxHeight: '130px', overflowY: 'auto' });
  });
});
