import './style.css';
import { addCodeUI, renderCodebook, setCodebookFilter } from './codebook';
import { renderCoders } from './coders';
import {
  exportCodebook,
  exportProject,
  exportQdpx,
  exportSegmentsCSV,
  exportTableCSV,
  importCodebookUI,
  importCoderUI,
  importProjectUI,
  newProjectUI,
} from './io';
import { SAMPLE_NAME, SAMPLE_TEXT } from './sample';
import { initSegments, renderSegments } from './segments';
import { applyPanelSizes, initSplitters } from './splitters';
import { addDocs, canRedo, canUndo, commit, commitUI, project, redo, savedBytes, subscribe, ui, undo } from './store';
import { toast } from './util';
import { addFilesUI, addFolderUI, initTree, renderTree } from './tree';
import { initViewer, renderViewer } from './viewer';
import { askCoderName } from './welcome';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const treeEl = $('tree');
const codebookEl = $('codebook');
const codersEl = $('coders');
const segmentsEl = $('segments-list');
const coderInput = $<HTMLInputElement>('coder-name');
const saveStatus = $('save-status');

initViewer($('viewer'), $('viewer-empty'));
initTree(treeEl);
initSegments(segmentsEl);

$('btn-add-files').addEventListener('click', addFilesUI);
$('btn-add-folder').addEventListener('click', () => addFolderUI());
$('btn-add-code').addEventListener('click', addCodeUI);
$('btn-import-coder').addEventListener('click', importCoderUI);
$('btn-import-coder-top').addEventListener('click', importCoderUI);
$('btn-import-codebook-top').addEventListener('click', importCodebookUI);
$('btn-export-project').addEventListener('click', exportProject);
$('btn-import-project').addEventListener('click', importProjectUI);
$('btn-import-qdpx').addEventListener('click', importProjectUI);
$('btn-export-qdpx').addEventListener('click', exportQdpx);

const codeSearch = $<HTMLInputElement>('code-search');
const codeSort = $<HTMLSelectElement>('code-sort');
codeSearch.addEventListener('input', () => setCodebookFilter(codeSearch.value));
codeSearch.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  codeSearch.value = '';
  setCodebookFilter('');
});
codeSort.addEventListener('change', () => {
  ui.codeSort = codeSort.value as typeof ui.codeSort;
  commitUI();
});
const codeView = $<HTMLSelectElement>('code-view');
codeView.addEventListener('change', () => {
  ui.codeView = codeView.value as typeof ui.codeView;
  commitUI();
});

const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
initSplitters(sidebar);

// Theme: follow the system, or a fixed light/dark choice.
const THEMES = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' } as const;
const themeBtn = $<HTMLButtonElement>('btn-theme');
themeBtn.addEventListener('click', () => {
  const order = Object.keys(THEMES) as (keyof typeof THEMES)[];
  ui.theme = order[(order.indexOf(ui.theme) + 1) % order.length];
  commitUI();
});
function applyTheme() {
  if (ui.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = ui.theme;
  themeBtn.textContent = THEMES[ui.theme] ?? THEMES.auto;
  themeBtn.title = 'Color theme (click to switch between automatic, light and dark)';
}
// Dropdown menus: a .menu-toggle button opens the .menu-list next to it; any click closes them.
const menuLists = [...document.querySelectorAll<HTMLElement>('.menu-list')];
for (const toggle of document.querySelectorAll<HTMLElement>('.menu-toggle')) {
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const list = toggle.nextElementSibling as HTMLElement;
    const open = list.hidden;
    menuLists.forEach((m) => (m.hidden = true));
    list.hidden = !open;
  });
}
document.addEventListener('click', () => menuLists.forEach((m) => (m.hidden = true)));
$('btn-export-codebook').addEventListener('click', () => exportCodebook('json'));
$('btn-export-codebook-csv').addEventListener('click', () => exportCodebook('csv'));
$('btn-import-codebook').addEventListener('click', importCodebookUI);

const undoBtn = $<HTMLButtonElement>('btn-undo');
const redoBtn = $<HTMLButtonElement>('btn-redo');
const doUndo = () => undo() || toast('Nothing to undo.');
const doRedo = () => redo() || toast('Nothing to redo.');
undoBtn.addEventListener('click', doUndo);
redoBtn.addEventListener('click', doRedo);
document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  // Leave text fields their own undo, and don't change the project under an open dialog.
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    doUndo();
  } else if ((key === 'z' && e.shiftKey) || key === 'y') {
    e.preventDefault();
    doRedo();
  }
});

$('btn-export-table-current').addEventListener('click', () => exportTableCSV('current'));
$('btn-export-table-all').addEventListener('click', () => exportTableCSV('all'));
$('btn-export-segments').addEventListener('click', exportSegmentsCSV);
$('btn-new-project').addEventListener('click', newProjectUI);
$('btn-empty-add').addEventListener('click', addFilesUI);
$('btn-sample').addEventListener('click', () => addDocs([{ name: SAMPLE_NAME, content: SAMPLE_TEXT }], ui.selectedFolderId));
coderInput.addEventListener('change', () => {
  const name = coderInput.value.trim();
  // The coder always needs a name; clearing the field keeps the previous one.
  if (!name) return void (coderInput.value = project.coderName);
  project.coderName = name;
  commit();
});

// Dropping a file outside the document tree should not navigate away from the app.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

function keepScroll(el: HTMLElement, fn: () => void) {
  const top = el.scrollTop;
  fn();
  el.scrollTop = top;
}

function render() {
  applyTheme();
  applyPanelSizes(sidebar);
  codeSort.value = ui.codeSort;
  codeView.value = ui.codeView;
  document.querySelector('.layout')!.classList.toggle('segments-hidden', ui.segmentsHidden);
  keepScroll(treeEl, () => renderTree(treeEl));
  keepScroll(codebookEl, () => renderCodebook(codebookEl));
  renderCoders(codersEl);
  renderViewer();
  keepScroll(segmentsEl, () => renderSegments(segmentsEl, $('segments-count'), $('segments-title')));
  if (document.activeElement !== coderInput) coderInput.value = project.coderName;
  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();
  const kb = savedBytes / 1024;
  saveStatus.textContent = savedBytes ? `Saved in browser · ${kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`}` : '';
}

subscribe(render);
commit();
if (!project.coderName) askCoderName();
