// The document list: folders and documents, with drag and drop to move them or add files.

import {
  addTextFiles,
  createFolder,
  deleteDocInteractive,
  deleteFolderInteractive,
  moveItem,
  openDocument,
  renameDocInteractive,
  renameFolderInteractive,
  selectFolder,
  setFolderCollapsed,
} from '../controller/documents';
import { folderContents } from '../model/documents';
import { project, ui } from '../model/state';
import type { Doc, Folder } from '../model/types';
import { byName } from '../model/util';
import { h } from './dom';

const DND_TYPE = 'application/x-bct-item';

export function initTree(container: HTMLElement) {
  // Dropping on empty space in the tree moves things to the top level.
  makeDropTarget(container, null);
}

export function renderTree(container: HTMLElement) {
  const rootRow = h(
    'div',
    {
      class: 'tree-row root' + (ui.selectedFolderId === null ? ' selected' : ''),
      style: { paddingLeft: '8px' },
      onClick: () => selectFolder(null),
    },
    h('span', { class: 'tree-icon' }, '🗂️'),
    h('span', { class: 'tree-name' }, 'All documents'),
    h('span', { class: 'badge' }, String(project.docs.length)),
  );
  makeDropTarget(rootRow, null);
  const rows = [rootRow, ...renderChildren(null, 1)];
  if (!project.docs.length && !project.folders.length) {
    rows.push(h('p', { class: 'muted pad' }, 'Add .txt files with “+ Files” or drop them here.'));
  }
  container.replaceChildren(...rows);
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
  row.addEventListener('dragstart', (e) => e.dataTransfer?.setData(DND_TYPE, JSON.stringify({ type: 'folder', id: f.id })));
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
  row.addEventListener('dragstart', (e) => e.dataTransfer?.setData(DND_TYPE, JSON.stringify({ type: 'doc', id: d.id })));
  return row;
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
    if (raw) moveItem(JSON.parse(raw) as { type: 'doc' | 'folder'; id: string }, folderId);
    else if (e.dataTransfer?.files.length) await addTextFiles([...e.dataTransfer.files], folderId);
  });
}
