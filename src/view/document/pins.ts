// Pins at the start and end of a highlighted passage: dragging one moves that end of the passage
// character by character. Used for a new selection (while the code box is open) and for a coded
// segment of the active coding (dragging changes the segment).

import './pins.css';
import { resizeSegmentTo } from '../../controller/coding';
import { codeById } from '../../model/codes';
import { layerSegments } from '../../model/layers';
import { h, hexToRgba } from '../dom';
import { onEveryDocument } from '../windows';
import { gridEl, pointToOffset, rangeFor, renderedContent, renderedDocId, setNamedHighlight, textBody } from './textView';

interface PinOptions {
  /** The passage's highlight color (e.g. the code's color); the default selection color if omitted. */
  color?: string;
  /** While dragging, after every change. */
  onChange?: (start: number, end: number) => void;
  /** When a pin is let go at a new position. */
  onCommit: (start: number, end: number) => void;
}

let state: { start: number; end: number; opts: PinOptions; layer: HTMLElement; style: HTMLStyleElement } | null = null;

/** Shows the passage [start, end) highlighted with a pin at each end. Replaces any pins shown before. */
export function showPins(start: number, end: number, opts: PinOptions) {
  hidePins();
  const style = h('style');
  const layer = h(
    'div',
    { class: 'pin-layer' },
    style,
    pin('start', 'Drag to move the start of the passage'),
    pin('end', 'Drag to move the end of the passage'),
  );
  gridEl.append(layer);
  state = { start, end, opts, layer, style };
  place();
}

export function hidePins() {
  setActiveSegment(null);
  if (!state) return;
  state.layer.remove();
  state = null;
  setNamedHighlight('qc-edit', null, 0);
}

// The coded segment that was clicked ("active"): it has the pins, and its code is highlighted in
// the column and the segment list until something else is clicked.
let activeSegmentId: string | null = null;
const activeListeners: ((id: string | null) => void)[] = [];

export const activeSegment = () => activeSegmentId;

/** Calls `fn` whenever a different segment becomes active (or none). */
export function onActiveSegmentChange(fn: (id: string | null) => void) {
  activeListeners.push(fn);
}

function setActiveSegment(id: string | null) {
  if (id === activeSegmentId) return;
  activeSegmentId = id;
  activeListeners.forEach((fn) => fn(id));
}

export const pinsShown = () => !!state;

/** Hides the pins when clicking elsewhere (outside the passage's own controls) or pressing Esc. */
export function initPins() {
  onEveryDocument((doc) => {
    doc.addEventListener('mousedown', (e) => {
      if (!(e.target as Element).closest?.('.text-pin, .code-popup, .code-label, .brace, .seg-card')) hidePins();
    });
    doc.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hidePins();
    });
  });
}

/**
 * Shows pins on a segment of the active coding (your coding, or the consolidated one while
 * consolidating); dragging one changes the segment.
 */
export function pinSegment(segmentId: string) {
  const seg = layerSegments().find((s) => s.id === segmentId);
  if (!seg) return hidePins();
  showPins(seg.start, seg.end, {
    color: codeById(seg.codeId)?.color,
    onCommit: (start, end) => {
      resizeSegmentTo(segmentId, start, end);
      // Show the segment as it is now (it may have joined an overlapping one with the same code).
      pinSegment(segmentId);
    },
  });
  setActiveSegment(segmentId);
}

/** Positions the pins and the highlight for the current passage (e.g. after the layout changed). */
export function placePins() {
  if (state) place();
}

function place() {
  if (!state || !renderedDocId || state.end > renderedContent.length) return hidePins();
  const { start, end, layer, style, opts } = state;
  const range = rangeFor(start, end);
  const rects = [...range.getClientRects()].filter((r) => r.width || r.height);
  if (!rects.length) return;
  const grid = gridEl.getBoundingClientRect();
  const first = rects[0];
  const last = rects[rects.length - 1];
  const [startPin, endPin] = layer.querySelectorAll<HTMLElement>('.text-pin');
  Object.assign(startPin.style, { left: `${first.left - grid.left}px`, top: `${first.top - grid.top}px`, height: `${first.height}px` });
  Object.assign(endPin.style, { left: `${last.right - grid.left}px`, top: `${last.top - grid.top}px`, height: `${last.height}px` });
  layer.style.setProperty('--pin-color', opts.color ?? 'var(--accent)');
  style.textContent = `::highlight(qc-edit){background-color:${opts.color ? hexToRgba(opts.color, 0.32) : 'var(--selection, rgba(79,70,229,.25))'};}`;
  setNamedHighlight('qc-edit', range, 25);
}

function pin(which: 'start' | 'end', title: string): HTMLElement {
  const el = h('div', { class: `text-pin ${which}`, title }, h('span', { class: 'text-pin-knob' }));
  el.addEventListener('pointerdown', (e) => startDrag(e, which));
  return el;
}

/** The text offset under a point of the window, or null if it is not over the text. */
function offsetAt(x: number, y: number): number | null {
  const doc = textBody.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | undefined;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) [node, offset] = [p.offsetNode, p.offset];
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) [node, offset] = [r.startContainer, r.startOffset];
  }
  if (!node || !textBody.contains(node)) return null;
  return pointToOffset(node, offset, 'start');
}

function startDrag(e: PointerEvent, which: 'start' | 'end') {
  if (!state) return;
  e.preventDefault();
  e.stopPropagation();
  const s = state;
  const before = { start: s.start, end: s.end };
  const doc = textBody.ownerDocument;
  const win = doc.defaultView ?? window;
  // The pins must not be hit while looking up the text under the pointer.
  s.layer.classList.add('dragging');
  doc.body.classList.add('pin-dragging');
  const move = (ev: PointerEvent) => {
    const at = offsetAt(ev.clientX, ev.clientY);
    if (at === null || !state) return;
    // A passage keeps at least one character; the pins cannot pass each other.
    if (which === 'start') s.start = Math.max(0, Math.min(at, s.end - 1));
    else s.end = Math.min(renderedContent.length, Math.max(at, s.start + 1));
    place();
    s.opts.onChange?.(s.start, s.end);
  };
  const up = () => {
    win.removeEventListener('pointermove', move);
    win.removeEventListener('pointerup', up);
    s.layer.classList.remove('dragging');
    doc.body.classList.remove('pin-dragging');
    if (state === s && (s.start !== before.start || s.end !== before.end)) s.opts.onCommit(s.start, s.end);
  };
  win.addEventListener('pointermove', move);
  win.addEventListener('pointerup', up);
}
