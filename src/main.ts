import './style.css';
import { addCodeUI, renderCodebook } from './codebook';
import { renderCoders } from './coders';
import {
  exportCodebook,
  exportProject,
  exportSegmentsCSV,
  exportTableCSV,
  importCodebookUI,
  importCoderUI,
  importProjectUI,
  newProjectUI,
} from './io';
import { SAMPLE_NAME, SAMPLE_TEXT } from './sample';
import { initSegments, renderSegments } from './segments';
import { addDocs, canRedo, canUndo, commit, project, redo, savedBytes, subscribe, ui, undo } from './store';
import { toast } from './util';
import { addFilesUI, addFolderUI, initTree, renderTree } from './tree';
import { initViewer, renderViewer } from './viewer';

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
$('btn-export-project').addEventListener('click', exportProject);
$('btn-import-project').addEventListener('click', importProjectUI);
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
  project.coderName = coderInput.value.trim();
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
