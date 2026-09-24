import { applyCode, codeById, commitUI, currentDoc, folderPath, nextColor, project, segmentCounts, ui } from './store';
import type { Code, Doc, Segment } from './types';
import { h, hexToRgba, lineLabel, lineOf, lineStartsOf } from './util';

// CSS Custom Highlight API: colors text ranges without touching the DOM.
type HighlightLike = { priority: number };
const registry: { set(name: string, hl: HighlightLike): void; delete(name: string): void } | undefined = (
  globalThis.CSS as unknown as { highlights?: never }
)?.highlights;
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => HighlightLike }).Highlight;
const hlSupported = !!registry && !!HighlightCtor;

interface Column {
  name: string;
  mine: boolean;
  segs: Segment[];
  codes: Map<string, Code>;
  body: HTMLElement;
}

interface Popup {
  el: HTMLElement;
  docId: string;
  start: number;
  end: number;
  input: HTMLInputElement;
  color: HTMLInputElement;
  list: HTMLUListElement;
  applied: HTMLElement;
  items: Code[];
  exact: Code | undefined;
  /** Index into items, or -1 for "use the typed text". */
  active: number;
  counts: Map<string, number>;
}

let root: HTMLElement;
let headerEl: HTMLElement;
let emptyEl: HTMLElement;
let scrollEl: HTMLElement;
let gridEl: HTMLElement;
let textBody: HTMLElement;
let dynStyle: HTMLStyleElement;

let renderedDocId: string | null = null;
let renderedContent = '';
let lineStarts: number[] = [];
let lineEls: HTMLElement[] = [];
let columns: Column[] = [];
let hlNames: string[] = [];
let popup: Popup | null = null;
let layoutQueued = false;
let flashTimer = 0;

export function initViewer(el: HTMLElement, empty: HTMLElement) {
  root = el;
  emptyEl = empty;
  dynStyle = h('style');
  document.head.append(dynStyle);

  headerEl = h('div', { class: 'viewer-header' });
  textBody = h('div', { class: 'text-body' });
  gridEl = h(
    'div',
    { class: 'viewer-grid' },
    h('div', { class: 'text-col' }, h('div', { class: 'col-head' }, 'Text'), textBody),
  );
  scrollEl = h('div', { class: 'viewer-scroll' }, gridEl);
  root.append(headerEl, scrollEl, emptyEl);

  document.addEventListener('mouseup', () => setTimeout(onSelectionDone, 0));
  document.addEventListener('mousedown', (e) => {
    if (popup && !popup.el.contains(e.target as Node)) closePopup();
  });
  new ResizeObserver(scheduleLayout).observe(textBody);
}

export function renderViewer() {
  const doc = currentDoc();
  root.classList.toggle('is-empty', !doc);
  if (!doc) {
    closePopup();
    renderedDocId = null;
    textBody.replaceChildren();
    applyHighlights(null);
    return;
  }
  if (doc.id !== renderedDocId || doc.content !== renderedContent) {
    closePopup();
    buildText(doc);
    scrollEl.scrollTop = 0;
  }
  renderHeader(doc);
  buildColumns(doc);
  applyHighlights(doc);
  layoutColumns();
}

function renderHeader(doc: Doc) {
  const path = folderPath(doc.folderId);
  const mine = project.segments.filter((s) => s.docId === doc.id).length;
  headerEl.replaceChildren(
    h('div', { class: 'vh-title' }, path ? h('span', { class: 'vh-path' }, `${path} / `) : null, doc.name),
    h(
      'div',
      { class: 'vh-meta' },
      `${lineStarts.length} lines · ${mine} coded segment${mine === 1 ? '' : 's'} · Select text to code it`,
    ),
    h(
      'button',
      {
        class: 'btn small',
        title: 'Show or hide the list of coded segments',
        onClick: () => {
          ui.segmentsHidden = !ui.segmentsHidden;
          commitUI();
        },
      },
      ui.segmentsHidden ? 'Show segment list' : 'Hide segment list',
    ),
  );
  if (!hlSupported) {
    headerEl.append(
      h('div', { class: 'vh-warn' }, 'This browser does not support colored text highlights; codes are still shown in the columns.'),
    );
  }
}

function buildText(doc: Doc) {
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
}

// ---------- offset <-> DOM mapping ----------

function offsetToPoint(offset: number): [Node, number] {
  const i = lineOf(lineStarts, offset);
  const node = lineEls[i].firstChild as Text;
  return [node, Math.min(offset - lineStarts[i], node.length)];
}

function rangeFor(start: number, end: number): Range {
  const r = document.createRange();
  r.setStart(...offsetToPoint(start));
  r.setEnd(...offsetToPoint(end));
  return r;
}

