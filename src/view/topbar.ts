// The top bar (coder name, undo/redo, import/export menus, theme) and the page-wide buttons,
// menus and keyboard shortcuts.

import { addCodeFromPrompt, setCodeSort, setCodeView } from '../controller/codes';
import { addFilesFromPicker, addSampleDocument, createFolder } from '../controller/documents';
import { redoChange, undoChange } from '../controller/history';
import { cycleTheme, setCoderName } from '../controller/preferences';
import {
  exportCodebook,
  exportProject,
  hasChangesNotDownloaded,
  exportQdpx,
  exportSegmentsCSV,
  exportTableCSV,
  importCodebookInteractive,
  importCoderInteractive,
  importProjectInteractive,
  newProjectInteractive,
} from '../controller/transfer';
import { canRedo, canUndo, project, savedBytes, ui } from '../model/state';
import type { UIState } from '../model/types';
import { setCodebookFilter } from './codebookList';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const onClick = (id: string, fn: () => void) => $(id).addEventListener('click', fn);

const THEME_LABELS: Record<UIState['theme'], string> = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };

let coderInput: HTMLInputElement;
let saveStatus: HTMLElement;
let backupStatus: HTMLButtonElement;
let undoBtn: HTMLButtonElement;
let redoBtn: HTMLButtonElement;
let themeBtn: HTMLButtonElement;
let codeSort: HTMLSelectElement;
let codeView: HTMLSelectElement;

export function initTopbar() {
  coderInput = $<HTMLInputElement>('coder-name');
  saveStatus = $('save-status');
  backupStatus = $<HTMLButtonElement>('backup-status');
  backupStatus.addEventListener('click', exportProject);
  undoBtn = $<HTMLButtonElement>('btn-undo');
  redoBtn = $<HTMLButtonElement>('btn-redo');
  themeBtn = $<HTMLButtonElement>('btn-theme');
  codeSort = $<HTMLSelectElement>('code-sort');
  codeView = $<HTMLSelectElement>('code-view');

  // Documents, codebook, other coders
  onClick('btn-add-files', addFilesFromPicker);
  onClick('btn-add-folder', () => createFolder());
  onClick('btn-empty-add', addFilesFromPicker);
  onClick('btn-sample', addSampleDocument);
  onClick('btn-add-code', addCodeFromPrompt);
  onClick('btn-import-coder', importCoderInteractive);

  // Import and export
  onClick('btn-import-coder-top', importCoderInteractive);
  onClick('btn-import-project', importProjectInteractive);
  onClick('btn-import-qdpx', importProjectInteractive);
  onClick('btn-import-codebook-top', importCodebookInteractive);
  onClick('btn-import-codebook', importCodebookInteractive);
  onClick('btn-export-project', exportProject);
  onClick('btn-export-qdpx', exportQdpx);
  onClick('btn-export-table-current', () => exportTableCSV('current'));
  onClick('btn-export-table-all', () => exportTableCSV('all'));
  onClick('btn-export-segments', exportSegmentsCSV);
  onClick('btn-export-codebook', () => exportCodebook('json'));
  onClick('btn-export-codebook-csv', () => exportCodebook('csv'));
  onClick('btn-new-project', newProjectInteractive);

  // Codebook filter, sort and display
  const codeSearch = $<HTMLInputElement>('code-search');
  codeSearch.addEventListener('input', () => setCodebookFilter(codeSearch.value));
  codeSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    codeSearch.value = '';
    setCodebookFilter('');
  });
  codeSort.addEventListener('change', () => setCodeSort(codeSort.value as UIState['codeSort']));
  codeView.addEventListener('change', () => setCodeView(codeView.value as UIState['codeView']));

  coderInput.addEventListener('change', () => {
    // The coder always needs a name; clearing the field keeps the previous one.
    if (!setCoderName(coderInput.value)) coderInput.value = project.coderName;
  });
  themeBtn.addEventListener('click', cycleTheme);
  undoBtn.addEventListener('click', undoChange);
  redoBtn.addEventListener('click', redoChange);
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    // Leave text fields their own undo, and don't change the project under an open dialog.
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undoChange();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      redoChange();
    }
  });

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
}

export function renderTopbar() {
  if (ui.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = ui.theme;
  themeBtn.textContent = THEME_LABELS[ui.theme] ?? THEME_LABELS.auto;
  themeBtn.title = 'Color theme (click to switch between automatic, light and dark)';
  codeSort.value = ui.codeSort;
  codeView.value = ui.codeView;
  if (document.activeElement !== coderInput) coderInput.value = project.coderName;
  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();
  const kb = savedBytes / 1024;
  saveStatus.textContent = savedBytes ? `Saved in browser · ${kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`}` : '';
  // Whether the latest changes are also in a downloaded copy; clicking downloads one.
  const pending = hasChangesNotDownloaded();
  backupStatus.hidden = !pending && !ui.backedUp;
  backupStatus.classList.toggle('pending', pending);
  backupStatus.disabled = !pending;
  backupStatus.textContent = pending
    ? '● Not downloaded'
    : `✓ Downloaded ${ui.backedUp ? new Date(ui.backedUp.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`;
  backupStatus.title = pending
    ? 'Your latest changes are only saved in this browser. Click to download a copy of the project (.zip).'
    : 'A downloaded copy contains all your changes.';
}
