// Documents and folders.

import { commit, project, ui } from './state';
import type { Doc, Folder } from './types';
import { byName, now, uid } from './util';

export const getDoc = (id: string | null) => (id ? project.docs.find((d) => d.id === id) : undefined);
export const currentDoc = () => getDoc(ui.selectedDocId) ?? null;

/** Folder names from the top level down to `folderId`. */
export function folderChain(folderId: string | null): string[] {
  const parts: string[] = [];
  let f = project.folders.find((x) => x.id === folderId);
  while (f && parts.length < 100) {
    parts.unshift(f.name);
    const parent = f.parentId;
    f = project.folders.find((x) => x.id === parent);
  }
  return parts;
}

export function folderPath(folderId: string | null): string {
  return folderChain(folderId).join(' / ');
}

/** All documents in the order the document tree shows them (folders first, then by name). */
export function docsInTreeOrder(parentId: string | null = null): Doc[] {
  return [
    ...project.folders
      .filter((f) => f.parentId === parentId)
      .sort(byName)
      .flatMap((f) => docsInTreeOrder(f.id)),
    ...project.docs.filter((d) => d.folderId === parentId).sort(byName),
  ];
}

function descendantFolderIds(id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of project.folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

export function folderContents(id: string): { folders: number; docs: Doc[] } {
  const ids = descendantFolderIds(id);
  return { folders: ids.size - 1, docs: project.docs.filter((d) => d.folderId && ids.has(d.folderId)) };
}

export function normalizeText(t: string): string {
  return t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function addDocs(files: { name: string; content: string }[], folderId: string | null): Doc[] {
  const docs = files.map((f) => ({
    id: uid('d'),
    name: f.name,
    folderId,
    content: normalizeText(f.content),
    addedAt: now(),
  }));
  project.docs.push(...docs);
  commit();
  return docs;
}

export function addFolder(name: string, parentId: string | null): Folder {
  const folder = { id: uid('f'), name: name.trim(), parentId };
  project.folders.push(folder);
  commit();
  return folder;
}

export function renameFolder(id: string, name: string) {
  const f = project.folders.find((x) => x.id === id);
  if (f && name.trim()) f.name = name.trim();
  commit();
}

function removeDocsData(docIds: Set<string>) {
  project.docs = project.docs.filter((d) => !docIds.has(d.id));
  project.segments = project.segments.filter((s) => !docIds.has(s.docId));
  project.memos = project.memos.filter((m) => !docIds.has(m.docId));
  for (const id of docIds) delete project.consolidations[id];
  for (const x of project.externalCodings) {
    x.segments = x.segments.filter((s) => !docIds.has(s.docId));
    x.memos = x.memos.filter((m) => !docIds.has(m.docId));
  }
  if (ui.selectedDocId && docIds.has(ui.selectedDocId)) ui.selectedDocId = null;
}

export function deleteFolder(id: string) {
  const ids = descendantFolderIds(id);
  removeDocsData(new Set(project.docs.filter((d) => d.folderId && ids.has(d.folderId)).map((d) => d.id)));
  project.folders = project.folders.filter((f) => !ids.has(f.id));
  if (ui.selectedFolderId && ids.has(ui.selectedFolderId)) ui.selectedFolderId = null;
  commit();
}

export function renameDoc(id: string, name: string) {
  const d = getDoc(id);
  if (d && name.trim()) d.name = name.trim();
  commit();
}

export function deleteDoc(id: string) {
  removeDocsData(new Set([id]));
  commit();
}

export function moveDoc(id: string, folderId: string | null) {
  const d = getDoc(id);
  if (!d) return;
  d.folderId = folderId;
  commit();
}

/** Returns false if the move would put a folder inside itself. */
export function moveFolder(id: string, parentId: string | null): boolean {
  if (parentId && descendantFolderIds(id).has(parentId)) return false;
  const f = project.folders.find((x) => x.id === id);
  if (!f) return false;
  f.parentId = parentId;
  commit();
  return true;
}

/** Documents inside these folders (and their subfolders). */
export function docsInFolders(folderIds: string[]): Doc[] {
  const ids = new Set(folderIds.flatMap((id) => [...descendantFolderIds(id)]));
  return project.docs.filter((d) => d.folderId && ids.has(d.folderId));
}

/** Whether a document or folder lies inside one of these folders (at any depth). */
function isInside(item: { type: 'doc' | 'folder'; id: string }, folderIds: Set<string>): boolean {
  let parent = item.type === 'doc' ? getDoc(item.id)?.folderId : project.folders.find((f) => f.id === item.id)?.parentId;
  for (let d = 0; parent && d < 100; d++) {
    if (folderIds.has(parent)) return true;
    parent = project.folders.find((f) => f.id === parent)?.parentId;
  }
  return false;
}

/** Deletes documents and folders (with everything in them) in one step. */
export function deleteItems(docIds: string[], folderIds: string[]) {
  const folders = new Set(folderIds.flatMap((id) => [...descendantFolderIds(id)]));
  removeDocsData(new Set([...docIds, ...docsInFolders(folderIds).map((d) => d.id)]));
  project.folders = project.folders.filter((f) => !folders.has(f.id));
  if (ui.selectedFolderId && folders.has(ui.selectedFolderId)) ui.selectedFolderId = null;
  commit();
}

/**
 * Moves documents and folders into a folder (null = top level) in one step. Items inside another
 * moved folder go along with it; a folder cannot move into itself. Returns how many could not move.
 */
export function moveItems(items: { type: 'doc' | 'folder'; id: string }[], folderId: string | null): number {
  const movedFolders = new Set(items.filter((i) => i.type === 'folder').map((i) => i.id));
  let refused = 0;
  for (const item of items) {
    if (isInside(item, movedFolders)) continue;
    if (item.type === 'doc') {
      const d = getDoc(item.id);
      if (d) d.folderId = folderId;
      continue;
    }
    const f = project.folders.find((x) => x.id === item.id);
    if (!f || f.id === folderId) continue;
    if (folderId && descendantFolderIds(f.id).has(folderId)) refused++;
    else f.parentId = folderId;
  }
  commit();
  return refused;
}
