// The coded segments panel: the passages of the open document in the active coding.

import { removeSegment } from '../controller/coding';
import { removeMemo } from '../controller/memos';
import { codeById } from '../model/codes';
import { currentDoc } from '../model/documents';
import { activeLayer, layerSegments } from '../model/layers';
import { lineLabel } from '../model/lines';
import { memosOf } from '../model/memos';
import type { Doc, Memo, Segment } from '../model/types';
import { openCodeDialog } from './codeDialog';
import { focusSegment, setHoverRange } from './document/textView';
import { h, hexToRgba } from './dom';

export function initSegmentList(container: HTMLElement) {
  // Clicking a bracket in the text margin highlights the matching card here.
  document.addEventListener('bct:segment-selected', (e) => {
    const card = container.querySelector<HTMLElement>(`[data-id="${(e as CustomEvent<string>).detail}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
  });
}

export function renderSegmentList(container: HTMLElement, countEl: HTMLElement, titleEl: HTMLElement) {
  titleEl.textContent = activeLayer() === 'consolidated' ? 'Consolidated segments' : 'Coded segments';
  const doc = currentDoc();
  if (!doc) {
    countEl.textContent = '';
    container.replaceChildren(h('p', { class: 'muted pad' }, 'Open a document to see its coded segments.'));
    return;
  }
  const segs = layerSegments()
    .filter((s) => s.docId === doc.id)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const memos = memosOf(doc.id);
  countEl.textContent = String(segs.length);
  if (!segs.length && !memos.length) {
    container.replaceChildren(h('p', { class: 'muted pad' }, 'Nothing coded yet. Highlight a passage in the text and type a code (or “memo: …”).'));
    return;
  }
  // Segments and memos in text order; memos look like sticky notes.
  const cards = [
    ...segs.map((s) => ({ start: s.start, end: s.end, el: () => segmentCard(doc, s) })),
    ...memos.map((m) => ({ start: m.start, end: m.end, el: () => memoCard(doc, m) })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  container.replaceChildren(...cards.map((c) => c.el()));
}

function memoCard(doc: Doc, m: Memo): HTMLElement {
  return h(
    'div',
    {
      class: 'seg-card memo-card',
      'data-id': m.id,
      onMouseenter: () => setHoverRange(m.start, m.end),
      onMouseleave: () => setHoverRange(null),
      onClick: () => focusSegment(m.start, m.end),
    },
    h(
      'div',
      { class: 'seg-top' },
      h('span', { class: 'memo-label' }, 'Memo'),
      h('span', { class: 'seg-lines' }, lineLabel(doc, m.start, m.end)),
      h(
        'button',
        {
          class: 'icon-btn',
          title: 'Delete memo',
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            setHoverRange(null);
            removeMemo(m.id);
          },
        },
        '✕',
      ),
    ),
    h('div', { class: 'memo-note' }, m.note),
    h('div', { class: 'seg-text memo-passage' }, m.text),
  );
}

function segmentCard(doc: Doc, s: Segment): HTMLElement {
  const code = codeById(s.codeId);
  const color = code?.color ?? '#9ca3af';
  return h(
    'div',
    {
      class: 'seg-card',
      'data-id': s.id,
      style: { borderLeftColor: color },
      onMouseenter: () => setHoverRange(s.start, s.end),
      onMouseleave: () => setHoverRange(null),
      onClick: () => focusSegment(s.start, s.end),
    },
    h(
      'div',
      { class: 'seg-top' },
      h(
        'button',
        {
          class: 'seg-code',
          style: { background: hexToRgba(color, 0.22) },
          title: 'Open code details',
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            if (code) openCodeDialog(code.id);
          },
        },
        code?.name ?? '(unknown code)',
      ),
      h('span', { class: 'seg-lines' }, lineLabel(doc, s.start, s.end)),
      h(
        'button',
        {
          class: 'icon-btn',
          title: 'Remove this coding',
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            setHoverRange(null);
            removeSegment(s.id);
          },
        },
        '✕',
      ),
    ),
    h('div', { class: 'seg-text' }, s.text),
  );
}
