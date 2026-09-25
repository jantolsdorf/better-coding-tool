// The coded segments panel: the passages of the open document in the active coding.

import { removeSegment } from '../controller/coding';
import { codeById } from '../model/codes';
import { currentDoc } from '../model/documents';
import { activeLayer, layerSegments } from '../model/layers';
import { lineLabel } from '../model/lines';
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
  countEl.textContent = String(segs.length);
  if (!segs.length) {
    container.replaceChildren(h('p', { class: 'muted pad' }, 'Nothing coded yet. Highlight a passage in the text and type a code.'));
    return;
  }
  container.replaceChildren(
    ...segs.map((s) => {
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
    }),
  );
}
