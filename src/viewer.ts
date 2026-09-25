import {
  acceptIntoConsolidated,
  activeLayer,
  applyCode,
  codeById,
  codePath,
  columnKeysInOrder,
  consolidationOf,
  TEXT_KEY,
  codePathParts,
  findChildCode,
  findCodeByPath,
  matchesCodeQuery,
  missingInPath,
  type AcceptItem,
  splitCodePath,
  commitUI,
  currentDoc,
  deleteSegment,
  discardConsolidation,
  finishConsolidation,
  folderPath,
  isConsolidated,
  layerSegments,
  moveColumn,
  nextColor,
  project,
  segmentCounts,
  setColumnWidth,
  startConsolidation,
  tableColumns,
  ui,
} from './store';
import { importCoderUI } from './io';
import type { Code, ColumnKey, Doc, Segment, TableColumn } from './types';
import { h, hexToRgba, lineLabel, lineOf, lineStartsOf, toast } from './util';

// CSS Custom Highlight API: colors text ranges without touching the DOM.
type HighlightLike = { priority: number };
const registry: { set(name: string, hl: HighlightLike): void; delete(name: string): void } | undefined = (
  globalThis.CSS as unknown as { highlights?: never }
)?.highlights;
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...r: Range[]) => HighlightLike }).Highlight;
const hlSupported = !!registry && !!HighlightCtor;

interface Column {
  col: TableColumn;
  segs: Segment[];
  codes: Map<string, Code>;
  body: HTMLElement;
}

const COLUMN_DND_TYPE = 'application/x-bct-column';

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
  const textCol = h(
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
  makeColumnDraggable(textCol, TEXT_KEY);
  makeResizable(textCol, (w) => {
    ui.textWidth = w && Math.round(w);
    commitUI();
  });
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
  applyTextWidth();
  buildColumns(doc);
  applyHighlights(doc);
  layoutColumns();
}