/** Converts a DOM boundary point inside the text to a character offset. */
function pointToOffset(node: Node, offset: number, kind: 'start' | 'end'): number {
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

function setNamedHighlight(name: string, range: Range | null, priority: number) {
  if (!hlSupported) return;
  if (!range) return registry!.delete(name);
  const hl = new HighlightCtor!(range);
  hl.priority = priority;
  registry!.set(name, hl);
}

function applyHighlights(doc: Doc | null) {
  if (!hlSupported) return;
  hlNames.forEach((n) => registry!.delete(n));
  hlNames = [];
  if (!doc) {
    dynStyle.textContent = '';
    return;
  }
  const byCode = new Map<string, Range[]>();
  for (const s of project.segments) {
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

// ---------- coder columns ----------

function buildColumns(doc: Doc) {
  gridEl.querySelectorAll('.coder-col').forEach((c) => c.remove());
  const sources = [
    { name: project.coderName || 'You', mine: true, segments: project.segments, codes: project.codes },
    ...project.externalCodings
      .filter((x) => !ui.hiddenExternal.includes(x.id))
      .map((x) => ({ name: x.coderName, mine: false, segments: x.segments, codes: x.codes })),
  ];
  columns = sources.map((src) => {
    const segs = src.segments.filter((s) => s.docId === doc.id);
    const body = h('div', { class: 'col-body' });
    gridEl.append(
      h(
        'div',
        { class: 'coder-col' + (src.mine ? ' mine' : '') },
        h(
          'div',
          { class: 'col-head', title: src.name },
          h('span', { class: 'col-name' }, src.name),
          h('span', { class: 'badge' }, String(segs.length)),
        ),
        body,
      ),
    );
    return { name: src.name, mine: src.mine, segs, codes: new Map(src.codes.map((c) => [c.id, c])), body };
  });
}

function scheduleLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    if (renderedDocId) layoutColumns();
  });
}

/** Positions each coded segment as a bracket next to the lines it spans, using lanes for overlaps. */
function layoutColumns() {
  const doc = currentDoc();
  if (!doc) return;
  for (const col of columns) {
    const base = col.body.getBoundingClientRect().top;
    const items = col.segs
      .filter((s) => s.start < s.end && s.end <= renderedContent.length)
      .map((s) => {
        const r = rangeFor(s.start, s.end).getBoundingClientRect();
        const top = r.top - base;
        return { s, top, bottom: Math.max(r.bottom - base, top + 18) };
      })
      .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

    const boxes: HTMLElement[] = [];
    let cluster: typeof items = [];
    let clusterEnd = -Infinity;
    const flush = () => {
      const laneEnds: number[] = [];
      const lanes = cluster.map((it) => {
        let lane = laneEnds.findIndex((end) => end <= it.top);
        if (lane === -1) lane = laneEnds.push(0) - 1;
        laneEnds[lane] = it.bottom + 2;
        return lane;
      });
      cluster.forEach((it, i) => boxes.push(makeBox(doc, col, it.s, it.top, it.bottom, lanes[i], laneEnds.length)));
      cluster = [];
    };
    for (const it of items) {
      if (it.top >= clusterEnd) {
        flush();
        clusterEnd = -Infinity;
      }
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.bottom + 2);
    }
    flush();
    col.body.replaceChildren(...boxes);
  }
}

function makeBox(doc: Doc, col: Column, s: Segment, top: number, bottom: number, lane: number, lanes: number) {
  const code = col.codes.get(s.codeId);
  const color = code?.color ?? '#9ca3af';
  const name = code?.name ?? '(unknown code)';
  const lines = lineLabel(doc, s.start, s.end);
  const excerpt = s.text.length > 300 ? s.text.slice(0, 300) + '…' : s.text;
  return h(
    'div',
    {
      class: 'stripe',
      title: `${name} · ${lines}\n\n${excerpt}`,
      style: {
        top: `${top}px`,
        height: `${bottom - top}px`,
        left: `calc(4px + (100% - 8px) * ${lane / lanes})`,
        width: `calc((100% - 8px) / ${lanes} - 2px)`,
        borderColor: color,
        background: hexToRgba(color, 0.14),
      },
      onMouseenter: () => setHoverRange(s.start, s.end),
      onMouseleave: () => setHoverRange(null),
      onClick: () => {
        focusSegment(s.start, s.end);
        if (col.mine) document.dispatchEvent(new CustomEvent('bct:segment-selected', { detail: s.id }));
      },
    },
    h('span', { class: 'stripe-label' }, name),
    bottom - top >= 34 ? h('span', { class: 'stripe-lines' }, lines) : null,
  );
}

// ---------- selection & code popup ----------

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
  if (end > start) openPopup(doc, start, end);
}

