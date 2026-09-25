// The coding of other people, imported for comparison.

import { commit, project, ui } from './state';
import { memoColumnKey } from './table';
import type { Doc, Project } from './types';
import { now, uid } from './util';

/** Maps the documents of another project onto local documents with identical text. */
export function matchDocs(theirs: Doc[]): { map: Map<string, string>; missing: Doc[] } {
  const map = new Map<string, string>();
  const missing: Doc[] = [];
  for (const t of theirs) {
    const candidates = project.docs.filter((d) => d.content === t.content);
    const match = candidates.find((d) => d.name === t.name) ?? candidates[0];
    if (match) map.set(t.id, match.id);
    else missing.push(t);
  }
  return { map, missing };
}

/**
 * Adds (or replaces, by coder name) the coding of another person. Their documents are matched by
 * text; unmatched ones are added in a new folder `addMissingTo`, or their coding is skipped.
 */
export function addExternalCoding(src: Project, coderName: string, addMissingTo: string | null) {
  const { map, missing } = matchDocs(src.docs);
  if (addMissingTo && missing.length) {
    const folder = { id: uid('f'), name: addMissingTo, parentId: null };
    project.folders.push(folder);
    for (const t of missing) {
      const id = uid('d');
      project.docs.push({ id, name: t.name, folderId: folder.id, content: t.content, addedAt: now() });
      map.set(t.id, id);
    }
  }
  const segments = src.segments
    .filter((s) => map.has(s.docId))
    .map((s) => ({ ...s, docId: map.get(s.docId)! }));
  // Their own memos (not the ones they imported from others).
  const memos = src.memos
    .filter((m) => map.has(m.docId))
    .map((m) => ({ ...m, docId: map.get(m.docId)! }));
  project.externalCodings = project.externalCodings.filter((x) => x.coderName !== coderName);
  project.externalCodings.push({
    id: uid('x'),
    coderName,
    codes: src.codes.map((c) => ({ ...c })),
    segments,
    memos,
    importedAt: now(),
  });
  commit();
  return { imported: segments.length, memos: memos.length, skipped: src.segments.length - segments.length };
}

export const hasExternalCoder = (name: string) => project.externalCodings.some((x) => x.coderName === name);

export function renameExternal(id: string, name: string) {
  const x = project.externalCodings.find((e) => e.id === id);
  if (x && name.trim()) x.coderName = name.trim();
  commit();
}

export function removeExternal(id: string) {
  project.externalCodings = project.externalCodings.filter((x) => x.id !== id);
  // Forget the view state of the removed coder's column.
  const keys = [id, memoColumnKey(id)];
  ui.hiddenColumns = ui.hiddenColumns.filter((k) => !keys.includes(k));
  ui.columnOrder = ui.columnOrder.filter((k) => !keys.includes(k));
  commit();
}
