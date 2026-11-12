// The box that opens below a text selection. Typing a name applies a code (existing codes are
// suggested); "memo: …" adds a memo instead, and "code: …" forces a code. Everything works from
// the keyboard, so coding a passage takes no clicks beyond the selection.

import './codeBox.css';
import { codePassage, inVivoName, parseEntry, setCodeBoxHelp, setCodeBoxSubcodes, setCodeTarget, type Entry } from '../../controller/coding';
import { addMemoToPassage } from '../../controller/memos';
import {
  codeChain,
  codePath,
  findChildCode,
  findCodeByPath,
  missingInPath,
  nextColor,
  segmentCounts,
  splitCodePath,
} from '../../model/codes';
import { currentDoc } from '../../model/documents';
import { activeLayer, consolidationOf } from '../../model/layers';
import { lineLabel } from '../../model/lines';
import { project, ui } from '../../model/state';
import type { Code, Doc } from '../../model/types';
import { h } from '../dom';
import { onEveryDocument } from '../windows';
import { codeTreeRows, treeRowClass, treeRowContent, type TreeRow } from '../codeTree';
import { hidePins, showPins } from './pins';
import { toast } from '../feedback';
import { copyText } from '../files';
import { gridEl, pointToOffset, rangeFor, renderedDocId, setNamedHighlight, textBody } from './textView';

interface Popup {
  el: HTMLElement;
  docId: string;
  start: number;
  end: number;
  input: HTMLInputElement;
  color: HTMLInputElement;
  kind: HTMLElement;
  list: HTMLUListElement;
  target: HTMLElement;
  help: HTMLElement;
  hint: HTMLElement;
  entry: Entry;
  /** The name an in-vivo code would get (the passage's own words), used when nothing is typed. */
  inVivo: string;
  /** The suggestions as a tree (codeTree.ts), and their codes (items[i] is rows[i]'s code). */
  rows: TreeRow[];
  items: Code[];
  exact: Code | undefined;
  /** Whether a code exists at exactly the typed path (then no "Create" option is shown). */
  pathExists: boolean;
  /** Index into items, or -1 for "use the typed text". */
  active: number;
  /**
   * Tab going through the codes listed: the box's text the last Tab put there (typing ends it),
   * and what was typed before (the last stop, with "Create …" or the in-vivo code).
   */
  tabbing?: { value: string; typed: string };
  counts: Map<string, number>;
}

let popup: Popup | null = null;
/** While the box's width is measured: all codes are listed, also when subcodes are hidden. */
let measuringAll = false;

/** Opens the code box whenever text in the document is selected. */
export function initCodeBox() {
  // In every window, since the text can be moved to a separate one.
  onEveryDocument((doc) => {
    doc.addEventListener('mouseup', () => setTimeout(onSelectionDone, 0));
    doc.addEventListener('mousedown', (e) => {
      // The pins belong to the box's passage, so dragging them keeps the box open.
      if (popup && !popup.el.contains(e.target as Node) && !(e.target as Element).closest?.('.text-pin')) closeCodeBox();
    });
  });
}

