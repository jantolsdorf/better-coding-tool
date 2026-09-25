// The whole page: sets up every view once, and re-renders them all whenever the state changes.

import { renderCodebook } from './codebookList';
import { renderCoderList } from './coderList';
import { initDocumentView, renderDocumentView } from './document';
import { applyMainLayout, initMainLayout } from './layout';
import { initSegmentList, renderSegmentList } from './segmentList';
import { applyPanelSizes, initSplitters } from './splitters';
import { initTopbar, renderTopbar } from './topbar';
import { initTree, renderTree } from './tree';
import { initLeaveGuard } from './leaveGuard';
import { ui } from '../model/state';

const $ = (id: string) => document.getElementById(id)!;

let treeEl: HTMLElement;
let codebookEl: HTMLElement;
let codersEl: HTMLElement;
let segmentsEl: HTMLElement;
let sidebar: HTMLElement;
let layout: HTMLElement;

export function initApp() {
  treeEl = $('tree');
  codebookEl = $('codebook');
  codersEl = $('coders');
  segmentsEl = $('segments-list');
  sidebar = document.querySelector<HTMLElement>('.sidebar')!;
  layout = document.querySelector<HTMLElement>('.layout')!;

  initDocumentView($('viewer'), $('viewer-empty'));
  initTree(treeEl);
  initSegmentList(segmentsEl);
  initTopbar();
  initSplitters(sidebar);
  initMainLayout(layout);
  initLeaveGuard();

  // Dropping a file outside the document tree should not navigate away from the app.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

/** Re-renders a list without losing its scroll position. */
function keepScroll(el: HTMLElement, fn: () => void) {
  const top = el.scrollTop;
  fn();
  el.scrollTop = top;
}

export function renderApp() {
  renderTopbar();
  applyPanelSizes(sidebar);
  applyMainLayout();
  layout.classList.toggle('segments-hidden', ui.segmentsHidden);
  keepScroll(treeEl, () => renderTree(treeEl));
  keepScroll(codebookEl, () => renderCodebook(codebookEl));
  renderCoderList(codersEl);
  renderDocumentView();
  keepScroll(segmentsEl, () => renderSegmentList(segmentsEl, $('segments-count'), $('segments-title')));
}
