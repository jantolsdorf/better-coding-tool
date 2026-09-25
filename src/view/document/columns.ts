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
import { editMemo, removeMemo } from '../../controller/memos';
import { codePathParts } from '../../model/codes';
import { isConsolidated } from '../../model/consolidation';
import { currentDoc } from '../../model/documents';
import { activeLayer, consolidationOf } from '../../model/layers';
import { lineLabel } from '../../model/lines';
import { ui } from '../../model/state';
import { columnKeysInOrder, memoColumns, tableColumns, TEXT_KEY } from '../../model/table';
import type { Code, ColumnKey, Doc, Memo, MemoColumn, Segment, TableColumn } from '../../model/types';
import { h } from '../dom';
import { focusSegment, gridEl, rangeFor, renderedContent, renderedDocId, setHoverRange } from './textView';

interface Column {
  col: TableColumn;
  segs: Segment[];
  codes: Map<string, Code>;
  body: HTMLElement;
}

const COLUMN_DND_TYPE = 'application/x-bct-column';

let columns: Column[] = [];
let memoCols: { col: MemoColumn; body: HTMLElement }[] = [];
let layoutQueued = false;

export function buildColumns(doc: Doc) {
  gridEl.querySelectorAll('.coder-col').forEach((c) => c.remove());
  memoCols = [];
  // The Codes switch hides all coder columns; the Memos switch all memo columns.
  columns = (ui.showCodes ? tableColumns() : []).map((col) => {
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
  if (ui.showMemos) memoColumns().forEach(buildMemoColumn);
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

/** Width of one bracket lane; overlapping codes get brackets side by side. */
const LANE_WIDTH = 8;
/** Height of one code name; names that would collide are stacked below each other. */
const LABEL_HEIGHT = 17;
/** Space between the brackets and the names (the connecting line runs here). */
const GAP = 10;

/**
 * Shows each coded segment as a bracket spanning its lines, open towards the text, with a line
 * from its middle to the code's name. Overlapping segments get their brackets side by side (the
 * first next to the text); the names use the rest of the column, centered on their bracket's
 * middle and stacked when they would collide.
 */
export function layoutColumns() {
  const doc = currentDoc();
  if (!doc) return;
  const keys = columnKeysInOrder();
  const textAt = keys.indexOf(TEXT_KEY);
  for (const col of columns) {
    // Mirror everything when the column is left of the text, so brackets still open towards it.
    const textOnLeft = keys.indexOf(col.col.key) > textAt;
    const base = col.body.getBoundingClientRect().top;
    const items = col.segs
      .filter((s) => s.start < s.end && s.end <= renderedContent.length)
      .map((s) => {
        const r = rangeFor(s.start, s.end).getBoundingClientRect();
        const top = r.top - base;
        return { s, top, bottom: Math.max(r.bottom - base, top + 14), lane: 0, labelTop: 0 };
      })
      .sort((a, b) => a.top - b.top || b.bottom - a.bottom);

    // Lanes for the brackets: a bracket takes the first lane that is free at its top.
    const laneEnds: number[] = [];
    for (const it of items) {
      let lane = laneEnds.findIndex((end) => end <= it.top);
      if (lane === -1) lane = laneEnds.push(0) - 1;
      laneEnds[lane] = it.bottom + 2;
      it.lane = lane;
    }
    const lanesWidth = 4 + Math.max(1, laneEnds.length) * LANE_WIDTH;
    const labelStart = lanesWidth + GAP;

    // Names are centered on their bracket's middle, but never overlap the previous name.
    const byMiddle = [...items].sort((a, b) => a.top + a.bottom - (b.top + b.bottom));
    let labelBottom = -Infinity;
    for (const it of byMiddle) {
      it.labelTop = Math.max((it.top + it.bottom) / 2 - LABEL_HEIGHT / 2, labelBottom);
      labelBottom = it.labelTop + LABEL_HEIGHT;
    }

    const lines = document.createElementNS(SVG_NS, 'svg');
    lines.classList.add('code-lines');
    // Distances from the text side become x positions (mirrored when the text is on the right).
    const width = col.body.clientWidth;
    const toX = (fromText: number) => (textOnLeft ? fromText : width - fromText);
    const parts: Element[] = [lines];
    for (const it of items) {
      parts.push(...codeMark(doc, col, it, textOnLeft, lanesWidth, labelStart, lines, toX));
    }
    lines.setAttribute('height', String(Math.max(labelBottom, ...items.map((i) => i.bottom), 0) + 4));
    col.body.replaceChildren(...parts);
  }
  for (const { col, body } of memoCols) layoutMemos(doc, col, body);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

interface MarkItem {
  s: Segment;
  top: number;
  bottom: number;
  lane: number;
  labelTop: number;
}

/**
 * The bracket, the connecting line and the name of one coded segment. Positions are measured
 * from the side facing the text; hovering the bracket or the name highlights all three and the
 * passage.
 */
function codeMark(
  doc: Doc,
  col: Column,
  it: MarkItem,
  textOnLeft: boolean,
  lanesWidth: number,
  labelStart: number,
  lines: SVGSVGElement,
  toX: (fromText: number) => number,
): Element[] {
  const { s, top, bottom, lane, labelTop } = it;
  const code = col.codes.get(s.codeId);
  const color = code?.color ?? '#9ca3af';
  const name = code?.name ?? '(unknown code)';
  const lineLabelText = lineLabel(doc, s.start, s.end);
  const excerpt = s.text.length > 300 ? s.text.slice(0, 300) + '…' : s.text;
  const from = s.source ? ` · from ${s.source}` : '';
  const title = `${name} · ${lineLabelText}${from}\n\n${excerpt}`;
  const near = textOnLeft ? 'left' : 'right';
  const far = textOnLeft ? 'right' : 'left';

  // The bracket: top, bottom and the side away from the text; open towards the text.
  const bracketFrom = 4 + lane * LANE_WIDTH;
  const bracketWidth = LANE_WIDTH - 2;
  const brace = h('div', {
    class: `brace open-${near}`,
    title,
    style: { top: `${top}px`, height: `${bottom - top}px`, [near]: `${bracketFrom}px`, width: `${bracketWidth}px`, borderColor: color },
  });

  // The line from the bracket's middle to the middle of the name (with a bend if the name moved).
  const mid = (top + bottom) / 2;
  const nameMid = labelTop + LABEL_HEIGHT / 2;
  const tip = bracketFrom + bracketWidth;
  const bend = lanesWidth + GAP / 2;
  const points: [number, number][] = [[tip, mid], [bend, mid], [bend, nameMid], [labelStart, nameMid]];
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', points.map(([d, y], i) => `${i ? 'L' : 'M'}${toX(d)} ${y}`).join(' '));
  path.setAttribute('stroke', color);
  path.classList.add('code-line');
  lines.append(path);

  const label = h(
    'div',
    {
      class: `code-label ${near}`,
      title,
      style: { top: `${labelTop}px`, [near]: `${labelStart}px`, [far]: '4px' },
    },
    h('span', { class: 'code-label-name' }, name),
    boxActions(col, s, code),
  );
  label.style.setProperty('--code-color', color);

  const hover = (on: boolean) => {
    brace.classList.toggle('hot', on);
    label.classList.toggle('hot', on);
    path.classList.toggle('hot', on);
    setHoverRange(on ? s.start : null, s.end, color);
  };
  const select = () => {
    focusSegment(s.start, s.end);
    if (col.col.kind === activeLayer()) document.dispatchEvent(new CustomEvent('bct:segment-selected', { detail: s.id }));
  };
  for (const el of [brace, label]) {
    el.addEventListener('mouseenter', () => hover(true));
    el.addEventListener('mouseleave', () => hover(false));
    el.addEventListener('click', select);
  }
  return [brace, label];
}

// ---------- memos (sticky notes) ----------

/** A column of sticky notes: your memos, or another coder's (read-only). */
function buildMemoColumn(col: MemoColumn) {
  const body = h('div', { class: 'col-body' });
  const el = h(
    'div',
    { class: 'coder-col memo-col' + (col.mine ? ' mine' : ''), 'data-key': col.key },
    h(
      'div',
      { class: 'col-head', title: `${col.name} — drag to reorder`, draggable: true },
      h('span', { class: 'grip' }, '⋮⋮'),
      h('span', { class: 'col-name' }, col.name),
      h('span', { class: 'badge' }, String(col.memos.length)),
    ),
    body,
    h('div', { class: 'col-resizer', title: 'Drag to resize' }),
  );
  const width = ui.columnWidths[col.key];
  if (width) setFixedWidth(el, width);
  makeColumnDraggable(el, col.key);
  makeResizable(el, (w) => setColumnWidth(col.key, w), 120, 700);
  gridEl.append(el);
  memoCols.push({ col, body });
}

/** Places each sticky note next to its passage, pushing notes down so they never overlap. */
function layoutMemos(doc: Doc, col: MemoColumn, body: HTMLElement) {
  const base = body.getBoundingClientRect().top;
  const notes = col.memos
    .filter((m) => m.docId === doc.id && m.end <= renderedContent.length)
    .map((m) => ({ m, top: rangeFor(m.start, m.end).getBoundingClientRect().top - base }))
    .sort((a, b) => a.top - b.top);
  body.replaceChildren(...notes.map(({ m }) => stickyNote(doc, m, col.mine)));
  let bottom = 0;
  notes.forEach(({ top }, i) => {
    const el = body.children[i] as HTMLElement;
    const y = Math.max(top, bottom + (i ? 6 : 0));
    el.style.top = `${y}px`;
    bottom = y + el.offsetHeight;
  });
}

/** A sticky note; your own can be edited and deleted, other coders' are read-only. */
function stickyNote(doc: Doc, m: Memo, editable: boolean): HTMLElement {
  const text = h('div', { class: 'sticky-text', title: editable ? 'Click to edit' : null }, m.note);
  const note = h(
    'div',
    {
      class: 'sticky' + (editable ? '' : ' readonly'),
      onMouseenter: () => setHoverRange(m.start, m.end),
      onMouseleave: () => setHoverRange(null),
    },
    h(
      'div',
      { class: 'sticky-head' },
      h('button', { class: 'sticky-lines', title: 'Show the passage', onClick: () => focusSegment(m.start, m.end) }, lineLabel(doc, m.start, m.end)),
      editable
        ? h(
            'button',
            {
              class: 'stripe-btn',
              title: 'Delete memo',
              onClick: (e: MouseEvent) => {
                e.stopPropagation();
                setHoverRange(null);
                removeMemo(m.id);
              },
            },
            '✕',
          )
        : null,
    ),
    text,
  );
  if (editable) text.addEventListener('click', () => editInPlace(note, text, m));
  return note;
}

/** Turns a sticky note's text into a text field: Enter saves, Shift+Enter adds a line, Esc cancels. */
function editInPlace(note: HTMLElement, text: HTMLElement, m: Memo) {
  if (note.querySelector('textarea')) return;
  const area = h('textarea', { class: 'sticky-edit', rows: 3 });
  area.value = m.note;
  const grow = () => {
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  };
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    if (save && area.value.trim() !== m.note) editMemo(m.id, area.value);
    else area.replaceWith(text);
  };
  area.addEventListener('input', grow);
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  area.addEventListener('blur', () => finish(true));
  text.replaceWith(area);
  grow();
  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);
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
