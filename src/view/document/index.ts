// The document area: header, text with highlights, coder columns, and the code box.

import { startConsolidationOf, setTextWidth, toggleSegmentList } from '../../controller/comparison';
import { importCoderInteractive } from '../../controller/transfer';
import { currentDoc, folderPath } from '../../model/documents';
import { activeLayer, consolidationOf, layerSegments } from '../../model/layers';
import { project, ui } from '../../model/state';
import { TEXT_KEY } from '../../model/table';
import type { Doc } from '../../model/types';
import { h } from '../dom';
import { closeCodeBox, initCodeBox } from './codeBox';
import { initViewMenu, viewMenu } from './viewMenu';
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
  initViewMenu();
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
  setFixedWidth(textCol, ui.textWidth);
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
      `${lineCount()} lines · ${count} ${layer === 'consolidated' ? 'consolidated' : 'coded'} segment${count === 1 ? '' : 's'}${into}`,
    ),
    h(
      'div',
      { class: 'vh-actions' },
      viewMenu(),
      h(
        'button',
        {
          class: 'btn small',
          title: 'Import another person’s exported project and show their coding as a column next to yours',
          onClick: importCoderInteractive,
        },
        '＋ Compare with coder…',
      ),
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
      h(
        'button',
        { class: 'btn small', title: 'Show or hide the list of coded segments', onClick: toggleSegmentList },
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
