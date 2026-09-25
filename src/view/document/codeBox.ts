// The box that opens below a text selection. Typing a name applies a code (existing codes are
// suggested); "memo: …" adds a memo instead, and "code: …" forces a code. Everything works from
// the keyboard, so coding a passage takes no clicks beyond the selection.

import { codePassage, inVivoName, parseEntry, setCodeBoxHelp, setCodeTarget, type Entry } from '../../controller/coding';
import { addMemoToPassage } from '../../controller/memos';
import {
  codeById,
  codePath,
  codePathParts,
  findChildCode,
  findCodeByPath,
  matchesCodeQuery,
  missingInPath,
  nextColor,
  segmentCounts,
  splitCodePath,
} from '../../model/codes';
import { currentDoc } from '../../model/documents';
import { activeLayer, consolidationOf, layerSegments } from '../../model/layers';
import { lineLabel } from '../../model/lines';
import { memosOf } from '../../model/memos';
import { project, ui } from '../../model/state';
import type { Code, Doc } from '../../model/types';
import { h, hexToRgba } from '../dom';
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
  applied: HTMLElement;
  target: HTMLElement;
  help: HTMLElement;
  hint: HTMLElement;
  entry: Entry;
  /** The name an in-vivo code would get (the passage's own words), used when nothing is typed. */
  inVivo: string;
  items: Code[];
  exact: Code | undefined;
  /** Whether a code exists at exactly the typed path (then no "Create" option is shown). */
  pathExists: boolean;
  /** Index into items, or -1 for "use the typed text". */
  active: number;
  counts: Map<string, number>;
}

let popup: Popup | null = null;

/** Opens the code box whenever text in the document is selected. */
export function initCodeBox() {
  document.addEventListener('mouseup', () => setTimeout(onSelectionDone, 0));
  document.addEventListener('mousedown', (e) => {
    if (popup && !popup.el.contains(e.target as Node)) closeCodeBox();
  });
}

function onSelectionDone() {
  const doc = currentDoc();
  const sel = window.getSelection();
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
  const rects = range.getClientRects();
  const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
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
  const applied = h('div', { class: 'popup-applied' });
  const target = h('div', { class: 'popup-target' });
  const help = helpSection(() => {
    // Typing "?" also opens the help; closing it clears that.
    if (popup?.entry.help) input.value = '';
    setCodeBoxHelp(false);
    refreshSuggestions();
    input.focus({ preventScroll: true });
  });
  const hint = h('div', { class: 'popup-hint' });
  const helpToggle = h(
    'button',
    {
      class: 'icon-btn help-toggle',
      title: 'Show or hide help (or type ?)',
      onMousedown: (e: MouseEvent) => {
        e.preventDefault();
        setCodeBoxHelp(!ui.codeBoxHelp);
        renderHelp();
        input.focus({ preventScroll: true });
      },
    },
    '?',
  );
  const el = h(
    'div',
    { class: 'code-popup' },
    h('div', { class: 'popup-meta' }, kind, h('span', { class: 'grow' }, `${lineLabel(doc, start, end)} · ${end - start} characters`), helpToggle),
    target,
    h('div', { class: 'popup-row' }, color, input),
    list,
    applied,
    help,
    hint,
  );
  gridEl.append(el);

  // Place the box just below the end of the selection so the selected text stays visible.
  const width = Math.min(460, grid.width - 16);
  el.style.width = `${width}px`;
  el.style.left = `${Math.max(8, Math.min(last.left - grid.left, grid.width - width - 8))}px`;
  el.style.top = `${last.bottom - grid.top + 8}px`;

  popup = {
    el, docId: doc.id, start, end, input, color, kind, list, applied, target, help, hint,
    entry: parseEntry(''), inVivo: inVivoName(doc.content.slice(start, end)),
    items: [], exact: undefined, pathExists: false, active: -1, counts: segmentCounts(),
  };
  setNamedHighlight('qc-pending', range, 10);
  input.addEventListener('input', refreshSuggestions);
  input.addEventListener('keydown', onKey);
  refreshSuggestions();
  renderTarget();
  renderApplied();
  input.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
}

export function closeCodeBox() {
  if (!popup) return;
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
    row('Tab', 'complete the suggestion, or (with nothing typed) put the highlighted words in the box to edit them'),
    row('Esc', 'close without changes'),
  );
}

