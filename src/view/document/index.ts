// The document area: header, text with highlights, coder columns, and the code box.

import { acceptMatchingSegments, setTextColored, setTextWidth, startConsolidationOf } from '../../controller/comparison';
import { compareCodings, isConsolidated, matchingItems } from '../../model/consolidation';
import { currentDoc, folderPath } from '../../model/documents';
import { activeLayer, consolidationOf, layerSegments } from '../../model/layers';
import { project, ui } from '../../model/state';
import { comparedColumns, TEXT_KEY } from '../../model/table';
import type { Doc } from '../../model/types';
import { h } from '../dom';
import { closeCodeBox, initCodeBox } from './codeBox';
import { buildColumns, layoutColumns, makeColumnDraggable, makeResizable, scheduleLayout, setFixedWidth } from './columns';
import {
  applyHighlights,
  clearText,
  createTextArea,
  hlSupported,
  lineCount,
  renderedContent,
  renderedDocId,
  renderText,
  textBody,
  textCol,
  textHeadActions,
} from './textView';

let root: HTMLElement;
let headerEl: HTMLElement;

export function initDocumentView(el: HTMLElement, empty: HTMLElement) {
  root = el;
  headerEl = h('div', { class: 'viewer-header' });
  root.append(headerEl, createTextArea(), empty);
  makeColumnDraggable(textCol, TEXT_KEY);
  makeResizable(textCol, setTextWidth);
  initCodeBox();
  new ResizeObserver(scheduleLayout).observe(textBody);
}

export function renderDocumentView() {
  const doc = currentDoc();
  root.classList.toggle('is-empty', !doc);
  if (!doc) {
    closeCodeBox();
    clearText();
    return;
  }
  if (doc.id !== renderedDocId || doc.content !== renderedContent) {
    closeCodeBox();
    renderText(doc);
  }
  renderHeader(doc);
  renderTextHead();
  setFixedWidth(textCol, ui.textWidth);
  buildColumns(doc);
  applyHighlights(doc);
  layoutColumns();
}

/** The text column's header button that colors all coded text (otherwise only on hover). */
function renderTextHead() {
  const on = ui.colorText && ui.showCodes;
  textHeadActions.replaceChildren(
    h(
      'button',
      {
        class: 'icon-btn head-btn toggle' + (on ? ' on' : ''),
        'aria-pressed': String(on),
        disabled: !ui.showCodes,
        title: ui.showCodes
          ? on
            ? 'Coded text is colored · click to show plain text (passages are then highlighted on hover)'
            : 'Color all coded text in its code’s color (otherwise only the passage under the mouse is highlighted)'
          : 'Codes are hidden (View ▾)',
        onClick: () => setTextColored(!ui.colorText),
      },
      'Highlight coded segments',
    ),
  );
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
      `${lineCount()} lines · ${count} ${layer === 'consolidated' ? 'consolidated' : 'coded'} segment${count === 1 ? '' : 's'}${into}`,
    ),
    h(
      'div',
      { class: 'vh-actions' },
      !consolidationOf(doc.id) && project.externalCodings.length
        ? h(
            'button',
            {
              class: 'btn small',
              title: 'Build an agreed coding of this document by accepting segments from each coder’s column',
              onClick: () => startConsolidationOf(doc),
            },
            'Start consolidation',
          )
        : null,
      ...(consolidationOf(doc.id) && ui.showCodes ? agreementTools(doc) : []),
    ),
  );
  if (!hlSupported) {
    headerEl.append(
      h('div', { class: 'vh-warn' }, 'This browser does not support colored text highlights; codes are still shown in the columns.'),
    );
  }
}

/**
 * While consolidating: how many passages the shown coder columns agree and differ on, and a
 * button that accepts all agreed passages into the consolidated coding.
 */
function agreementTools(doc: Doc): HTMLElement[] {
  const cols = comparedColumns();
  if (cols.length < 2) {
    return [h('span', { class: 'agree-summary muted', title: 'Matches are found between the coder columns that are shown' }, 'Show two or more coders to compare')];
  }
  const agreement = [...compareCodings(doc, cols).values()];
  const items = matchingItems(doc, cols);
  const pending = items.filter((i) => !isConsolidated(i.seg, i.path)).length;
  const differ = agreement.filter((a) => a.status !== 'match').length;
  const names = cols.map((c) => c.name).join(', ');
  return [
    h(
      'span',
      {
        class: 'agree-summary',
        title: `Compared: ${names} (hide a column in View ▾ to leave it out).\n= all have the same code on the same lines\n≈ others have the code on overlapping but different lines\n≠ not coded like this by everyone`,
      },
      h('span', { class: 'agree-mark match' }, '='),
      ` ${items.length} agree `,
      h('span', { class: 'agree-mark missing' }, '≠'),
      ` ${differ} differ`,
    ),
    h(
      'button',
      {
        class: 'btn small',
        disabled: !pending,
        title: pending
          ? `Add the ${pending} passage${pending === 1 ? '' : 's'} on which ${names} agree to the consolidated coding`
          : items.length
            ? 'All passages the coders agree on are already in the consolidated coding'
            : 'The coders do not have the same code on the same lines anywhere in this document',
        onClick: () => acceptMatchingSegments(doc),
      },
      pending ? `⇉ Accept ${pending} matching` : '⇉ Accept matching',
    ),
  ];
}
