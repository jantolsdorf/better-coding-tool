// The whole page: sets up every view once, and re-renders them all whenever the state changes.

import { renderCodebook } from './codebookList';
import { renderCoderList } from './coderList';
import { initDocumentView, renderDocumentView, setViewerPopoutHandler } from './document';
import { applyMainLayout, initMainLayout } from './layout';
import { initSegmentList, renderSegmentList } from './segmentList';
import { applyPanelSizes, initSplitters } from './splitters';
import { initTopbar, renderTopbar } from './topbar';
import { initTree, renderTree } from './tree';
import { initLeaveGuard } from './leaveGuard';
import { ui } from '../model/state';
import { popupBlocked } from './feedback';
import { bringBack, byId, initWindows, isPoppedOut, onWindowsChange, popOut } from './windows';

const $ = (id: string) => document.getElementById(id)!;

let treeEl: HTMLElement;
let codebookEl: HTMLElement;
let codersEl: HTMLElement;
let segmentsEl: HTMLElement;
let sidebar: HTMLElement;
let layout: HTMLElement;
let segmentsCount: HTMLElement;
let segmentsTitle: HTMLElement;

/** Parts that can be opened in a separate window: their key, place in the main window, title and ⧉ button. */
const PARTS = [
  { key: 'docs', container: () => document.querySelector<HTMLElement>('.panel.docs')!, title: 'Documents', button: 'btn-popout-docs' },
  { key: 'codes', container: () => document.querySelector<HTMLElement>('.panel.codes')!, title: 'Codebook', button: 'btn-popout-codes' },
  { key: 'viewer', container: () => $('viewer'), title: 'Text', button: 'btn-popout-viewer' },
  { key: 'segments', container: () => document.querySelector<HTMLElement>('.segments')!, title: 'Coded segments', button: 'btn-popout-segments' },
];

/** Opens a part in a separate window, or brings it back if it is in one. */
export function togglePopout(key: string) {
  const part = PARTS.find((p) => p.key === key)!;
  if (isPoppedOut(key)) bringBack(key);
  else if (!popOut(key, part.container(), part.title, key === 'viewer' ? { width: 1000, height: 820 } : undefined)) popupBlocked();
}

export function initApp() {
  treeEl = $('tree');
  codebookEl = $('codebook');
  codersEl = $('coders');
  segmentsEl = $('segments-list');
  sidebar = document.querySelector<HTMLElement>('.sidebar')!;
  layout = document.querySelector<HTMLElement>('.layout')!;

  segmentsCount = $('segments-count');
  segmentsTitle = $('segments-title');
  initWindows();
  // After a part moved between windows, render again (e.g. to lay out the code columns).
  onWindowsChange(renderApp);
  for (const part of PARTS) {
    if (part.key !== 'viewer') $(part.button).addEventListener('click', () => togglePopout(part.key));
  }
  initDocumentView($('viewer'), $('viewer-empty'));
  setViewerPopoutHandler(() => togglePopout('viewer'));
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
  keepScroll(segmentsEl, () => renderSegmentList(segmentsEl, segmentsCount, segmentsTitle));
  // ⧉ opens a part in a separate window; in that window the same button brings it back.
  for (const part of PARTS) {
    const btn = byId(part.button);
    if (!btn) continue;
    btn.textContent = isPoppedOut(part.key) ? '↩' : '⧉';
    btn.title = isPoppedOut(part.key) ? 'Back into the main window' : 'Open in a separate window';
  }
}