function renderHelp() {
  const p = popup;
  if (!p) return;
  p.help.hidden = !(ui.codeBoxHelp || p.entry.help);
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
  p.hint.textContent = memo
    ? '↵ save memo · ⇧↵ save & add another · Esc cancel'
    : p.entry.text.trim()
      ? '↵ apply · ⇧↵ apply & add another · ↑↓ choose · Esc cancel'
      : '↵ in-vivo code · type to find or create a code · ? help · Esc cancel';
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
          renderApplied();
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
  const rank = (c: Code) => {
    const n = c.name.toLowerCase();
    return c === exactPath ? 0 : n === last ? 1 : n.startsWith(last) ? 2 : 3;
  };
  p.items = project.codes
    .filter((c) => matchesCodeQuery(c, typed))
    .sort((a, b) => rank(a) - rank(b) || codePath(a).localeCompare(codePath(b)))
    // All matches are listed; the list scrolls. The cap only keeps huge codebooks responsive.
    .slice(0, 300);
  p.pathExists = !!exactPath;
  // A single name also picks an existing subcode of that name by default (it stays findable),
  // while "Create" is still offered for a new top-level code.
  p.exact = exactPath ?? (parts.length === 1 && !trailing ? p.items.find((c) => c.name.toLowerCase() === last) : undefined);
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
  p.list.replaceChildren(
    ...(inVivo ? [inVivo] : []),
    ...p.items.map((c, i) =>
      h(
        'li',
        { class: i === p.active ? 'active' : '', onMousedown: pick(i) },
        h('span', { class: 'swatch', style: { background: c.color } }),
        h(
          'span',
          { class: 'grow' },
          c.name,
          c.parentId ? h('span', { class: 'code-parent' }, ` in ${codePathParts(c).slice(0, -1).join(' > ')}`) : null,
        ),
        h('span', { class: 'muted' }, String(p.counts.get(c.id) ?? 0)),
      ),
    ),
  );
  const parts = splitCodePath(q);
  const typingSubcode = /[>›]\s*$/.test(q);
  if (parts.length && !typingSubcode && !p.pathExists) {
    const name = parts.at(-1)!;
    const parents = parts.slice(0, -1);
    const newParents = missingInPath(parts).slice(0, -1);
    // Subcodes take the color of the level 1 code.
    const color = parents.length ? (findChildCode(null, parents[0])?.color ?? p.color.value) : p.color.value;
    const label = parents.length
      ? `Create subcode “${name}” in ${parents.join(' > ')}` +
        (newParents.length ? ` (also creates ${newParents.map((n) => `“${n}”`).join(', ')})` : '')
      : `Create new code “${name}”`;
    p.list.append(
      h(
        'li',
        { class: 'create' + (p.active === -1 ? ' active' : ''), onMousedown: pick(-1) },
        h('span', { class: 'swatch', style: { background: color } }),
        h('span', { class: 'grow' }, label),
      ),
    );
  }
  if (!p.items.length && !q) {
    p.list.append(h('li', { class: 'empty' }, 'Or type a code name, “parent code > subcode”, or “memo: …”. Type ? for help.'));
  }
  p.list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

/** The "in-vivo code" option: the highlighted words as the code name (reusing such a code if it exists). */
function inVivoRow(p: Popup, onPick: (e: MouseEvent) => void): HTMLElement {
  const existing = findChildCode(null, p.inVivo);
  return h(
    'li',
    { class: 'create invivo' + (p.active === -1 ? ' active' : ''), onMousedown: onPick, title: 'Press Enter to use the highlighted words as the code' },
    h('span', { class: 'swatch', style: { background: existing?.color ?? p.color.value } }),
    h('span', { class: 'grow' }, `${existing ? 'Apply' : 'Create'} in-vivo code “${p.inVivo}”`),
    h('kbd', {}, '↵'),
  );
}

/** Codes and memos already on the whole selected passage (possibly as part of a larger one). */
function renderApplied() {
  const p = popup;
  if (!p) return;
  const covers = (x: { start: number; end: number }) => x.start <= p.start && x.end >= p.end;
  const here = layerSegments().filter((s) => s.docId === p.docId && covers(s));
  const memos = memosOf(p.docId).filter(covers);
  p.applied.replaceChildren(
    ...(here.length || memos.length ? [h('span', { class: 'muted' }, 'Already here: ')] : []),
    ...here.map((s) => {
      const c = codeById(s.codeId);
      return c ? h('span', { class: 'chip', style: { background: hexToRgba(c.color, 0.25) } }, c.name) : '';
    }),
    ...memos.map((m) => h('span', { class: 'chip memo-chip', title: m.note }, m.note.length > 40 ? m.note.slice(0, 40) + '…' : m.note)),
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
    // Nothing typed and no suggestion chosen: an in-vivo code from the highlighted words.
    const name = chosen ? codePath(chosen) : p.entry.text.trim() || p.inVivo;
    if (!splitCodePath(name).length) return;
    codePassage(p.docId, p.start, p.end, name, p.color.value);
  }
  if (!keepOpen) return closeCodeBox();
  // Ready for the next code (a memo prefix is not kept: codes are the default).
  p.input.value = '';
  p.color.value = nextColor();
  p.counts = segmentCounts();
  refreshSuggestions();
  renderApplied();
  p.input.focus({ preventScroll: true });
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
  } else if (e.key === 'Tab' && p.active >= 0) {
    e.preventDefault();
    p.input.value = p.entry.prefix + p.items[p.active].name;
    refreshSuggestions();
  } else if (e.key === 'Tab' && p.entry.kind === 'code' && !p.entry.text.trim() && p.inVivo) {
    // Put the in-vivo name into the box to edit it before applying.
    e.preventDefault();
    p.input.value = p.entry.prefix + p.inVivo;
    refreshSuggestions();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    apply(e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCodeBox();
  }
}
