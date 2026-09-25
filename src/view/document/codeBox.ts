// The box that opens below a text selection to type (or choose) a code for it.

import { codePassage, setCodeTarget } from '../../controller/coding';
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
import { project } from '../../model/state';
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
  list: HTMLUListElement;
  applied: HTMLElement;
  target: HTMLElement;
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
    placeholder: 'Type a code…  (Parent > Child for a subcode)',
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
  const list = h('ul', { class: 'popup-list' });
  const applied = h('div', { class: 'popup-applied' });
  const target = h('div', { class: 'popup-target' });
  const el = h(
    'div',
    { class: 'code-popup' },
    h('div', { class: 'popup-meta' }, `${lineLabel(doc, start, end)} · ${end - start} characters`),
    target,
    h('div', { class: 'popup-row' }, color, input),
    list,
    applied,
    h('div', { class: 'popup-hint' }, '↵ apply · ⇧↵ apply & add another · ↑↓ choose · Esc cancel'),
  );
  gridEl.append(el);

  // Place the box just below the end of the selection so the selected text stays visible.
  const width = Math.min(460, grid.width - 16);
  el.style.width = `${width}px`;
  el.style.left = `${Math.max(8, Math.min(last.left - grid.left, grid.width - width - 8))}px`;
  el.style.top = `${last.bottom - grid.top + 8}px`;

  popup = { el, docId: doc.id, start, end, input, color, list, applied, target, items: [], exact: undefined, pathExists: false, active: -1, counts: segmentCounts() };
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
  if (!popup) return;
  // Codes can be found by name ("dist") or by path ("trust > dist"); "trust >" lists Trust's subcodes.
  const typed = popup.input.value;
  const parts = splitCodePath(typed);
  const trailing = /[>›]\s*$/.test(typed);
  const last = trailing ? '' : (parts.at(-1) ?? '').toLowerCase();
  const exactPath = !trailing && parts.length ? findCodeByPath(parts) : undefined;
  const rank = (c: Code) => {
    const n = c.name.toLowerCase();
    return c === exactPath ? 0 : n === last ? 1 : n.startsWith(last) ? 2 : 3;
  };
  popup.items = project.codes
    .filter((c) => matchesCodeQuery(c, typed))
    .sort((a, b) => rank(a) - rank(b) || codePath(a).localeCompare(codePath(b)))
    // All matches are listed; the list scrolls. The cap only keeps huge codebooks responsive.
    .slice(0, 300);
  popup.pathExists = !!exactPath;
  // A single name also picks an existing subcode of that name by default (it stays findable),
  // while "Create" is still offered for a new top-level code.
  popup.exact = exactPath ?? (parts.length === 1 && !trailing ? popup.items.find((c) => c.name.toLowerCase() === last) : undefined);
  popup.active = popup.exact ? popup.items.indexOf(popup.exact) : -1;
  renderList();
}

function renderList() {
  const p = popup;
  if (!p) return;
  const q = p.input.value.trim();
  const pick = (i: number) => (e: MouseEvent) => {
    e.preventDefault();
    p.active = i;
    apply(e.shiftKey);
  };
  p.list.replaceChildren(
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
    p.list.append(h('li', { class: 'empty' }, 'No codes yet — type a name to create one, or “Parent > Child” for a subcode.'));
  }
  p.list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function renderApplied() {
  const p = popup;
  if (!p) return;
  // Codes already covering the whole selected passage (possibly as part of a larger segment).
  const here = layerSegments().filter((s) => s.docId === p.docId && s.start <= p.start && s.end >= p.end);
  p.applied.replaceChildren(
    ...(here.length ? [h('span', { class: 'muted' }, 'Already coded: ')] : []),
    ...here.map((s) => {
      const c = codeById(s.codeId);
      return c ? h('span', { class: 'chip', style: { background: hexToRgba(c.color, 0.25) } }, c.name) : '';
    }),
  );
}

function apply(keepOpen: boolean) {
  const p = popup;
  if (!p) return;
  // A chosen suggestion is applied by its full path, so codes with the same name stay distinct.
  const chosen = p.active >= 0 ? p.items[p.active] : undefined;
  const name = chosen ? codePath(chosen) : p.input.value.trim();
  if (!splitCodePath(name).length) return;
  codePassage(p.docId, p.start, p.end, name, p.color.value);
  if (!keepOpen) return closeCodeBox();
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
    p.input.value = p.items[p.active].name;
    refreshSuggestions();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    apply(e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeCodeBox();
  }
}
