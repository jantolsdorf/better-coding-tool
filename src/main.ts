import './style.css';
import { addCodeUI, renderCodebook } from './codebook';
import { renderCoders } from './coders';
import { exportProject, exportSegmentsCSV, exportTableCSV, importCoderUI, importProjectUI, newProjectUI } from './io';
import { SAMPLE_NAME, SAMPLE_TEXT } from './sample';
import { initSegments, renderSegments } from './segments';
import { addDocs, commit, project, savedBytes, subscribe, ui } from './store';
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
const exportMenu = $('export-menu');
$('btn-export-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.hidden = !exportMenu.hidden;
});
document.addEventListener('click', () => (exportMenu.hidden = true));
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
  const kb = savedBytes / 1024;
  saveStatus.textContent = savedBytes ? `Saved in browser · ${kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`}` : '';
}

subscribe(render);
commit();
