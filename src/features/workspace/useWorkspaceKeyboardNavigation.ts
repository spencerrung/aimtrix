import { useEffect, type RefObject } from 'react';

const MESSAGE = '[data-keyboard-message]';
const LIST = '.timeline, .thread-panel__timeline';
const CONTROL = 'button, a[href], input, select, textarea, audio[controls], video[controls], [contenteditable="true"], [tabindex]';
const EDITOR = 'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]';
const SECTION = '.space-rail, .buddy-panel, .timeline, .thread-panel__timeline, .composer, .context-panel';
const visible = (node: HTMLElement) => !node.closest('[hidden], [inert]') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';

/** One timeline entry in the page Tab sequence; arrows select messages, Enter enters their controls. */
export function useWorkspaceKeyboardNavigation(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const original = new Map<HTMLElement, string | null>();
    const selection = new WeakMap<HTMLElement, HTMLElement>();
    const remember = (node: HTMLElement) => { if (!original.has(node)) original.set(node, node.getAttribute('tabindex')); };
    const restore = (node: HTMLElement) => {
      const value = original.get(node);
      if (value == null) { if (node.hasAttribute('tabindex')) node.removeAttribute('tabindex'); } else if (node.getAttribute('tabindex') !== value) node.setAttribute('tabindex', value);
    };
    const rows = (list: HTMLElement) => [...list.querySelectorAll<HTMLElement>(MESSAGE)].filter(visible);
    const update = (lists: Iterable<HTMLElement>) => {
      for (const list of lists) {
        if (!host.contains(list)) continue;
        const messages = rows(list);
        const focused = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>(MESSAGE) : null;
        const selected = focused && messages.includes(focused) ? focused : messages.includes(selection.get(list)!) ? selection.get(list)! : messages[0];
        if (selected) selection.set(list, selected);
        for (const message of messages) {
          remember(message);
          const tabIndex = message === selected ? 0 : -1;
          if (message.tabIndex !== tabIndex) message.tabIndex = tabIndex;
          // Only the message currently being interacted with contributes its inner controls.
          const entering = message.contains(document.activeElement) && document.activeElement !== message;
          for (const control of message.querySelectorAll<HTMLElement>(CONTROL)) {
            remember(control);
            if (entering) restore(control); else if (control.getAttribute('tabindex') !== '-1') control.tabIndex = -1;
          }
        }
      }
    };
    let focusedMessage: HTMLElement | null = null;
    let enteringControls = false;
    const syncFocus = (target: EventTarget | null) => {
      const element = target instanceof HTMLElement && host.contains(target) ? target : null;
      const message = element?.closest<HTMLElement>(MESSAGE) ?? null;
      const list = message?.closest<HTMLElement>(LIST);
      const next = list ? message : null;
      const entering = Boolean(next && element !== next);
      if (next === focusedMessage && entering === enteringControls) return;
      for (const row of new Set([focusedMessage, next])) {
        if (!row || !host.contains(row)) continue;
        for (const control of row.querySelectorAll<HTMLElement>(CONTROL)) {
          remember(control);
          if (row === next && entering) restore(control);
          else if (control.getAttribute('tabindex') !== '-1') control.tabIndex = -1;
        }
      }
      if (next && list) {
        const previous = selection.get(list);
        if (previous && previous !== next && host.contains(previous)) previous.tabIndex = -1;
        remember(next);
        next.tabIndex = 0;
        selection.set(list, next);
      }
      focusedMessage = next;
      enteringControls = entering;
    };
    const onFocusIn = (event: FocusEvent) => syncFocus(event.target);
    const onFocusOut = (event: FocusEvent) => syncFocus(event.relatedTarget);
    const focusRow = (node: HTMLElement) => { node.focus({ preventScroll: true }); node.scrollIntoView?.({ block: 'nearest' }); };
    const usableControls = (node: HTMLElement) => [...node.querySelectorAll<HTMLElement>(CONTROL)].filter((control) => visible(control) && !control.matches(':disabled') && original.get(control) !== '-1');
    const focusSection = (section: HTMLElement) => {
      if (section.matches(LIST)) {
        const selected = selection.get(section) ?? rows(section)[0];
        if (selected) { focusRow(selected); return; }
      }
      const target = section.matches('.composer') ? section.querySelector<HTMLElement>('[contenteditable="true"],textarea')
        : [...section.querySelectorAll<HTMLElement>('[data-panel-heading]')].find(visible) ?? usableControls(section)[0];
      if (target) target.focus();
      else { remember(section); section.tabIndex = -1; section.focus(); }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target || !host.contains(target) || target.closest('dialog,[role="dialog"],[role="menu"],[role="listbox"]') || document.querySelector('dialog[open],[role="menu"],[role="dialog"]')) return;
      if (event.key === 'F6') {
        const sections = [...host.querySelectorAll<HTMLElement>(SECTION)].filter((section) => visible(section) && !(section.matches('.context-panel') && [...section.querySelectorAll<HTMLElement>(LIST)].some(visible)));
        if (!sections.length) return;
        const index = sections.findIndex((section) => section.contains(target));
        event.preventDefault();
        const next = index < 0 ? (event.shiftKey ? sections.length - 1 : 0)
          : (index + (event.shiftKey ? sections.length - 1 : 1)) % sections.length;
        focusSection(sections[next]);
        return;
      }
      if (target.closest(EDITOR)) return;
      const textSelection = window.getSelection();
      if (textSelection && !textSelection.isCollapsed) return;
      const message = target.closest<HTMLElement>(MESSAGE);
      const list = message?.closest<HTMLElement>(LIST);
      if (!message || !list) return;
      if (event.key === 'Escape') {
        const surface = list.closest('.thread-panel') ?? list.closest('.conversation');
        const composer = surface?.querySelector<HTMLElement>('.composer [contenteditable="true"],.composer textarea');
        if (composer && visible(composer)) { event.preventDefault(); composer.focus(); }
      } else if (target === message && !event.shiftKey) {
        const messages = rows(list), index = messages.indexOf(message);
        const next = event.key === 'ArrowDown' ? Math.min(index + 1, messages.length - 1) : event.key === 'ArrowUp' ? Math.max(0, index - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? messages.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); focusRow(messages[next]); }
        else if (event.key === 'Enter') {
          const control = usableControls(message)[0];
          if (control) { event.preventDefault(); control.focus(); }
        }
      }
    };
    const includes = (node: HTMLElement, selector: string) => node.matches(selector) || Boolean(node.querySelector(selector));
    const observer = new MutationObserver((records) => {
      const dirty = new Set<HTMLElement>();
      let removed = false;
      for (const record of records) {
        if (!(record.target instanceof HTMLElement)) continue;
        const target = record.target;
        const list = target.closest<HTMLElement>(LIST);
        if (record.type === 'attributes') {
          // A hidden/inert ancestor can change every row's eligibility.
          if (list) dirty.add(list);
          for (const child of target.querySelectorAll<HTMLElement>(LIST)) dirty.add(child);
          continue;
        }
        // Detached tracked controls/section fallbacks also need their original attributes restored.
        removed ||= [...record.removedNodes].some((node) => node instanceof HTMLElement && includes(node, CONTROL));
        const changed = [...record.addedNodes, ...record.removedNodes].filter((node): node is HTMLElement => node instanceof HTMLElement);
        // Text edits, typing notices and unrelated panels cannot alter the roving controls.
        if (list && changed.some((node) => includes(node, MESSAGE)
          || (target.closest(MESSAGE) && includes(node, CONTROL)))) {
          dirty.add(list);
          removed ||= record.removedNodes.length > 0;
        }
        for (const node of changed) {
          if (!includes(node, LIST)) continue;
          if (node.matches(LIST)) dirty.add(node);
          for (const child of node.querySelectorAll<HTMLElement>(LIST)) dirty.add(child);
          removed ||= record.removedNodes.length > 0;
        }
      }
      if (removed) for (const node of original.keys()) {
        if (!host.contains(node)) { restore(node); original.delete(node); }
      }
      update(dirty);
      if (removed) syncFocus(document.activeElement);
    });
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert'] });
    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);
    window.addEventListener('keydown', onKey, true);
    update(host.querySelectorAll<HTMLElement>(LIST));
    syncFocus(document.activeElement);
    return () => { observer.disconnect(); host.removeEventListener('focusin', onFocusIn); host.removeEventListener('focusout', onFocusOut); window.removeEventListener('keydown', onKey, true); for (const node of original.keys()) restore(node); };
  }, [root]);
}
