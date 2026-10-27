// The top bar (coder name, undo/redo, view menu, import/export menus, theme) and the page-wide buttons,
// menus and keyboard shortcuts.

import './topbar.css';
import {
  deleteCodebookInteractive,
  setCodeFilterOption,
  setCodeSort,
  setCodeView,
  toggleAllCodesCollapsed,
} from '../controller/codes';
import { addFilesFromPicker, addSampleDocument, createFolder } from '../controller/documents';
import { redoChange, undoChange } from '../controller/history';
import { addCoderInteractive, cycleTheme, forgetCoderNow, renameCoderInteractive, switchCoderTo } from '../controller/preferences';
import { projectCoders } from '../model/projectCoders';
import {
  exportCodebook,
  exportProject,
  hasChangesNotDownloaded,
  exportQdpx,
  exportSegmentsCSV,
  exportTableCSV,
  importCodebookCsvInteractive,
  importCodebookInteractive,
  importCoderInteractive,
  importProjectInteractive,
} from '../controller/transfer';
import { canRedo, canUndo, project, savedBytes, ui } from '../model/state';
import type { UIState } from '../model/types';
import { clearCodeSelection, copySelectedCodes, deleteSelectedCodes, setCodebookFilter } from './codebookList';
import { openChallengeReview } from './challengeReview';
import { toast } from './feedback';
import { openOccurrenceView } from './occurrenceView';
import { openCodeCreateDialog } from './codeCreateDialog';
import { h } from './dom';
import { openStartDialog } from './startDialog';
import { clearDocSelection, deleteSelectedItems, toggleDocSelectMode } from './tree';
import { closeViewMenu, initViewMenu, viewMenu } from './viewMenu';
import { onEveryDocument } from './windows';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const onClick = (id: string, fn: () => void) => $(id).addEventListener('click', fn);

const THEME_LABELS: Record<UIState['theme'], string> = { auto: '◐ Auto', light: '☀ Light', dark: '☾ Dark' };

let coderBtn: HTMLButtonElement;
let coderList: HTMLElement;
let saveStatus: HTMLElement;
let backupStatus: HTMLButtonElement;
let undoBtn: HTMLButtonElement;
let redoBtn: HTMLButtonElement;
let themeBtn: HTMLButtonElement;
let codeSort: HTMLSelectElement;
let codeView: HTMLSelectElement;
let filterSubcodes: HTMLInputElement;
let filterDescriptions: HTMLInputElement;
let filterOptions: HTMLElement;
let viewMenuSlot: HTMLElement;

export function initTopbar() {
  coderBtn = $<HTMLButtonElement>('btn-coder');
  coderList = $('coder-list');
  saveStatus = $('save-status');
  backupStatus = $<HTMLButtonElement>('backup-status');
  backupStatus.addEventListener('click', exportProject);
  undoBtn = $<HTMLButtonElement>('btn-undo');
  redoBtn = $<HTMLButtonElement>('btn-redo');
  themeBtn = $<HTMLButtonElement>('btn-theme');
  codeSort = $<HTMLSelectElement>('code-sort');
  codeView = $<HTMLSelectElement>('code-view');
  viewMenuSlot = $('view-menu-slot');
  initViewMenu();

  // Documents, codebook, other coders
  onClick('btn-add-files', addFilesFromPicker);
  onClick('btn-add-folder', () => createFolder());
  onClick('btn-empty-add', addFilesFromPicker);
  onClick('btn-sample', addSampleDocument);
  onClick('btn-add-code', () => openCodeCreateDialog('code'));
  onClick('btn-auto-code', () => openCodeCreateDialog('auto'));
  onClick('btn-select-docs', toggleDocSelectMode);
  onClick('btn-toggle-codes', toggleAllCodesCollapsed);

  // Esc ends selecting; Delete/Backspace deletes the selection of the panel used last; ⌘C / Ctrl+C
  // copies the selected codes' names (unless text is selected).
  let lastPanel: 'docs' | 'codes' = 'docs';
  // On the panels' contents, which go along when a panel moves to a separate window.
  for (const [sel, name] of [['.panel.docs', 'docs'], ['.panel.codes', 'codes']] as const) {
    for (const child of document.querySelector(sel)?.children ?? []) child.addEventListener('pointerdown', () => (lastPanel = name));
  }
  onEveryDocument((doc) => doc.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest?.('input:not([type=checkbox]), textarea, select, [contenteditable]') || doc.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      clearDocSelection();
      clearCodeSelection();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const done = lastPanel === 'codes' ? deleteSelectedCodes() : deleteSelectedItems();
      if (done) e.preventDefault();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && lastPanel === 'codes' && doc.getSelection()?.isCollapsed !== false) {
      if (copySelectedCodes()) e.preventDefault();
    }
  }));
  onClick('btn-import-coder', importCoderInteractive);

  // Import and export
  onClick('btn-compare-coder', importCoderInteractive);
  onClick('btn-review-challenge', () =>
    project.externalCodings.length ? openChallengeReview() : toast('Add another coder first (Compare ▾ → Add a coder to compare).', 4500),
  );
  onClick('btn-code-occurrence', () =>
    project.externalCodings.length ? openOccurrenceView() : toast('Add another coder first (Compare ▾ → Add a coder to compare).', 4500),
  );
  onClick('btn-import-project', importProjectInteractive);
  onClick('btn-import-qdpx', importProjectInteractive);
  onClick('btn-import-codebook-top', importCodebookInteractive);
  onClick('btn-import-codebook', importCodebookInteractive);
  onClick('btn-import-codebook-csv', importCodebookCsvInteractive);
  onClick('btn-import-codebook-csv-top', importCodebookCsvInteractive);
  onClick('btn-delete-codebook', deleteCodebookInteractive);
  onClick('btn-export-project', exportProject);
  onClick('btn-export-qdpx', exportQdpx);
  onClick('btn-export-table-current', () => exportTableCSV('current'));
  onClick('btn-export-table-all', () => exportTableCSV('all'));
  onClick('btn-export-segments', exportSegmentsCSV);
  onClick('btn-export-codebook', () => exportCodebook('json'));
  onClick('btn-export-codebook-csv', () => exportCodebook('csv'));
  onClick('btn-export-codebook-qdc', () => exportCodebook('qdc'));
  onClick('btn-import-codebook-qdc-top', importCodebookInteractive);
  onClick('btn-new-project', () => openStartDialog({ firstUse: false }));

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
  filterSubcodes = $<HTMLInputElement>('filter-subcodes');
  filterDescriptions = $<HTMLInputElement>('filter-descriptions');
  filterOptions = $('btn-filter-options');
  filterSubcodes.addEventListener('change', () => setCodeFilterOption('codeFilterSubcodes', filterSubcodes.checked));
  filterDescriptions.addEventListener('change', () => setCodeFilterOption('codeFilterDescriptions', filterDescriptions.checked));
  // Ticking options keeps the menu open.
  document.querySelector('.filter-menu')?.addEventListener('click', (e) => e.stopPropagation());

  themeBtn.addEventListener('click', cycleTheme);
  undoBtn.addEventListener('click', undoChange);
  redoBtn.addEventListener('click', redoChange);
  onEveryDocument((doc) => doc.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    // Leave text fields their own undo, and don't change the project under an open dialog.
    const t = e.target as HTMLElement;
    if (t.closest?.('input, textarea, select, [contenteditable]') || doc.querySelector('dialog[open]')) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undoChange();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      redoChange();
    }
  }));

  // Dropdown menus: a .menu-toggle button opens the .menu-list next to it; any click closes them.
  const menuLists = [...document.querySelectorAll<HTMLElement>('.menu-list')];
  for (const toggle of document.querySelectorAll<HTMLElement>('.menu-toggle')) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const list = toggle.nextElementSibling as HTMLElement;
      const open = list.hidden;
      menuLists.forEach((m) => (m.hidden = true));
      closeViewMenu();
      list.hidden = !open;
    });
  }
  onEveryDocument((doc) => doc.addEventListener('click', () => menuLists.forEach((m) => (m.hidden = true))));
}

