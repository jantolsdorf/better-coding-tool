// The document list: folders and documents, with drag and drop to move them or add files, and
// multiple selection to move or delete several at once.

import {
  addTextFiles,
  anyFolderExpanded,
  createFolder,
  deleteDocInteractive,
  deleteFolderInteractive,
  deleteItemsInteractive,
  moveItem,
  moveItemsTo,
  openDocument,
  renameDocInteractive,
  renameFolderInteractive,
  selectFolder,
  setFolderCollapsed,
  toggleAllFoldersCollapsed,
  type TreeItem,
} from '../controller/documents';
import { folderChain, folderContents } from '../model/documents';
import { project, ui } from '../model/state';
import type { Doc, Folder } from '../model/types';
import { byName } from '../model/util';
import { h } from './dom';
import { actionSelect, Selection, TOP_LEVEL } from './multiSelect';

const DND_TYPE = 'application/x-bct-item';

let lastContainer: HTMLElement | null = null;
const selection = new Selection(() => lastContainer && renderTree(lastContainer));

const keyOf = (item: TreeItem) => `${item.type}:${item.id}`;
const itemOf = (key: string): TreeItem => {
  const [type, id] = key.split(':');
  return { type: type as TreeItem['type'], id };
};
const selectedItems = () => [...selection.keys].map(itemOf);

/** Turns the document list's select mode (checkboxes) on or off. */
export const toggleDocSelectMode = () => selection.toggleMode();

/** Deletes the selected documents and folders (Delete key); returns false if nothing is selected. */
export function deleteSelectedItems(): boolean {
  if (!selection.size) return false;
  if (deleteItemsInteractive(selectedItems())) selection.clear();
  return true;
}

export const clearDocSelection = () => selection.clear();

export function initTree(container: HTMLElement) {
  // Dropping on empty space in the tree moves things to the top level.
  makeDropTarget(container, null);
}

export function renderTree(container: HTMLElement) {
  lastContainer = container;
  selection.prune(new Set([...project.docs.map((d) => `doc:${d.id}`), ...project.folders.map((f) => `folder:${f.id}`)]));
  const selectBtn = document.getElementById('btn-select-docs');
  selectBtn?.classList.toggle('on', selection.active);
  if (selectBtn) selectBtn.textContent = selection.active ? 'Done' : 'Select';
  const rootRow = h(
    'div',
    {
      class: 'tree-row root' + (ui.selectedFolderId === null ? ' selected' : ''),
      style: { paddingLeft: '8px' },
      onClick: () => selectFolder(null),
    },
    h('span', { class: 'tree-icon' }, '🗂️'),
    h('span', { class: 'tree-name' }, 'All documents'),
    project.folders.length ? expandAllButton() : null,
    h('span', { class: 'badge' }, String(project.docs.length)),
  );
  makeDropTarget(rootRow, null);
  const rows = [rootRow, ...renderChildren(null, 1)];
  selection.order = rows.flatMap((r) => (r.dataset.key ? [r.dataset.key] : []));
  if (!project.docs.length && !project.folders.length) {
    rows.push(h('p', { class: 'muted pad' }, 'Add .txt files with “+ Files” or drop them here.'));
  }
  container.replaceChildren(...(selection.active ? [selectionBar()] : []), ...rows);
}

/** Opens or closes all folders at once. */
function expandAllButton(): HTMLElement {
  const close = anyFolderExpanded();
  return h(
    'button',
    {
      class: 'icon-btn expand-all',
      title: close ? 'Close all folders' : 'Open all folders',
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        toggleAllFoldersCollapsed();
      },
    },
    close ? '⊟' : '⊞',
  );
}

function selectionBar(): HTMLElement {
  const folders = project.folders
    .map((f): [string, string] => [f.id, [...folderChain(f.id)].join(' / ')])
    .sort((a, b) => a[1].localeCompare(b[1]));
  return selection.bar(
    [
      actionSelect('Move…', 'Move the selected documents and folders', [[TOP_LEVEL, '(top level)'], ...folders], (v) => {
        moveItemsTo(selectedItems(), v === TOP_LEVEL ? null : v);
      }),
      h('button', { class: 'icon-btn danger', title: 'Delete the selected documents and folders (Delete)', onClick: deleteSelectedItems }, '🗑'),
    ],
    ['item', 'items'],
  );
}