function renderHeader(doc: Doc) {
  const path = folderPath(doc.folderId);
  const layer = activeLayer();
  const count = layerSegments(layer).filter((s) => s.docId === doc.id).length;
  const into = layer === 'consolidated' ? ' · New codes go into the consolidated coding' : ' · Select text to code it';
  headerEl.replaceChildren(
    h('div', { class: 'vh-title' }, path ? h('span', { class: 'vh-path' }, `${path} / `) : null, doc.name),
    h(
      'div',
      { class: 'vh-meta' },
      `${lineStarts.length} lines · ${count} ${layer === 'consolidated' ? 'consolidated' : 'coded'} segment${count === 1 ? '' : 's'}${into}`,
    ),
    h(
      'div',
      { class: 'vh-actions' },
      h(
        'button',
        {
          class: 'btn small',
          title: 'Import another person’s exported project and show their coding as a column next to yours',
          onClick: importCoderUI,
        },
        '＋ Compare with coder…',
      ),
      !consolidationOf(doc.id) && project.externalCodings.length
        ? h(
            'button',
            {
              class: 'btn small',
              title: 'Build an agreed coding of this document by accepting segments from each coder’s column',
              onClick: () => startConsolidation(doc.id),
            },
            'Start consolidation',
          )
        : null,
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
  for (const s of layerSegments()) {
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
  columns = tableColumns().map((col) => {
    const segs = col.segments.filter((s) => s.docId === doc.id);
    const codes = new Map(col.codes.map((c) => [c.id, c]));
    const body = h('div', { class: 'col-body' });
    const el = h(
      'div',
      { class: `coder-col ${col.kind}`, 'data-key': col.key },
      h(
        'div',
        { class: 'col-head', title: `${col.name} — drag to reorder`, draggable: true },
        h('span', { class: 'grip' }, '⋮⋮'),
        h('span', { class: 'col-name' }, col.name),
        h('span', { class: 'badge' }, String(segs.length)),
        ...columnActions(doc, col, segs, codes),
      ),
      body,
      h('div', { class: 'col-resizer', title: 'Drag to resize' }),
    );
    const width = ui.columnWidths[col.key];
    if (width) setFixedWidth(el, width);
    makeColumnDraggable(el, col.key);
    makeResizable(el, (w) => setColumnWidth(col.key, w), 90, 700);
    gridEl.append(el);
    return { col, segs, codes, body };
  });
  // Visual order (the DOM keeps the text first); the text stays pinned while it is the first column.
  const keys = columnKeysInOrder();
  for (const el of gridEl.querySelectorAll<HTMLElement>('.text-col, .coder-col')) {
    el.style.order = String(keys.indexOf(el.dataset.key!));
  }
  gridEl.querySelector('.text-col')!.classList.toggle('pinned', keys[0] === TEXT_KEY);
}

function columnActions(doc: Doc, col: TableColumn, segs: Segment[], codes: Map<string, Code>): HTMLElement[] {
  if (!consolidationOf(doc.id)) return [];
  if (col.kind === 'consolidated') {
    return [
      h(
        'button',
        {
          class: 'icon-btn head-btn',
          title: 'Finish: make the consolidated coding your coding of this document',
          onClick: () => {
            const ok = confirm(
              `Finish the consolidation of “${doc.name}”?\n\nThe consolidated coding becomes your coding of this document. ` +
                'Your current coding of it is kept under “Other coders” so you can still compare against it. Other documents are not changed.',
            );
            if (ok) toast(`Done. Your previous coding of this document is kept as “${finishConsolidation(doc.id)}”.`, 5000);
          },
        },
        '✓ Finish',
      ),
      h(
        'button',
        {
          class: 'icon-btn head-btn',
          title: 'Discard the consolidated coding of this document',
          onClick: () => {
            if (confirm(`Discard the consolidated coding of “${doc.name}”? Your own coding is not changed.`)) discardConsolidation(doc.id);
          },
        },
        '✕',
      ),
    ];
  }
  return [
    h(
      'button',
      {
        class: 'icon-btn head-btn',
        title: `Accept all of ${col.name}’s segments in this document into the consolidated coding`,
        onClick: () => {
          const items = segs.flatMap((seg) => {
            const code = codes.get(seg.codeId);
            return code ? [acceptItem(col, seg, code)] : [];
          });
          const n = acceptIntoConsolidated(items);
          toast(n ? `Accepted ${n} segment${n === 1 ? '' : 's'} from ${col.name}.` : 'Nothing new to accept.');
        },
      },
      '⇉ All',
    ),
  ];
}

/** Columns are reordered by dragging their header and resized by dragging their right edge. */
function makeColumnDraggable(el: HTMLElement, key: ColumnKey) {
  const head = el.querySelector<HTMLElement>('.col-head')!;
  head.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData(COLUMN_DND_TYPE, key);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    el.classList.add('dragging');
  });
  head.addEventListener('dragend', () => el.classList.remove('dragging'));

  const clear = () => el.classList.remove('drop-before', 'drop-after');
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(COLUMN_DND_TYPE)) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    el.classList.toggle('drop-after', after);
    el.classList.toggle('drop-before', !after);
  });
  el.addEventListener('dragleave', clear);
  el.addEventListener('drop', (e) => {
    const dragged = e.dataTransfer?.getData(COLUMN_DND_TYPE);
    if (!dragged) return;
    e.preventDefault();
    const after = el.classList.contains('drop-after');
    clear();
    moveColumn(dragged, key, after);
  });
}

