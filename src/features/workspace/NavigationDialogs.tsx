import { X } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Dialog, DialogClose } from '../../components/Dialog';
import { ActionFeedback } from '../../components/ActionFeedback';
import { parseMatrixLink } from '../../matrix/matrixLinks';

export interface NavigationDialogsProps {
  kind: 'link' | 'help';
  onClose: () => void;
  onOpenLink: (value: string) => Promise<void>;
  onStartConversation?: (userId: string) => Promise<void>;
}

export function NavigationDialogs({ kind, onClose, onOpenLink, onStartConversation }: NavigationDialogsProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [startUserId, setStartUserId] = useState<string>();
  const modifier = /mac|iphone|ipad|ipod/iu.test(navigator.platform) ? 'Command' : 'Ctrl';
  const title = kind === 'link' ? 'Open Matrix link' : 'Keyboard shortcuts';

  const open = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    const target = parseMatrixLink(value);
    setStartUserId(undefined);
    if (!target) {
      setError('Enter a complete matrix.to or matrix: link to a room, message, or person.');
      input.current?.focus();
      return;
    }
    pending.current = true;
    input.current?.focus();
    setBusy(true);
    setError(undefined);
    try { await onOpenLink(value.trim()); onClose(); }
    catch {
      setError(target.userId
        ? onStartConversation ? 'That conversation could not be opened. You can retry or explicitly start a conversation.' : 'That conversation could not be opened. Try again.'
        : 'That link could not be opened. Check that you have joined the conversation, then try again.');
      if (target.userId && onStartConversation) setStartUserId(target.userId);
    } finally { pending.current = false; setBusy(false); }
  };

  const start = async () => {
    if (pending.current || !startUserId || !onStartConversation) return;
    pending.current = true;
    input.current?.focus();
    setBusy(true);
    setError(undefined);
    try { await onStartConversation(startUserId); onClose(); }
    catch { setError('The conversation could not be started. Your link has been kept so you can try again.'); }
    finally { pending.current = false; setBusy(false); }
  };

  return <Dialog className="room-dialog" aria-labelledby={`${id}-title`} onClose={onClose} busy={busy}>
    <header style={{ height: 44 }}>
      <h2 id={`${id}-title`} style={{ margin: 0, fontSize: '1rem' }}>{title}</h2>
      <DialogClose aria-label={`Close ${kind === 'link' ? 'Matrix link' : 'keyboard shortcuts'}`} style={{ width: 44, height: 44 }}><X size={18} /></DialogClose>
    </header>
    {kind === 'link' ? <form noValidate onSubmit={(event) => void open(event)} aria-busy={busy} style={{ overflowY: 'auto', maxHeight: 'calc(100dvh - 120px)' }}>
      <fieldset className="interaction-fields">
        <label><span>Matrix link</span><input ref={input} type="url" value={value} readOnly={busy} data-initial-focus
          aria-describedby={`${id}-hint`} aria-invalid={Boolean(error)} autoComplete="off" autoCapitalize="none" spellCheck={false}
          placeholder="https://matrix.to/#/… or matrix:…" maxLength={4096} style={{ height: 44, fontSize: 16 }}
          onChange={(event) => { setValue(event.target.value); setError(undefined); setStartUserId(undefined); }}
          onKeyDown={(event) => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} /></label>
      </fieldset>
      <p className="settings-hint" id={`${id}-hint`} style={{ margin: 0 }}>Open a joined room, a message, or an existing direct chat. Opening a link never joins a room or creates a conversation.</p>
      <ActionFeedback busy={busy ? startUserId ? 'Starting conversation…' : 'Opening conversation…' : undefined} error={error} />
      {startUserId && onStartConversation ? <div>
        <p className="settings-hint" style={{ overflowWrap: 'anywhere' }}>Start a conversation with {startUserId}. This may create a new encrypted direct chat.</p>
        <button className="aqua-button" type="button" disabled={busy} style={{ minHeight: 44 }} onClick={() => void start()}>Start conversation</button>
      </div> : null}
      <button className="aqua-button aqua-button--primary" type="submit" disabled={busy || !value.trim()} style={{ minHeight: 44 }}>Open link</button>
    </form> : <div style={{ padding: 20, overflowY: 'auto', maxHeight: 'calc(100dvh - 120px)' }}>
      <p style={{ marginTop: 0 }}>Move between conversations without losing your place.</p>
      <dl style={{ display: 'grid', gap: 12, margin: '16px 0' }}>
        <div><dt><kbd>{modifier}+K</kbd></dt><dd style={{ margin: '4px 0 0' }}>Open the quick switcher. Use ↑ and ↓ to choose, Enter to open, and Escape to close.</dd></div>
        <div><dt><kbd>Alt+Shift+↑</kbd> / <kbd>Alt+Shift+↓</kbd></dt><dd style={{ margin: '4px 0 0' }}>Open the previous or next unread conversation across all your conversations.</dd></div>
        <div><dt><kbd>{modifier}+/</kbd></dt><dd style={{ margin: '4px 0 0' }}>Show these keyboard shortcuts.</dd></div>
      </dl>
      <p className="settings-hint">On touch screens, open the quick switcher from its search button. Its footer has the same unread navigation, Open Matrix link, and keyboard help actions.</p>
      <DialogClose className="aqua-button" style={{ minHeight: 44 }}>Done</DialogClose>
    </div>}
  </Dialog>;
}