function onSelectionDone() {
  const doc = currentDoc();
  const sel = textBody.ownerDocument.getSelection();
  if (!doc || !renderedDocId || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const r = sel.getRangeAt(0);
  // Selections that run past the text (e.g. into a coder column) are clamped to the text.
  if (!r.intersectsNode(textBody) || (popup && popup.el.contains(r.commonAncestorContainer))) return;
  let start = pointToOffset(r.startContainer, r.startOffset, 'start');
  let end = pointToOffset(r.endContainer, r.endOffset, 'end');
  while (start < end && /\s/.test(doc.content[start])) start++;
  while (end > start && /\s/.test(doc.content[end - 1])) end--;
  if (end > start) openCodeBox(doc, start, end);
}

function openCodeBox(doc: Doc, start: number, end: number) {
  closeCodeBox();
  const range = rangeFor(start, end);
  const grid = gridEl.getBoundingClientRect();

  const input = h('input', {
    type: 'text',
    class: 'popup-input',
    placeholder: 'Type a code, or memo: …   (? for help)',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const color = h('input', {
    type: 'color',
    class: 'popup-color',
    value: nextColor(),
    title: 'Color for a new code (subcodes use their level 1 code’s color)',
  });
  color.addEventListener('input', renderList);
  const kind = h('span', { class: 'entry-kind' });
  const list = h('ul', { class: 'popup-list' });
  const target = h('div', { class: 'popup-target' });
  const help = helpSection(() => {
    // Typing "?" also opens the help; closing it clears that.
    if (popup?.entry.help) input.value = '';
    setCodeBoxHelp(false);
    refreshSuggestions();
    input.focus({ preventScroll: true });
  });
  const hint = h('div', { class: 'popup-hint' });
  // Highlighted while the help is shown (see renderHelp).
  const helpToggle = h(
    'button',
    {
      class: 'btn small help-toggle',
      title: 'Show or hide the help (or type ?)',
      onMousedown: (e: MouseEvent) => {
        e.preventDefault();
        setCodeBoxHelp(!ui.codeBoxHelp);
        renderHelp();
        input.focus({ preventScroll: true });
      },
    },
    icon('fa-regular fa-circle-question'),
    'Help',
  );
  // Says what clicking it does: show all subcodes in the list (while searching, all subcodes of
  // the codes that match), or hide them (only top-level codes; while searching, the matches).
  const subcodesBtn = h('button', {
    class: 'btn small subcodes-toggle',
    title: 'Show or hide the subcodes in the list (while searching: all subcodes of the codes that match)',
    onMousedown: (e: MouseEvent) => {
      e.preventDefault();
      setCodeBoxSubcodes(!ui.codeBoxSubcodes);
      updateSubcodesBtn();
      refreshSuggestions();
      input.focus({ preventScroll: true });
    },
  });
  const updateSubcodesBtn = () => {
    subcodesBtn.classList.toggle('on', ui.codeBoxSubcodes);
    subcodesBtn.setAttribute('aria-pressed', String(ui.codeBoxSubcodes));
    // The eye shows whether they are shown (open) or not (crossed out); the label what clicking does.
    subcodesBtn.replaceChildren(
      icon(ui.codeBoxSubcodes ? 'fa-regular fa-eye' : 'fa-regular fa-eye-slash'),
      'Subcodes',
    );
  };
  updateSubcodesBtn();
  const copyBtn = h(
    'button',
    {
      class: 'btn small copy-btn',
      title: 'Copy the selected text (⌘C / Ctrl+C)',
      onMousedown: (e: MouseEvent) => {
        e.preventDefault();
        copyPassage();
        input.focus({ preventScroll: true });
      },
    },
    ...copyLabel(),
  );
  const meta = h('span', { class: 'grow' }, `${lineLabel(doc, start, end)} · ${end - start} characters`);
  const el = h(
    'div',
    { class: 'code-popup' },
    h(
      'div',
      { class: 'popup-meta' },
      kind,
      meta,
      subcodesBtn,
      copyBtn,
      helpToggle,
    ),
    target,
    h('div', { class: 'popup-row' }, color, input),
    // What the keys do now, right under the field (renderHint).
    hint,
    list,
    help,
  );
  gridEl.append(el);

  popup = {
    el, docId: doc.id, start, end, input, color, kind, list, target, help, hint,
    entry: parseEntry(''), inVivo: inVivoName(doc.content.slice(start, end)),
    rows: [], items: [], exact: undefined, pathExists: false, active: -1, counts: segmentCounts(),
  };
  // As wide as all codes need (listed as a tree, subcodes too), within the text area; it then
  // stays that wide while typing.
  measuringAll = true;
  refreshSuggestions();
  const width = fittedWidth(el, grid.width - 16);
  measuringAll = false;
  refreshSuggestions();
  el.style.setProperty('--box-width', `${width}px`);
  placeBox(el, start, end, width);
  setNamedHighlight('qc-pending', range, 10);
  // Pins at both ends adjust the passage before it is coded.
  const adjust = (a: number, b: number) => {
    if (!popup) return;
    popup.start = a;
    popup.end = b;
    popup.inVivo = inVivoName(doc.content.slice(a, b));
    meta.textContent = `${lineLabel(doc, a, b)} · ${b - a} characters`;
    setNamedHighlight('qc-pending', rangeFor(a, b), 10);
    // The box follows the end of the passage (e.g. down when the selection grows downwards).
    placeBox(el, a, b, width);
    refreshSuggestions();
  };
  showPins(start, end, { onChange: adjust, onCommit: (a, b) => {
    adjust(a, b);
    input.focus({ preventScroll: true });
  } });
  input.addEventListener('input', refreshSuggestions);
  input.addEventListener('keydown', onKey);
  refreshSuggestions();
  renderTarget();
  input.focus({ preventScroll: true });
}

/** Narrowest the box gets (room for the field and its hints). */
const MIN_WIDTH = 420;
/** Room for the list's scrollbar. */
const SCROLLBAR = 16;

/**
 * The width the box needs for its list of codes, each on one line (measured with the codes
 * shown at their natural width, see .measuring in codeBox.css), between MIN_WIDTH and `max`.
 */
function fittedWidth(el: HTMLElement, max: number): number {
  el.classList.add('measuring');
  const natural = Math.ceil(el.getBoundingClientRect().width) + SCROLLBAR;
  el.classList.remove('measuring');
  return Math.max(Math.min(MIN_WIDTH, max), Math.min(natural, max));
}

/**
 * Places the box one text line below the end of the passage [start, end), so the passage stays
 * visible; horizontally where the passage ends, within the text area. When the box does not fit
 * below the passage in the visible part of the text (e.g. at the end of a document) but fits better
 * above it, it opens above the start of the passage instead, so opening it never scrolls the view.
 */
function placeBox(el: HTMLElement, start: number, end: number, width: number) {
  const range = rangeFor(start, end);
  const rects = range.getClientRects();
  const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
  const first = rects[0] ?? range.getBoundingClientRect();
  const grid = gridEl.getBoundingClientRect();
  const lineHeight = parseFloat(getComputedStyle(textBody).lineHeight) || 24;
  const view = (gridEl.parentElement ?? gridEl).getBoundingClientRect();
  const height = el.getBoundingClientRect().height;
  const roomBelow = view.bottom - (last.bottom + lineHeight);
  const roomAbove = first.top - lineHeight / 2 - view.top;
  const above = roomBelow < height && roomAbove > roomBelow;
  // Only the computed place is set here; the box's styles are in codeBox.css.
  el.style.setProperty('--box-left', `${Math.max(8, Math.min(last.left - grid.left, grid.width - width - 8))}px`);
  el.classList.toggle('above', above);
  if (above) {
    // Anchored at its bottom, so it stays next to the passage while the list changes height.
    el.style.setProperty('--box-bottom', `${grid.bottom - first.top + lineHeight / 2}px`);
  } else {
    el.style.setProperty('--box-top', `${last.bottom - grid.top + lineHeight}px`);
  }
}

/** A Font Awesome icon. */
const icon = (cls: string) => h('i', { class: cls, 'aria-hidden': 'true' });
const copyLabel = () => [icon('fa-regular fa-copy'), 'Copy selected'];

/** Copies the passage the box was opened for (the text selection itself is gone once the box has focus). */
async function copyPassage() {
  const p = popup;
  const doc = currentDoc();
  if (!p || !doc || doc.id !== p.docId) return;
  const btn = p.el.querySelector('.copy-btn');
  if (await copyText(doc.content.slice(p.start, p.end))) {
    btn?.classList.add('done');
    btn?.replaceChildren(icon('fa-solid fa-check'), 'Copied');
    setTimeout(() => {
      btn?.classList.remove('done');
      btn?.replaceChildren(...copyLabel());
    }, 1200);
  } else toast('Could not copy to the clipboard.');
}

export function closeCodeBox() {
  if (!popup) return;
  hidePins();
  popup.el.remove();
  popup = null;
  setNamedHighlight('qc-pending', null, 0);
}

/** Explains what can be typed in the box. */
function helpSection(onClose: () => void): HTMLElement {
  const row = (syntax: string, meaning: string) => h('div', { class: 'help-row' }, h('code', {}, syntax), h('span', {}, meaning));
  return h(
    'div',
    { class: 'popup-help' },
    h(
      'button',
      {
        class: 'icon-btn help-close',
        title: 'Close help',
        onMousedown: (e: MouseEvent) => {
          e.preventDefault();
          onClose();
        },
      },
      '✕',
    ),
    h('div', { class: 'help-title' }, 'What you can type'),
    row('(nothing)', 'an in-vivo code: the highlighted words become the code'),
    row('code', 'apply a code (existing codes are suggested as you type)'),
    row('parent code > subcode', 'a subcode; missing parent codes are created, and it takes the parent code’s color'),
    row('parent code >', 'list the subcodes of a code'),
    row('memo: note', 'add a memo (a sticky note) instead of a code'),
    row('code: memo…', 'force a code, e.g. one whose name starts with “memo”'),
    h('div', { class: 'help-title' }, 'Keys'),
    row('↵', 'apply the code or save the memo, and close'),
    row('⇧↵', 'apply and keep the box open to add another code or memo'),
    row('↑ ↓', 'choose a suggestion'),
    row('Tab', 'go through the codes listed, one by one, each put into the box, then back to what you typed (⇧Tab the other way); typing searches again. “>” after a code lists its subcodes'),
    row('⌘C / Ctrl+C', 'copy the selected text (or click the copy icon)'),
    row('Esc', 'close without changes'),
  );
}

function renderHelp() {
  const p = popup;
  if (!p) return;
  const shown = ui.codeBoxHelp || p.entry.help;
  p.help.hidden = !shown;
  const toggle = p.el.querySelector('.help-toggle');
  toggle?.classList.toggle('on', shown);
  toggle?.setAttribute('aria-pressed', String(shown));
}

/** Shows whether the box currently creates a code or a memo. */
function renderKind() {
  const p = popup;
  if (!p) return;
  const memo = p.entry.kind === 'memo';
  p.kind.textContent = memo ? 'Memo' : 'Code';
  p.kind.className = 'entry-kind ' + (memo ? 'memo' : 'code');
  p.kind.title = memo ? 'Saves a memo (sticky note). Remove “memo:” to apply a code.' : 'Applies a code. Start with “memo:” to add a memo instead.';
  p.el.classList.toggle('memo-mode', memo);
}

/**
 * The keys that do something right now, right under the field: Enter (when something is
 * highlighted), Tab (when codes are listed), ">" (after a name), ? (while the field is empty), Esc.
 */
function renderHint() {
  const p = popup;
  if (!p) return;
  const q = p.entry.text.trim();
  const memo = p.entry.kind === 'memo';
  const typingSubcode = /[>›]\s*$/.test(q);
  const listed = !memo && p.rows.some((r) => r.match || !q);
  const hints: [string, string][] = [];
  if (memo ? q : p.active >= 0 || (q ? !typingSubcode : !!p.inVivo)) hints.push(['↵', 'apply highlighted']);
  if (listed) hints.push(['Tab', 'go through list']);
  if (!memo && q && !typingSubcode) hints.push(['>', 'add subcode']);
  if (!p.input.value.trim()) hints.push(['?', 'help']);
  hints.push(['Esc', 'close']);
  p.hint.replaceChildren(...hints.flatMap(([key, text], i) => [i ? ' · ' : '', h('kbd', {}, key), ` ${text}`]));
}

/** While consolidating, lets the user choose whether the code goes into their coding or the consolidated one. */
function renderTarget() {
  const p = popup;
  if (!p) return;
  if (!consolidationOf(p.docId)) return p.target.replaceChildren();
  const option = (value: 'mine' | 'consolidated', label: string) =>
    h(
      'button',
      {
        class: 'seg-toggle' + (activeLayer() === value ? ' on' : ''),
        onMousedown: (e: MouseEvent) => {
          e.preventDefault();
          setCodeTarget(value);
          renderTarget();
                },
      },
      label,
    );
  p.target.replaceChildren(
    h('span', { class: 'muted' }, 'Code into'),
    option('consolidated', 'Consolidated'),
    option('mine', project.coderName || 'Your coding'),
  );
}

function refreshSuggestions() {
  const p = popup;
  if (!p) return;
  p.entry = parseEntry(p.input.value);
  renderKind();
  renderHelp();
  if (p.entry.kind === 'memo' || p.entry.help) {
    p.rows = [];
    p.items = [];
    p.exact = undefined;
    p.pathExists = false;
    p.active = -1;
    return renderList();
  }
  // Codes can be found by name ("dist") or by path ("trust > dist"); "trust >" lists Trust's subcodes.
  const typed = p.entry.text;
  const parts = splitCodePath(typed);
  const trailing = /[>›]\s*$/.test(typed);
  const last = trailing ? '' : (parts.at(-1) ?? '').toLowerCase();
  const exactPath = !trailing && parts.length ? findCodeByPath(parts) : undefined;
  // The matches as a tree, with their parents for context (and optionally all their subcodes).
  // All are listed; the list scrolls. The cap only keeps huge codebooks responsive.
  p.rows = codeTreeRows(typed, { withSubcodes: ui.codeBoxSubcodes, collapsed: !ui.codeBoxSubcodes && !measuringAll }).slice(0, 500);
  p.items = p.rows.map((r) => r.code);
  p.pathExists = !!exactPath;
  // A single name also picks an existing subcode of that name by default (it stays findable),
  // while "Create" is still offered for a new top-level code.
  p.exact = exactPath ?? (parts.length === 1 && !trailing ? p.rows.find((r) => r.match && r.code.name.toLowerCase() === last)?.code : undefined);
  p.active = p.exact ? p.items.indexOf(p.exact) : -1;
  renderList();
}

function renderList() {
  const p = popup;
  if (!p) return;
  const q = p.entry.text.trim();
  const pick = (i: number) => (e: MouseEvent) => {
    e.preventDefault();
    p.active = i;
    apply(e.shiftKey);
  };
  renderHint();
  if (p.entry.help) return p.list.replaceChildren();
  if (p.entry.kind === 'memo') {
    p.list.replaceChildren(
      q
        ? h('li', { class: 'create memo active', onMousedown: pick(-1) }, h('span', { class: 'swatch memo-swatch' }), h('span', { class: 'grow' }, `Add memo “${q}”`))
        : h('li', { class: 'empty' }, 'Type your memo after “memo:”.'),
    );
    return;
  }
  // Nothing typed: Enter uses the highlighted words as an in-vivo code.
  const inVivo = !q && p.inVivo ? inVivoRow(p, pick(-1)) : null;
  const parts = splitCodePath(q);
  const typingSubcode = /[>›]\s*$/.test(q);
  // A new subcode of an existing code goes in the tree under it, first among its other subcodes:
  // highlighted with its name ("Parent > New"), or as its place while it has none ("Parent >").
  const parentCode = typingSubcode && parts.length ? findCodeByPath(parts) : undefined;
  const placeholder: Code | undefined = parentCode && { id: '', name: 'type its name…', color: codeChain(parentCode)[0].color, parentId: parentCode.id };
  const newParent = !typingSubcode && parts.length > 1 && !p.pathExists ? findCodeByPath(parts.slice(0, -1)) : undefined;
  const newSubcode: Code | undefined = newParent && { id: '', name: parts.at(-1)!, color: codeChain(newParent)[0].color, parentId: newParent.id };
  const extra = placeholder ?? newSubcode;
  const shown = extra ? codeTreeRows(q, { withSubcodes: ui.codeBoxSubcodes, collapsed: !ui.codeBoxSubcodes, extra }) : p.rows;
  const indexOf = new Map(p.rows.map((r, i) => [r.code.id, i]));
  // Creating a code comes first: "Create new code …", or the new subcode under its parents.
  const create: HTMLElement[] = [];
  if (parts.length && !typingSubcode && p.pathExists) {
    // The name is an existing code's (highlighted; Enter applies it): another code of that name.
    const name = parts.at(-1)!;
    const where = parts.length > 1 ? ` under “${parts.at(-2)}”` : '';
    create.push(
      h(
        'li',
        { class: 'create' + (p.active === -1 ? ' active' : ''), title: `A new code “${name}”${where}, besides the existing one`, onMousedown: pick(-1) },
        colorSwatch(parts.length > 1 ? (findChildCode(null, parts[0])?.color ?? p.color.value) : p.color.value),
        h('span', { class: 'sugg-text' }, h('span', { class: 'sugg-name' }, `Create another code “${name}”${where}`)),
      ),
    );
  }
  if (parts.length && !typingSubcode && !p.pathExists && !newSubcode) {
    const name = parts.at(-1)!;
    const parents = parts.slice(0, -1);
    // Subcodes take the color of the level 1 code.
    const color = parents.length ? (findChildCode(null, parents[0])?.color ?? p.color.value) : p.color.value;
    if (parents.length) create.push(...createTree(parts, color, p.active === -1, pick(-1)));
    else
      create.push(
        h(
          'li',
          { class: 'create' + (p.active === -1 ? ' active' : ''), title: parts.join(' > '), onMousedown: pick(-1) },
          colorSwatch(color),
          h('span', { class: 'sugg-text' }, h('span', { class: 'sugg-name' }, `Create new code “${name}”`)),
        ),
      );
  }
  // Just typed ">" after a code that does not exist yet: it and its new subcode's place.
  if (parts.length && typingSubcode && !parentCode) {
    const color = findChildCode(null, parts[0])?.color ?? p.color.value;
    create.push(...createTree([...parts, ''], color, false));
  }
  p.list.replaceChildren(
    ...(inVivo ? [inVivo] : []),
    ...create,
    ...shown.map((r) => {
      if (r.code === placeholder)
        return h(
          'li',
          { class: 'code-tree-row create create-context create-unnamed' + (p.active === -1 ? ' active' : '') },
          ...withBadge(treeRowContent(r), 'new subcode'),
        );
      if (r.code === newSubcode)
        return h(
          'li',
          { class: 'code-tree-row create new-subcode' + (p.active === -1 ? ' active' : ''), title: `Create ${parts.join(' > ')}`, onMousedown: pick(-1) },
          ...withBadge(treeRowContent(r), 'new subcode'),
        );
      const i = indexOf.get(r.code.id);
      // Shown only for context (e.g. the siblings of a new subcode): clicking puts it in the box.
      if (i === undefined)
        return h(
          'li',
          {
            class: 'code-tree-row tree-context',
            title: codePath(r.code),
            onMousedown: (e: MouseEvent) => {
              e.preventDefault();
              p.input.value = p.entry.prefix + codePath(r.code);
              refreshSuggestions();
            },
          },
          ...treeRowContent(r, p.counts.get(r.code.id) ?? 0, q),
        );
      return h(
        'li',
        { class: ['code-tree-row', i === p.active ? 'active' : '', treeRowClass(r, q)].filter(Boolean).join(' '), title: codePath(r.code), onMousedown: pick(i) },
        ...treeRowContent(r, p.counts.get(r.code.id) ?? 0, q),
      );
    }),
  );
  if (!p.items.length && !q) {
    p.list.append(h('li', { class: 'empty' }, 'Or type a code name, “parent code > subcode”, or “memo: …”. Type ? for help.'));
  }
  const active = p.list.querySelector<HTMLElement>('.active');
  if (active) scrollListTo(p.list, active);
}

/**
 * Scrolls the list just enough to show `item`. Not scrollIntoView, which would also scroll the
 * text (e.g. down to the box when it opens at the end of a document).
 */
function scrollListTo(list: HTMLElement, item: HTMLElement) {
  const l = list.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  if (r.top < l.top) list.scrollTop -= l.top - r.top;
  else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
}

/**
 * Gives an element its code's color as the CSS variable --code-color; how it is used (a swatch's
 * background, a chip's tint) is up to codeBox.css.
 */
function withCodeColor<T extends HTMLElement>(el: T, color: string): T {
  el.style.setProperty('--code-color', color);
  return el;
}

/** A code's color as a swatch. */
const colorSwatch = (color: string) => withCodeColor(h('span', { class: 'swatch code-swatch' }), color);

/** The badge of a code about to be created ("new", "new subcode"), in front of its name. */
const newBadge = (label: string) => h('span', { class: 'code-tree-new' }, label);

/** A tree row's content (codeTree.ts) with the "new" badge in front of the name. */
function withBadge(content: (HTMLElement | null)[], label: string): (HTMLElement | null)[] {
  const name = content.findIndex((el) => el?.classList.contains('code-tree-name'));
  return [...content.slice(0, name), newBadge(label), ...content.slice(name)];
}

/**
 * Creating a subcode ("Parent > New"), shown as a tree: its existing parent codes, then the new
 * codes (missing parents too), each marked as new; clicking (or Enter) creates them. A new
 * subcode without a name yet ("Parent >") is shown as a place for it only.
 */
function createTree(parts: string[], color: string, active: boolean, onPick?: (e: MouseEvent) => void): HTMLElement[] {
  const unnamed = !parts.at(-1);
  const missing = missingInPath(parts.slice(0, -1)).length + 1;
  let parent: Code | undefined;
  return parts.map((name, d) => {
    const lines = h('span', { class: 'code-tree-lines', 'aria-hidden': 'true' }, d ? '   '.repeat(d - 1) + '└─ ' : '');
    const isNew = d >= parts.length - missing;
    if (!isNew) {
      parent = findChildCode(parent?.id ?? null, name);
      return h('li', { class: 'code-tree-row create-context' }, lines, colorSwatch(parent?.color ?? color), h('span', { class: 'code-tree-name' }, name));
    }
    const isLeaf = d === parts.length - 1;
    if (unnamed)
      return h(
        'li',
        { class: 'code-tree-row create create-context' + (isLeaf ? ' create-unnamed' : '') },
        lines,
        colorSwatch(color),
        newBadge(isLeaf ? 'new subcode' : 'new'),
        h('span', { class: 'code-tree-name' }, isLeaf ? 'type its name…' : name),
      );
    return h(
      'li',
      { class: 'code-tree-row create' + (isLeaf && active ? ' active' : ''), title: `Create ${parts.join(' > ')}`, onMousedown: onPick },
      lines,
      colorSwatch(color),
      newBadge(isLeaf ? (d ? 'new subcode' : 'new code') : 'new'),
      h('span', { class: 'code-tree-name' }, name),
    );
  });
}

/** The "in-vivo code" option: the highlighted words as the code name (reusing such a code if it exists). */
function inVivoRow(p: Popup, onPick: (e: MouseEvent) => void): HTMLElement {
  const existing = findChildCode(null, p.inVivo);
  return h(
    'li',
    { class: 'create invivo' + (p.active === -1 ? ' active' : ''), onMousedown: onPick, title: 'Press Enter to use the highlighted words as the code' },
    colorSwatch(existing?.color ?? p.color.value),
    h('span', { class: 'grow' }, `${existing ? 'Apply' : 'Create'} in-vivo code “${p.inVivo}”`),
    h('kbd', {}, '↵'),
  );
}

function apply(keepOpen: boolean) {
  const p = popup;
  if (!p) return;
  if (p.entry.kind === 'memo') {
    if (!addMemoToPassage(p.docId, p.start, p.end, p.entry.text)) return;
  } else {
    // A chosen suggestion is applied by its full path, so codes with the same name stay distinct.
    const chosen = p.active >= 0 ? p.items[p.active] : undefined;
    // "Parent >" with nothing chosen: the new subcode has no name yet.
    if (!chosen && /[>›]\s*$/.test(p.entry.text)) return;
    // Nothing typed and no suggestion chosen: an in-vivo code from the highlighted words.
    const name = chosen ? codePath(chosen) : p.entry.text.trim() || p.inVivo;
    if (!splitCodePath(name).length) return;
    // "Create another code" highlighted: a new code even though one has the typed path.
    const another = !chosen && p.pathExists && !!p.entry.text.trim();
    codePassage(p.docId, p.start, p.end, name, p.color.value, { another });
  }
  if (!keepOpen) return closeCodeBox();
  // Ready for the next code (a memo prefix is not kept: codes are the default).
  p.input.value = '';
  p.color.value = nextColor();
  p.counts = segmentCounts();
  refreshSuggestions();
  p.input.focus({ preventScroll: true });
}

/**
 * Tab in the box: goes through the codes listed (the matches, or all codes while nothing is
 * typed), one by one, putting each one's path into the box, and after the last one back to what
 * was typed (with "Create …" highlighted); ⇧Tab goes the other way. The list stays as it is
 * meanwhile (what was typed stays highlighted); typing searches again. Returns false if no code
 * is listed.
 */
function tabThrough(back: boolean): boolean {
  const p = popup;
  if (!p) return false;
  const typed = !!p.entry.text.trim();
  // The codes listed, then what was typed (-1).
  const stops = [...p.rows.flatMap((r, i) => (r.match || !typed ? [i] : [])), -1];
  if (stops.length === 1) return false;
  const going = p.tabbing?.value === p.input.value;
  const typedText = going ? p.tabbing!.typed : p.input.value;
  const at = stops.indexOf(p.active);
  // The first Tab takes the highlighted code (or the first or last one listed); the next ones go on.
  const index = !going ? (p.active >= 0 && at >= 0 ? at : back ? stops.length - 2 : 0) : (at + (back ? -1 : 1) + stops.length) % stops.length;
  p.active = stops[index];
  p.input.value = p.active >= 0 ? p.entry.prefix + codePath(p.items[p.active]) : typedText;
  p.tabbing = { value: p.input.value, typed: typedText };
  const end = p.input.value.length;
  p.input.setSelectionRange(end, end);
  renderList();
  return true;
}

function onKey(e: KeyboardEvent) {
  const p = popup;
  if (!p) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    p.active = Math.min(p.active + 1, p.items.length - 1);
    renderList();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    p.active = Math.max(p.active - 1, -1);
    renderList();
  } else if (e.key === 'Tab' && p.entry.kind === 'code') {
    e.preventDefault();
    // Through the codes listed; with no codes at all, the in-vivo name goes into the box to edit.
    if (!tabThrough(e.shiftKey) && !p.entry.text.trim() && p.inVivo) {
      p.input.value = p.entry.prefix + p.inVivo;
      refreshSuggestions();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    apply(e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCodeBox();
  } else if (e.key.toLowerCase() === 'c' && (e.metaKey || e.ctrlKey) && p.input.selectionStart === p.input.selectionEnd) {
    // Nothing selected in the box: copy the highlighted passage instead.
    e.preventDefault();
    copyPassage();
  }
}