function renderChildren(parentId: string | null, depth: number): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const f of project.folders.filter((x) => x.parentId === parentId).sort(byName)) {
    out.push(folderRow(f, depth));
    if (!ui.collapsed.includes(f.id)) out.push(...renderChildren(f.id, depth + 1));
  }
  for (const d of project.docs.filter((x) => x.folderId === parentId).sort(byName)) out.push(docRow(d, depth));
  return out;
}

const pad = (depth: number) => `${8 + depth * 14}px`;

function action(label: string, title: string, fn: () => void) {
  return h(
    'button',
    {
      class: 'icon-btn',
      title,
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        fn();
      },
    },
    label,
  );
}

function folderRow(f: Folder, depth: number) {
  const collapsed = ui.collapsed.includes(f.id);
  const count = folderContents(f.id).docs.length;
  const row = h(
    'div',
    {
      class: 'tree-row folder' + (ui.selectedFolderId === f.id ? ' selected' : ''),
      style: { paddingLeft: pad(depth) },
      draggable: true,
      title: 'New files and folders are added to the selected folder',
      onClick: () => selectFolder(f.id),
    },
    h(
      'span',
      {
        class: 'caret',
        onClick: (e: MouseEvent) => {
          e.stopPropagation();
          setFolderCollapsed(f.id, !collapsed);
        },
      },
      collapsed ? '▸' : '▾',
    ),
    h('span', { class: 'tree-icon' }, collapsed ? '📁' : '📂'),
    h('span', { class: 'tree-name' }, f.name),
    h('span', { class: 'badge' }, String(count)),
    h(
      'span',
      { class: 'tree-actions' },
      action('＋', 'New subfolder', () => createFolder(f.id)),
      action('✎', 'Rename folder', () => renameFolderInteractive(f)),
      action('🗑', 'Delete folder', () => deleteFolderInteractive(f)),
    ),
  );
  setUpRow(row, { type: 'folder', id: f.id });
  makeDropTarget(row, f.id);
  return row;
}

function docRow(d: Doc, depth: number) {
  const count = project.segments.filter((s) => s.docId === d.id).length;
  const row = h(
    'div',
    {
      class: 'tree-row doc' + (ui.selectedDocId === d.id ? ' active' : ''),
      style: { paddingLeft: pad(depth) },
      draggable: true,
      title: d.name,
      onClick: () => openDocument(d),
    },
    h('span', { class: 'caret' }),
    h('span', { class: 'tree-icon' }, '📄'),
    h('span', { class: 'tree-name' }, d.name),
    project.consolidations[d.id] ? h('span', { class: 'badge ok', title: 'Consolidation in progress' }, 'consolidating') : null,
    count ? h('span', { class: 'badge accent', title: 'Coded segments' }, String(count)) : null,
    h(
      'span',
      { class: 'tree-actions' },
      action('✎', 'Rename document', () => renameDocInteractive(d)),
      action('🗑', 'Delete document', () => deleteDocInteractive(d, count)),
    ),
  );
  setUpRow(row, { type: 'doc', id: d.id });
  return row;
}

/** Selection and dragging: dragging a selected row drags all selected rows. */
function setUpRow(row: HTMLElement, item: TreeItem) {
  const key = keyOf(item);
  row.dataset.key = key;
  selection.bindRow(row, key);
  row.addEventListener('dragstart', (e) => {
    const items = selection.has(key) ? selectedItems() : [item];
    e.dataTransfer?.setData(DND_TYPE, JSON.stringify(items));
  });
}

function makeDropTarget(el: HTMLElement, folderId: string | null) {
  el.addEventListener('dragover', (e) => {
    const types = e.dataTransfer?.types ?? [];
    if (!types.includes(DND_TYPE) && !types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.add('drop');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop');
    const raw = e.dataTransfer?.getData(DND_TYPE);
    if (raw) {
      const items = JSON.parse(raw) as TreeItem[];
      if (items.length === 1) moveItem(items[0], folderId);
      else moveItemsTo(items, folderId);
    }
    else if (e.dataTransfer?.files.length) await addTextFiles([...e.dataTransfer.files], folderId);
  });
}
