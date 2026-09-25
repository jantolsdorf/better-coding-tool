// The coder columns next to the text: one bracket per coded segment, aligned with the lines it
// spans. Columns (including the text column) can be reordered by dragging and resized.

import {
  acceptAllSegments,
  acceptSegment,
  discardConsolidationInteractive,
  finishConsolidationInteractive,
  moveColumn,
  setColumnWidth,
} from '../../controller/comparison';
import { removeSegment } from '../../controller/coding';
import { codePathParts } from '../../model/codes';
import { isConsolidated } from '../../model/consolidation';
import { currentDoc } from '../../model/documents';
import { activeLayer, consolidationOf } from '../../model/layers';
import { lineLabel } from '../../model/lines';
import { ui } from '../../model/state';
import { columnKeysInOrder, tableColumns, TEXT_KEY } from '../../model/table';
import type { Code, ColumnKey, Doc, Segment, TableColumn } from '../../model/types';
import { h, hexToRgba } from '../dom';
import { focusSegment, gridEl, rangeFor, renderedContent, renderedDocId, setHoverRange } from './textView';

interface Column {
  col: TableColumn;
  segs: Segment[];
  codes: Map<string, Code>;
  body: HTMLElement;
}

const COLUMN_DND_TYPE = 'application/x-bct-column';

let columns: Column[] = [];
let layoutQueued = false;

export function buildColumns(doc: Doc) {
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
          onClick: () => finishConsolidationInteractive(doc),
        },
        '✓ Finish',
      ),
      h(
        'button',
        {
          class: 'icon-btn head-btn',
          title: 'Discard the consolidated coding of this document',
          onClick: () => discardConsolidationInteractive(doc),
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
        onClick: () => acceptAllSegments(col, segs, codes),
      },
      '⇉ All',
    ),
  ];
}

/** Columns are reordered by dragging their header. */
export function makeColumnDraggable(el: HTMLElement, key: ColumnKey) {
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
export function makeResizable(el: HTMLElement, save: (width: number | null) => void, min = 300, max = 2000) {
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

export function setFixedWidth(el: HTMLElement, width: number | null) {
  el.style.flex = width ? `0 0 ${width}px` : '';
  el.style.maxWidth = width ? 'none' : '';
}

export function scheduleLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    if (renderedDocId) layoutColumns();
  });
}

/** Positions each coded segment as a bracket next to the lines it spans, using lanes for overlaps. */
export function layoutColumns() {
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
    return h('span', { class: 'stripe-actions' }, btn('✕', 'Remove this segment', () => removeSegment(s.id)));
  }
  if (!consolidating || !code) return null;
  if (isConsolidated(s, codePathParts(code, col.col.codes))) {
    return h('span', { class: 'stripe-actions always', title: 'Already in the consolidated coding' }, h('span', { class: 'stripe-ok' }, '✓'));
  }
  return h(
    'span',
    { class: 'stripe-actions' },
    btn('＋', 'Accept into the consolidated coding', () => acceptSegment(col.col, s, code)),
  );
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
