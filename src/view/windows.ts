// Separate browser windows for parts of the app (e.g. the codebook on a second monitor) and for
// tools like the challenge review.
//
// A part is not copied: its elements are moved into the new window and back when that window
// closes, so the one app in the main window keeps rendering them and all state, undo and saving
// stay in one place. Everything that acts "where the user is" (dialogs, messages, file pickers,
// the clipboard) uses the window used last (`currentDocument()` / `currentWindow()`), and
// document-wide listeners are added to every window through `onEveryDocument()`.

import './windows.css';
import { h } from './dom';
import { popupBlocked } from './feedback';

interface Popout {
  win: Window;
  /** The part's place in the main window, showing a note while the part is elsewhere. */
  container: HTMLElement;
  /** Its moved child elements, in order, and the node they go back before. */
  moved: Node[];
  placeholder: HTMLElement;
  mirror: MutationObserver;
}

const popouts = new Map<string, Popout>();
const toolWindows = new Map<string, Window>();
const docSetups: ((doc: Document) => void)[] = [];
const changeListeners: (() => void)[] = [];
let active: Document = document;

/** The document of the window used last (the main window if that one was closed). */
export function currentDocument(): Document {
  return active.defaultView && !active.defaultView.closed ? active : document;
}

export const currentWindow = (): Window => currentDocument().defaultView ?? window;

/** Runs `setup` for the main document now and for every window opened later (e.g. to add key handlers). */
export function onEveryDocument(setup: (doc: Document) => void) {
  docSetups.push(setup);
  setup(document);
  for (const w of [...popouts.values()].map((p) => p.win).concat([...toolWindows.values()])) if (!w.closed) setup(w.document);
}

/** Called after a part moved to another window or back (e.g. to lay out again). */
export function onWindowsChange(fn: () => void) {
  changeListeners.push(fn);
}

/** An element by id in the main window or any open window. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  for (const d of [document, ...[...popouts.values()].map((p) => p.win.document)]) {
    const el = d.getElementById(id);
    if (el) return el as T;
  }
  return null;
}

export const isPoppedOut = (key: string) => popouts.has(key);

/** Opens a blank window of the app with its styles and theme, and the app's handlers. */
function openWindow(name: string, title: string, size: { width: number; height: number }): Window | null {
  const win = window.open('', `bct-${name}`, `popup,width=${size.width},height=${size.height}`);
  if (!win) return null;
  const d = win.document;
  d.open();
  d.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="popout"></body></html>');
  d.close();
  d.title = `${title} · Better Coding Tool`;
  for (const s of document.querySelectorAll('style, link[rel="stylesheet"]')) d.head.append(s.cloneNode(true));
  syncTheme(d);
  // Dropping a file must not replace the window's page.
  win.addEventListener('dragover', (e) => e.preventDefault());
  win.addEventListener('drop', (e) => e.preventDefault());
  win.addEventListener('focus', () => (active = d));
  d.addEventListener('pointerdown', () => (active = d), true);
  for (const setup of docSetups) setup(d);
  active = d;
  return win;
}

function syncTheme(d: Document) {
  const theme = document.documentElement.dataset.theme;
  if (theme) d.documentElement.dataset.theme = theme;
  else delete d.documentElement.dataset.theme;
}

