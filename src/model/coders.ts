// The codings of the other coders (imported, or other coders of this project), and importing
// codings: as new coders, merged into a coder of the same name, or replacing their coding.

import { commit, project, ui } from './state';
import { memoColumnKey } from './table';
import { codeForPath, codeInCodebook, codePathParts } from './codes';
import { getDoc } from './documents';
import { addOrMerge } from './segmentOps';
import type { Code, Doc, ExternalCoding, Memo, Project, Segment } from './types';
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

/** One coder's coding: their codebook, coded segments and memos (in their own document ids). */
export interface CodingData {
  coderName: string;
  codes: Code[];
  segments: Segment[];
  memos: Memo[];
}

/** A coding to add to: yours (codes go into your codebook) or another coder's. */
type Target = { codes: Code[]; segments: Segment[]; memos: Memo[]; mine: boolean };

/**
 * Maps documents of another project onto this project's (identical text). Unmatched ones are
 * added to a new folder `addMissingTo` (only those in `needed`), or left out. Does not commit.
 */
function mapDocuments(theirs: Doc[], addMissingTo: string | null, needed: Set<string>): Map<string, string> {
  const { map, missing } = matchDocs(theirs);
  const toAdd = missing.filter((d) => needed.has(d.id));
  if (addMissingTo && toAdd.length) {
    const folder = { id: uid('f'), name: addMissingTo, parentId: null };
    project.folders.push(folder);
    for (const t of toAdd) {
      const id = uid('d');
      project.docs.push({ id, name: t.name, folderId: folder.id, content: t.content, addedAt: now() });
      map.set(t.id, id);
    }
  }
  return map;
}

/**
 * Adds a coding to a target coding: codes are matched by path (missing ones are created),
 * overlapping segments with the same code are combined, and identical memos are not repeated.
 * Does not commit.
 */
export function mergeCodingInto(target: Target, src: CodingData, docMap: (docId: string) => string | undefined, author?: string) {
  const codes = new Map(src.codes.map((c) => [c.id, c]));
  for (const s of src.segments) {
    const docId = docMap(s.docId);
    const doc = docId ? getDoc(docId) : undefined;
    const code = codes.get(s.codeId);
    if (!doc || !code || s.end > doc.content.length) continue;
    const path = codePathParts(code, src.codes);
    const into = target.mine ? codeForPath(path, code.color) : codeInCodebook(target.codes, path, code.color);
    addOrMerge(target.segments, doc, s.start, s.end, into.id, s.source, author ?? s.author);
  }
  for (const m of src.memos) {
    const docId = docMap(m.docId);
    if (!docId || !getDoc(docId)) continue;
    const same = target.memos.some((x) => x.docId === docId && x.start === m.start && x.end === m.end && x.note === m.note);
    if (!same) target.memos.push({ ...m, id: uid('m'), docId, author: author ?? m.author });
  }
}

export type ImportAction = 'add' | 'merge' | 'replace' | 'skip';

export interface CoderImport {
  coding: CodingData;
  /** The name it gets here; if a coder (or you) already has this name, `action` says what happens. */
  name: string;
  action: ImportAction;
}

/** Whether a coder of this name exists here: you, or another coder. */
export const coderExists = (name: string) => name === project.coderName || project.externalCodings.some((x) => x.coderName === name);

/**
 * Imports the codings of another project, each as a new coder, merged into the coder with the
 * same name (possibly you), or replacing that coder's coding. Documents are matched by text;
 * coded documents that are missing here are added to a folder `addMissingTo`, or skipped.
 * Returns what happened per coder.
 */
export function importCodings(theirDocs: Doc[], items: CoderImport[], addMissingTo: string | null) {
  const active = items.filter((i) => i.action !== 'skip');
  const needed = new Set(active.flatMap((i) => [...i.coding.segments, ...i.coding.memos].map((x) => x.docId)));
  const map = mapDocuments(theirDocs, addMissingTo, needed);
  const docMap = (id: string) => map.get(id);
  const results: { name: string; action: ImportAction; segments: number; skipped: number }[] = [];
  for (const item of active) {
    const name = item.name.trim();
    const skipped = item.coding.segments.filter((s) => !map.has(s.docId)).length;
    if (name === project.coderName) {
      // Your own coding: merged with yours, or replacing it.
      if (item.action === 'replace') {
        project.segments = [];
        project.memos = [];
      }
      mergeCodingInto({ codes: project.codes, segments: project.segments, memos: project.memos, mine: true }, item.coding, docMap, name);
    } else {
      let x = project.externalCodings.find((c) => c.coderName === name);
      if (!x || item.action === 'replace') {
        // A new coder (or a fresh start for this one) keeps their own codebook as it is.
        const fresh: ExternalCoding = {
          id: x?.id ?? uid('x'),
          coderName: name,
          codes: item.coding.codes.map((c) => ({ ...c })),
          segments: [],
          memos: [],
          importedAt: now(),
        };
        project.externalCodings = project.externalCodings.filter((c) => c !== x);
        project.externalCodings.push(fresh);
        x = fresh;
      }
      mergeCodingInto({ ...x, mine: false }, item.coding, docMap, name);
      x.importedAt = now();
    }
    results.push({ name, action: item.action, segments: item.coding.segments.length - skipped, skipped });
  }
  commit();
  return results;
}

/** Adds (or replaces, by coder name) the coding of another person (see importCodings). */
export function addExternalCoding(src: Project, coderName: string, addMissingTo: string | null) {
  const [res] = importCodings(src.docs, [{ coding: { ...src, coderName }, name: coderName, action: coderExists(coderName) ? 'replace' : 'add' }], addMissingTo);
  return { imported: res?.segments ?? 0, memos: src.memos.length, skipped: res?.skipped ?? 0 };
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