export function renderTopbar() {
  if (ui.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = ui.theme;
  themeBtn.textContent = THEME_LABELS[ui.theme] ?? THEME_LABELS.auto;
  themeBtn.title = 'Color theme (click to switch between automatic, light and dark)';
  codeSort.value = ui.codeSort;
  codeView.value = ui.codeView;
  filterSubcodes.checked = ui.codeFilterSubcodes;
  filterDescriptions.checked = ui.codeFilterDescriptions;
  // Highlighted while the filter works differently from the default.
  filterOptions.classList.toggle('on', ui.codeFilterSubcodes || !ui.codeFilterDescriptions);
  viewMenuSlot.replaceChildren(viewMenu());
  renderCoderMenu();
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

/** The coder menu: everyone coding in this project (switch with a click), a new coder, renaming. */
function renderCoderMenu() {
  coderBtn.replaceChildren(h('span', { class: 'muted' }, 'Coder '), h('strong', {}, project.coderName || 'Your name'), ' ▾');
  const item = (label: Node | string, title: string, fn: () => void, extra = '') =>
    h('button', { class: `coder-item${extra}`, title, onClick: fn }, label);
  const coders = projectCoders();
  coderList.replaceChildren(
    h('div', { class: 'view-title' }, 'Coding as'),
    ...coders.map((c) => {
      const current = c.name === project.coderName;
      const work = `${c.segments} code${c.segments === 1 ? '' : 's'}${c.memos ? ` · ${c.memos} memo${c.memos === 1 ? '' : 's'}` : ''}`;
      return h(
        'div',
        { class: 'coder-row' + (current ? ' current' : '') },
        item(
          h('span', { class: 'coder-item-label' }, h('span', { class: 'coder-check' }, current ? '✓' : ''), h('span', { class: 'grow' }, c.name), h('span', { class: 'muted' }, work)),
          current ? 'You are coding as this coder' : `Code as “${c.name}” from now on (earlier codes keep their author)`,
          () => switchCoderTo(c.name),
        ),
        !current && !c.segments && !c.memos
          ? h('button', { class: 'icon-btn', title: `Remove “${c.name}” from the list`, onClick: (e: MouseEvent) => (e.stopPropagation(), forgetCoderNow(c.name)) }, '✕')
          : null,
      );
    }),
    h('div', { class: 'menu-sep' }),
    item('＋ New coder…', 'Add a coder and code as them from now on', addCoderInteractive),
    item(`✎ Rename “${project.coderName || 'Your name'}”…`, 'Rename the current coder, also as author of their codes and memos', () => renameCoderInteractive()),
  );
}
