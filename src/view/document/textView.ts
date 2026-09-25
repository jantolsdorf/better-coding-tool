// The text of the open document: rendering it line by line, converting between text offsets
// and DOM positions, and colored highlights.

import { codeById } from '../../model/codes';
import { layerSegments } from '../../model/layers';
import { lineOf, lineStartsOf } from '../../model/lines';
import { ui } from '../../model/state';
import { memoColumns, TEXT_KEY } from '../../model/table';
import type { Doc } from '../../model/types';
import { h, hexToRgba } from '../dom';

// CSS Custom Highlight API: colors text ranges without touching the DOM.
type HighlightLike = { priority: number };
const registry: { set(name: string, hl: HighlightLike): void; delete(name: string): void } | undefined = (
  globalThis.CSS as unknown as { highlights?: never }
)?.highlights;
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => HighlightLike }).Highlight;
export const hlSupported = !!registry && !!HighlightCtor;

// Elements shared with the coder columns and the code box (read-only outside this module).
export let scrollEl: HTMLElement;
export let gridEl: HTMLElement;
export let textCol: HTMLElement;
export let textBody: HTMLElement;
let dynStyle: HTMLStyleElement;

export let renderedDocId: string | null = null;
export let renderedContent = '';
let lineStarts: number[] = [];
let lineEls: HTMLElement[] = [];
let hlNames: string[] = [];
let flashTimer = 0;

/** Creates the scrolling area with the text column; coder columns are added next to it. */
export function createTextArea(): HTMLElement {
  dynStyle = h('style');
  document.head.append(dynStyle);
  textBody = h('div', { class: 'text-body' });
  textCol = h(
    'div',
    { class: 'text-col', 'data-key': TEXT_KEY },
    h(
      'div',
      { class: 'col-head', title: 'Text — drag to move among the coder columns', draggable: true },
      h('span', { class: 'grip' }, '⋮⋮'),
      'Text',
    ),
    textBody,
    h('div', { class: 'col-resizer', title: 'Drag to resize · double-click for automatic width' }),
  );
  gridEl = h('div', { class: 'viewer-grid' }, textCol);
  scrollEl = h('div', { class: 'viewer-scroll' }, gridEl);
  return scrollEl;
}

export const lineCount = () => lineStarts.length;

export function renderText(doc: Doc) {
  renderedDocId = doc.id;
  renderedContent = doc.content;
  lineStarts = lineStartsOf(doc);
  const frag = document.createDocumentFragment();
  lineEls = doc.content.split('\n').map((line, i) => {
    // Every .lt holds exactly one text node (possibly empty), which keeps offset mapping simple.
    const lt = h('span', { class: 'lt', 'data-start': String(lineStarts[i]) }, line);
    // Line numbers are drawn by CSS so they are neither selectable nor part of highlighted ranges.
    frag.append(h('div', { class: 'line' }, h('span', { class: 'ln', 'data-n': String(i + 1) }), lt));
    return lt;
  });
  textBody.replaceChildren(frag);
  scrollEl.scrollTop = 0;
}

export function clearText() {
  renderedDocId = null;
  textBody.replaceChildren();
  applyHighlights(null);
}

// ---------- offset <-> DOM mapping ----------

function offsetToPoint(offset: number): [Node, number] {
  const i = lineOf(lineStarts, offset);
  const node = lineEls[i].firstChild as Text;
  return [node, Math.min(offset - lineStarts[i], node.length)];
}

export function rangeFor(start: number, end: number): Range {
  const r = document.createRange();
  r.setStart(...offsetToPoint(start));
  r.setEnd(...offsetToPoint(end));
  return r;
}

/** Converts a DOM boundary point inside the text to a character offset. */
export function pointToOffset(node: Node, offset: number, kind: 'start' | 'end'): number {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const lt = el?.closest<HTMLElement>('.lt');
  if (lt) {
    const base = Number(lt.dataset.start);
    if (node.nodeType === Node.TEXT_NODE) return base + offset;
    return base + (offset > 0 ? (lt.textContent ?? '').length : 0);
  }
  // Boundary is on a line number, a line wrapper, or the container: snap to the nearest text.
  const probe = document.createRange();
  probe.setStart(node, offset);
  if (kind === 'start') {
    const i = lineEls.findIndex((l) => probe.comparePoint(l, 0) >= 0);
    return i === -1 ? renderedContent.length : lineStarts[i];
  }
  for (let i = lineEls.length - 1; i >= 0; i--) {
    if (probe.comparePoint(lineEls[i], lineEls[i].childNodes.length) <= 0) {
      return lineStarts[i] + (lineEls[i].textContent ?? '').length;
    }
  }
  return 0;
}

// ---------- highlights ----------

export function setNamedHighlight(name: string, range: Range | null, priority: number) {
  if (!hlSupported) return;
  if (!range) return registry!.delete(name);
  const hl = new HighlightCtor!(range);
  hl.priority = priority;
  registry!.set(name, hl);
}

/** Colors the coded passages of the active coding in their code's color. */
export function applyHighlights(doc: Doc | null) {
  if (!hlSupported) return;
  hlNames.forEach((n) => registry!.delete(n));
  hlNames = [];
  if (!doc) {
    dynStyle.textContent = '';
    return;
  }
  const byCode = new Map<string, Range[]>();
  // The Codes switch turns off the code colors (the text is then plain to read).
  for (const s of ui.showCodes ? layerSegments() : []) {
    if (s.docId !== doc.id) continue;
    if (!byCode.has(s.codeId)) byCode.set(s.codeId, []);
    byCode.get(s.codeId)!.push(rangeFor(s.start, s.end));
  }
  let css = '';
  [...byCode].forEach(([codeId, ranges], i) => {
    const code = codeById(codeId);
    if (!code) return;
    const name = `qc-code-${i}`;
    registry!.set(name, new HighlightCtor!(...ranges));
    hlNames.push(name);
    css += `::highlight(${name}){background-color:${hexToRgba(code.color, 0.3)};}\n`;
  });
  dynStyle.textContent = css;
  // Passages with a memo in a visible memo column are underlined (styled in style.css), so they
  // don't clash with code colors.
  const memoRanges = (ui.showMemos ? memoColumns([doc.id]) : [])
    .flatMap((c) => c.memos)
    .filter((m) => m.docId === doc.id && m.end <= doc.content.length)
    .map((m) => rangeFor(m.start, m.end));
  if (memoRanges.length) {
    registry!.set('qc-memo', new HighlightCtor!(...memoRanges));
    hlNames.push('qc-memo');
  }
}

export function setHoverRange(start: number | null, end = 0) {
  setNamedHighlight('qc-hover', start == null || !renderedDocId ? null : rangeFor(start, end), 20);
}

/** Scrolls a passage of the open document into view and flashes it. */
export function focusSegment(start: number, end: number) {
  if (!renderedDocId) return;
  const range = rangeFor(start, end);
  const r = range.getBoundingClientRect();
  const sr = scrollEl.getBoundingClientRect();
  if (r.top < sr.top + 40 || r.bottom > sr.bottom - 20) {
    scrollEl.scrollBy({ top: r.top - sr.top - 90, behavior: 'smooth' });
  }
  setNamedHighlight('qc-flash', range, 30);
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => setNamedHighlight('qc-flash', null, 0), 1400);
}
