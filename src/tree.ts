import {
  addDocs,
  addFolder,
  commitUI,
  deleteDoc,
  deleteFolder,
  folderContents,
  moveDoc,
  moveFolder,
  project,
  renameDoc,
  renameFolder,
  ui,
} from './store';
import type { Doc, Folder } from './types';
import { byName, h, pickFiles, toast } from './util';

const DND_TYPE = 'application/x-bct-item';

export async function addTextFiles(files: File[], folderId: string | null) {
  const txt = files.filter((f) => /\.txt$/i.test(f.name) || f.type === 'text/plain');
  const skipped = files.length - txt.length;
  if (txt.length) {
    const contents = await Promise.all(txt.map(async (f) => ({ name: f.name, content: await f.text() })));
    addDocs(contents, folderId);
    toast(`Added ${txt.length} document${txt.length === 1 ? '' : 's'}.`);
  }
  if (skipped) toast(`Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? 'is' : 'are'} not .txt.`);
}

export async function addFilesUI() {
  const files = await pickFiles('.txt,text/plain', true);
  if (files.length) await addTextFiles(files, ui.selectedFolderId);
}

export function addFolderUI(parentId: string | null = ui.selectedFolderId) {
  const name = prompt('Folder name:');
  if (name?.trim()) addFolder(name, parentId);
}

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
      onClick: () => {
        ui.selectedFolderId = null;
        commitUI();
      },
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

function toggleCollapsed(id: string, collapsed: boolean) {
  ui.collapsed = ui.collapsed.filter((x) => x !== id);
  if (collapsed) ui.collapsed.push(id);
  commitUI();
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
      onClick: () => {
        ui.selectedFolderId = f.id;
        ui.collapsed = ui.collapsed.filter((x) => x !== f.id);
        commitUI();
      },
    },
    h(
      'span',
      {
        class: 'caret',
        onClick: (e: MouseEvent) => {
          e.stopPropagation();
          toggleCollapsed(f.id, !collapsed);
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
      action('＋', 'New subfolder', () => addFolderUI(f.id)),
      action('✎', 'Rename folder', () => {
        const name = prompt('Rename folder:', f.name);
        if (name?.trim()) renameFolder(f.id, name);
      }),
      action('🗑', 'Delete folder', () => {
        const c = folderContents(f.id);
        const what = c.docs.length || c.folders ? ` with ${c.folders} subfolder(s) and ${c.docs.length} document(s) including their coding` : '';
        if (confirm(`Delete folder “${f.name}”${what}?`)) deleteFolder(f.id);
      }),
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
      onClick: () => {
        ui.selectedDocId = d.id;
        ui.selectedFolderId = d.folderId;
        commitUI();
      },
    },
    h('span', { class: 'caret' }),
    h('span', { class: 'tree-icon' }, '📄'),
    h('span', { class: 'tree-name' }, d.name),
    count ? h('span', { class: 'badge accent', title: 'Coded segments' }, String(count)) : null,
    h(
      'span',
      { class: 'tree-actions' },
      action('✎', 'Rename document', () => {
        const name = prompt('Rename document:', d.name);
        if (name?.trim()) renameDoc(d.id, name);
      }),
      action('🗑', 'Delete document', () => {
        if (confirm(`Delete “${d.name}”${count ? ` and its ${count} coded segment(s)` : ''}?`)) deleteDoc(d.id);
      }),
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
    if (raw) {
      const item = JSON.parse(raw) as { type: 'doc' | 'folder'; id: string };
      if (item.type === 'doc') moveDoc(item.id, folderId);
      else if (item.id !== folderId && !moveFolder(item.id, folderId)) toast('A folder cannot be moved into itself.');
    } else if (e.dataTransfer?.files.length) {
      await addTextFiles([...e.dataTransfer.files], folderId);
    }
  });
}