/** Lets the user drag the element's .col-resizer to set its width; double-click resets it (null). */
function makeResizable(el: HTMLElement, save: (width: number | null) => void, min = 300, max = 2000) {
  const handle = el.querySelector<HTMLElement>('.col-resizer')!;
  handle.addEventListener('dblclick', () => save(null));
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = el.offsetWidth;
    let width = startW;
    const move = (ev: MouseEvent) => {
      width = Math.max(min, Math.min(max, startW + ev.clientX - startX));
      setFixedWidth(el, width);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('resizing');
      if (width !== startW) save(width);
    };
    document.body.classList.add('resizing');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function setFixedWidth(el: HTMLElement, width: number | null) {
  el.style.flex = width ? `0 0 ${width}px` : '';
  el.style.maxWidth = width ? 'none' : '';
}

function applyTextWidth() {
  setFixedWidth(gridEl.querySelector<HTMLElement>('.text-col')!, ui.textWidth);
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

function boxActions(col: Column, s: Segment, code: Code | undefined): HTMLElement | null {
  const kind = col.col.kind;
  const btn = (label: string, title: string, fn: () => void) =>
    h(
      'button',
      {
        class: 'stripe-btn',
        title,
        onClick: (e: MouseEvent) => {
          e.stopPropagation();
          setHoverRange(null);
          fn();
        },
      },
      label,
    );
  const consolidating = !!consolidationOf(s.docId);
  if (kind === 'consolidated' || (kind === 'mine' && !consolidating)) {
    return h('span', { class: 'stripe-actions' }, btn('✕', 'Remove this segment', () => deleteSegment(s.id)));
  }
  if (!consolidating || !code) return null;
  if (isConsolidated(s, codePathParts(code, col.col.codes))) {
    return h('span', { class: 'stripe-actions always', title: 'Already in the consolidated coding' }, h('span', { class: 'stripe-ok' }, '✓'));
  }
  return h(
    'span',
    { class: 'stripe-actions' },
    btn('＋', 'Accept into the consolidated coding', () => acceptIntoConsolidated([acceptItem(col.col, s, code)])),
  );
}

/** A segment of a coder's column, with its code identified by path in that coder's codebook. */
function acceptItem(col: TableColumn, seg: Segment, code: Code): AcceptItem {
  return { seg, path: codePathParts(code, col.codes), color: code.color, source: col.name };
}

function makeBox(doc: Doc, col: Column, s: Segment, top: number, bottom: number, lane: number, lanes: number) {
  const code = col.codes.get(s.codeId);
  const color = code?.color ?? '#9ca3af';
  const name = code?.name ?? '(unknown code)';
  const lines = lineLabel(doc, s.start, s.end);
  const excerpt = s.text.length > 300 ? s.text.slice(0, 300) + '…' : s.text;
  const from = s.source ? ` · from ${s.source}` : '';
  return h(
    'div',
    {
      class: 'stripe',
      title: `${name} · ${lines}${from}\n\n${excerpt}`,
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
        if (col.col.kind === activeLayer()) document.dispatchEvent(new CustomEvent('bct:segment-selected', { detail: s.id }));
      },
    },
    boxActions(col, s, code),
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
  color.addEventListener('input', renderPopupList);
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
  input.addEventListener('keydown', onPopupKey);
  refreshSuggestions();
  renderTarget();
  renderApplied();
  input.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
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
          ui.codeTarget = value;
          commitUI();
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

export function closePopup() {
  if (!popup) return;
  popup.el.remove();
  popup = null;
  setNamedHighlight('qc-pending', null, 0);
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

function applyFromPopup(keepOpen: boolean) {
  const p = popup;
  if (!p) return;
  // A chosen suggestion is applied by its full path, so codes with the same name stay distinct.
  const chosen = p.active >= 0 ? p.items[p.active] : undefined;
  const name = chosen ? codePath(chosen) : p.input.value.trim();
  if (!splitCodePath(name).length) return;
  const res = applyCode(p.docId, p.start, p.end, name, p.color.value);
  if (res?.result === 'extended') toast(`Extended the existing “${res.code.name}” segment to include this passage.`);
  if (res?.result === 'contained') toast(`This passage is already part of a “${res.code.name}” segment.`);
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
