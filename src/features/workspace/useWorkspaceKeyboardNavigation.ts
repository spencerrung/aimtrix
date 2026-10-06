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
    const update = () => {
      for (const node of original.keys()) if (!host.contains(node)) { restore(node); original.delete(node); }
      for (const list of host.querySelectorAll<HTMLElement>(LIST)) {
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
    const focusRow = (node: HTMLElement) => { node.focus({ preventScroll: true }); node.scrollIntoView?.({ block: 'nearest' }); update(); };
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
          if (control) { event.preventDefault(); control.focus(); update(); }
        }
      }
    };
    const observer = new MutationObserver(update);
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'inert'] });
    host.addEventListener('focusin', update);
    host.addEventListener('focusout', update);
    window.addEventListener('keydown', onKey, true);
    update();
    return () => { observer.disconnect(); host.removeEventListener('focusin', update); host.removeEventListener('focusout', update); window.removeEventListener('keydown', onKey, true); for (const node of original.keys()) restore(node); };
  }, [root]);
}
