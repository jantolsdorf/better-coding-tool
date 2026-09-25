// User actions on documents and folders.

import {
  addDocs,
  addFolder,
  deleteDoc,
  deleteFolder,
  folderContents,
  moveDoc,
  moveFolder,
  renameDoc,
  renameFolder,
} from '../model/documents';
import { SAMPLE_NAME, SAMPLE_TEXT } from '../model/sample';
import { commitUI, ui } from '../model/state';
import type { Doc, Folder } from '../model/types';
import { ask, confirmAction, toast } from '../view/feedback';
import { pickFiles } from '../view/files';

const expand = (folderId: string | null) => {
  if (folderId) ui.collapsed = ui.collapsed.filter((id) => id !== folderId);
};

/** Adds documents to a folder, showing it and opening the first document if none is open. */
function addDocuments(files: { name: string; content: string }[], folderId: string | null) {
  expand(folderId);
  const docs = addDocs(files, folderId);
  if (!ui.selectedDocId && docs.length) {
    ui.selectedDocId = docs[0].id;
    commitUI();
  }
  return docs;
}

/** Adds the .txt files among `files` (e.g. dropped on the document list) to a folder. */
export async function addTextFiles(files: File[], folderId: string | null) {
  const txt = files.filter((f) => /\.txt$/i.test(f.name) || f.type === 'text/plain');
  const skipped = files.length - txt.length;
  if (txt.length) {
    const contents = await Promise.all(txt.map(async (f) => ({ name: f.name, content: await f.text() })));
    addDocuments(contents, folderId);
    toast(`Added ${txt.length} document${txt.length === 1 ? '' : 's'}.`);
  }
  if (skipped) toast(`Skipped ${skipped} file${skipped === 1 ? '' : 's'} that ${skipped === 1 ? 'is' : 'are'} not .txt.`);
}

/** Lets the user choose .txt files and adds them to the selected folder. */
export async function addFilesFromPicker() {
  const files = await pickFiles('.txt,text/plain', true);
  if (files.length) await addTextFiles(files, ui.selectedFolderId);
}

export function addSampleDocument() {
  addDocuments([{ name: SAMPLE_NAME, content: SAMPLE_TEXT }], ui.selectedFolderId);
}

export function createFolder(parentId: string | null = ui.selectedFolderId) {
  const name = ask('Folder name:');
  if (!name?.trim()) return;
  expand(parentId);
  addFolder(name, parentId);
}

export function renameFolderInteractive(f: Folder) {
  const name = ask('Rename folder:', f.name);
  if (name?.trim()) renameFolder(f.id, name);
}

export function deleteFolderInteractive(f: Folder) {
  const c = folderContents(f.id);
  const what = c.docs.length || c.folders ? ` with ${c.folders} subfolder(s) and ${c.docs.length} document(s) including their coding` : '';
  if (confirmAction(`Delete folder “${f.name}”${what}?`)) deleteFolder(f.id);
}

export function renameDocInteractive(d: Doc) {
  const name = ask('Rename document:', d.name);
  if (name?.trim()) renameDoc(d.id, name);
}

export function deleteDocInteractive(d: Doc, codedSegments: number) {
  if (confirmAction(`Delete “${d.name}”${codedSegments ? ` and its ${codedSegments} coded segment(s)` : ''}?`)) deleteDoc(d.id);
}

/** Moves a dragged document or folder into a folder (null = top level). */
export function moveItem(item: { type: 'doc' | 'folder'; id: string }, folderId: string | null) {
  if (item.type === 'doc') moveDoc(item.id, folderId);
  else if (item.id !== folderId && !moveFolder(item.id, folderId)) toast('A folder cannot be moved into itself.');
}

export function openDocument(d: Doc) {
  ui.selectedDocId = d.id;
  ui.selectedFolderId = d.folderId;
  commitUI();
}

/** Selects the folder new files and folders go into (null = top level), and expands it. */
export function selectFolder(folderId: string | null) {
  ui.selectedFolderId = folderId;
  expand(folderId);
  commitUI();
}

export function setFolderCollapsed(folderId: string, collapsed: boolean) {
  ui.collapsed = ui.collapsed.filter((x) => x !== folderId);
  if (collapsed) ui.collapsed.push(folderId);
  commitUI();
}