function openPopup(doc: Doc, start: number, end: number) {
  closePopup();
  const range = rangeFor(start, end);
  const rects = range.getClientRects();
  const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
  const grid = gridEl.getBoundingClientRect();

  const input = h('input', {
    type: 'text',
    class: 'popup-input',
    placeholder: 'Type a code…',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const color = h('input', { type: 'color', class: 'popup-color', value: nextColor(), title: 'Color for a new code' });
  const list = h('ul', { class: 'popup-list' });
  const applied = h('div', { class: 'popup-applied' });
  const el = h(
    'div',
    { class: 'code-popup' },
    h('div', { class: 'popup-meta' }, `${lineLabel(doc, start, end)} · ${end - start} characters`),
    h('div', { class: 'popup-row' }, color, input),
    list,
    applied,
    h('div', { class: 'popup-hint' }, '↵ apply · ⇧↵ apply & add another · ↑↓ choose · Esc cancel'),
  );
  gridEl.append(el);

  // Place the box just below the end of the selection so the selected text stays visible.
  const width = 320;
  el.style.width = `${width}px`;
  el.style.left = `${Math.max(8, Math.min(last.left - grid.left, grid.width - width - 8))}px`;
  el.style.top = `${last.bottom - grid.top + 8}px`;

  popup = { el, docId: doc.id, start, end, input, color, list, applied, items: [], exact: undefined, active: -1, counts: segmentCounts() };
  setNamedHighlight('qc-pending', range, 10);
  input.addEventListener('input', refreshSuggestions);
  input.addEventListener('keydown', onPopupKey);
  refreshSuggestions();
  renderApplied();
  input.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
}

export function closePopup() {
  if (!popup) return;
  popup.el.remove();
  popup = null;
  setNamedHighlight('qc-pending', null, 0);
}

function refreshSuggestions() {
  if (!popup) return;
  const q = popup.input.value.trim().toLowerCase();
  const rank = (c: Code) => {
    const n = c.name.toLowerCase();
    return n === q ? 0 : n.startsWith(q) ? 1 : 2;
  };
  popup.items = project.codes
    .filter((c) => c.name.toLowerCase().includes(q))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, 8);
  popup.exact = q ? popup.items.find((c) => c.name.toLowerCase() === q) : undefined;
  popup.active = popup.exact ? popup.items.indexOf(popup.exact) : -1;
  renderPopupList();
}

function renderPopupList() {
  const p = popup;
  if (!p) return;
  const q = p.input.value.trim();
  const pick = (i: number) => (e: MouseEvent) => {
    e.preventDefault();
    p.active = i;
    applyFromPopup(e.shiftKey);
  };
  p.list.replaceChildren(
    ...p.items.map((c, i) =>
      h(
        'li',
        { class: i === p.active ? 'active' : '', onMousedown: pick(i) },
        h('span', { class: 'swatch', style: { background: c.color } }),
        h('span', { class: 'grow' }, c.name),
        h('span', { class: 'muted' }, String(p.counts.get(c.id) ?? 0)),
      ),
    ),
  );
  if (q && !p.exact) {
    p.list.append(
      h(
        'li',
        { class: 'create' + (p.active === -1 ? ' active' : ''), onMousedown: pick(-1) },
        h('span', { class: 'swatch', style: { background: p.color.value } }),
        h('span', { class: 'grow' }, `Create new code “${q}”`),
      ),
    );
  }
  if (!p.items.length && !q) p.list.append(h('li', { class: 'empty' }, 'No codes yet — type a name to create one.'));
  p.list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function renderApplied() {
  const p = popup;
  if (!p) return;
  const here = project.segments.filter((s) => s.docId === p.docId && s.start === p.start && s.end === p.end);
  p.applied.replaceChildren(
    ...(here.length ? [h('span', { class: 'muted' }, 'Applied: ')] : []),
    ...here.map((s) => {
      const c = codeById(s.codeId);
      return c ? h('span', { class: 'chip', style: { background: hexToRgba(c.color, 0.25) } }, c.name) : '';
    }),
  );
}

function applyFromPopup(keepOpen: boolean) {
  const p = popup;
  if (!p) return;
  const name = p.active >= 0 ? p.items[p.active].name : p.input.value.trim();
  if (!name) return;
  applyCode(p.docId, p.start, p.end, name, p.color.value);
  if (!keepOpen) return closePopup();
  p.input.value = '';
  p.color.value = nextColor();
  p.counts = segmentCounts();
  refreshSuggestions();
  renderApplied();
  p.input.focus({ preventScroll: true });
}

function onPopupKey(e: KeyboardEvent) {
  const p = popup;
  if (!p) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    p.active = Math.min(p.active + 1, p.items.length - 1);
    renderPopupList();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    p.active = Math.max(p.active - 1, -1);
    renderPopupList();
  } else if (e.key === 'Tab' && p.active >= 0) {
    e.preventDefault();
    p.input.value = p.items[p.active].name;
    refreshSuggestions();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    applyFromPopup(e.shiftKey);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closePopup();
  }
}
