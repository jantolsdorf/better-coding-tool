// The document area: header, text with highlights, coder columns, and the code box.

import { setTextColored, setTextWidth, startConsolidationOf } from '../../controller/comparison';
import { currentDoc, folderPath } from '../../model/documents';
import { activeLayer, consolidationOf, layerSegments } from '../../model/layers';
import { project, ui } from '../../model/state';
import { TEXT_KEY } from '../../model/table';
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
    ),
  );
  if (!hlSupported) {
    headerEl.append(
      h('div', { class: 'vh-warn' }, 'This browser does not support colored text highlights; codes are still shown in the columns.'),
    );
  }
}