/** Keeps every window in the main window's theme, and focus tracking for the main window. */
export function initWindows() {
  new MutationObserver(() => {
    for (const p of popouts.values()) syncTheme(p.win.document);
    for (const w of toolWindows.values()) if (!w.closed) syncTheme(w.document);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('focus', () => (active = document));
  document.addEventListener('pointerdown', () => (active = document), true);
  // Closing or reloading the app closes its windows (their parts come back first).
  window.addEventListener('pagehide', () => {
    for (const key of [...popouts.keys()]) bringBack(key);
    for (const w of toolWindows.values()) w.close();
  });
}

/**
 * Moves the content of `container` (except its area grips and resize handles) into a new window.
 * The container stays in the main window with a note and a button to bring the part back.
 */
export function popOut(key: string, container: HTMLElement, title: string, size = { width: 520, height: 760 }): boolean {
  if (popouts.has(key)) {
    popouts.get(key)!.win.focus();
    return true;
  }
  const win = openWindow(key, title, size);
  if (!win) return false;
  const d = win.document;

  // Rebuild the container's ancestors (empty) so the part's styles still apply, all filling the window.
  const chain: HTMLElement[] = [];
  for (let el: HTMLElement | null = container; el && el !== document.body; el = el.parentElement) chain.unshift(el);
  let parent: HTMLElement = d.body;
  let copy: HTMLElement = d.body;
  for (const el of chain) {
    copy = el.cloneNode(false) as HTMLElement;
    copy.removeAttribute('id');
    copy.classList.remove('segments-hidden', 'popped');
    copy.classList.add('popout-fill');
    copy.style.cssText = '';
    parent.append(copy);
    parent = copy;
  }
  copy.style.setProperty('display', 'flex', 'important');
  copy.style.setProperty('flex-direction', 'column', 'important');

  const moved = [...container.childNodes].filter(
    (n) => !(n instanceof HTMLElement && (n.classList.contains('area-grip') || n.classList.contains('area-resizer'))),
  );
  copy.append(...moved);
  // Classes the app sets on the container (e.g. "no document open") are kept in step.
  const mirrorClasses = () => (copy.className = [...container.classList].filter((c) => c !== 'popped').concat('popout-fill').join(' '));
  const mirror = new MutationObserver(mirrorClasses);
  mirror.observe(container, { attributes: true, attributeFilter: ['class'] });
  mirrorClasses();

  const placeholder = h(
    'div',
    { class: 'popout-placeholder' },
    h('span', { class: 'grow' }, `${title} is open in a separate window.`),
    h('button', { class: 'btn small', onClick: () => popouts.get(key)?.win.focus() }, 'Show'),
    h('button', { class: 'btn small', onClick: () => bringBack(key) }, 'Bring back'),
  );
  container.append(placeholder);
  container.classList.add('popped');
  popouts.set(key, { win, container, moved, placeholder, mirror });

  // The part comes back when its window is closed.
  win.addEventListener('pagehide', () => bringBack(key));
  win.addEventListener('resize', () => changeListeners.forEach((fn) => fn()));
  changeListeners.forEach((fn) => fn());
  return true;
}

/** Moves a part back from its window into the main window and closes that window. */
export function bringBack(key: string) {
  const p = popouts.get(key);
  if (!p) return;
  popouts.delete(key);
  p.mirror.disconnect();
  p.placeholder.remove();
  const anchor = [...p.container.childNodes].find((n) => n instanceof HTMLElement && n.classList.contains('area-resizer')) ?? null;
  for (const n of p.moved) p.container.insertBefore(document.adoptNode(n), anchor);
  p.container.classList.remove('popped');
  if (active === p.win.document) active = document;
  if (!p.win.closed) p.win.close();
  window.focus();
  changeListeners.forEach((fn) => fn());
}

/**
 * Opens (or focuses) a tool window, e.g. the challenge review. `render` fills its body and is
 * called again by the caller when the state changes; `onClose` runs when the window closes.
 */
export function openToolWindow(key: string, title: string, onClose: () => void, size = { width: 900, height: 820 }): HTMLElement | null {
  const open = toolWindows.get(key);
  if (open && !open.closed) {
    open.focus();
    return null;
  }
  const win = openWindow(key, title, size);
  if (!win) {
    popupBlocked();
    return null;
  }
  toolWindows.set(key, win);
  win.addEventListener('pagehide', () => {
    toolWindows.delete(key);
    if (active === win.document) active = document;
    onClose();
  });
  const root = h('div', { class: 'tool-window' });
  win.document.body.append(root);
  return root;
}

export const closeToolWindow = (key: string) => toolWindows.get(key)?.close();

/** Brings an open tool window to the front. Returns false if it is not open. */
export function focusToolWindow(key: string): boolean {
  const open = toolWindows.get(key);
  if (!open || open.closed) return false;
  open.focus();
  return true;
}
