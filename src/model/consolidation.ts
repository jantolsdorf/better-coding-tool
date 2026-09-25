// Consolidation happens per document: each document has its own consolidated coding, built by
// accepting segments from every coder. Finishing or discarding it leaves other documents alone.

import { codeForPath, findCodeByPath } from './codes';
import { getDoc } from './documents';
import { consolidationOf } from './layers';
import { addOrMerge } from './segmentOps';
import { commit, project } from './state';
import type { ExternalCoding, Segment } from './types';
import { now, uid } from './util';

export function startConsolidation(docId: string) {
  project.consolidations[docId] = [];
  commit();
}

export function discardConsolidation(docId: string) {
  delete project.consolidations[docId];
  commit();
}

/**
 * Makes a document's consolidated coding your coding of that document. Your previous coding of
 * it is kept under "other coders" (one entry collects all documents) so nothing is lost.
 * Returns that entry, and whether it was newly created.
 */
export function finishConsolidation(docId: string): { keptAs: ExternalCoding; created: boolean } | null {
  const consolidated = consolidationOf(docId);
  if (!consolidated) return null;
  const name = `${project.coderName || 'You'} (before consolidation)`;
  let before = project.externalCodings.find((x) => x.coderName === name);
  const created = !before;
  if (!before) {
    before = { id: uid('x'), coderName: name, codes: [], segments: [], memos: [], importedAt: now() };
    project.externalCodings.push(before);
  }
  // Keep every code the kept segments may refer to, including ones created since last time.
  const known = new Set(before.codes.map((c) => c.id));
  before.codes.push(...project.codes.filter((c) => !known.has(c.id)).map((c) => ({ ...c })));
  before.segments = [...before.segments.filter((s) => s.docId !== docId), ...project.segments.filter((s) => s.docId === docId)];
  before.importedAt = now();
  project.segments = [...project.segments.filter((s) => s.docId !== docId), ...consolidated];
  delete project.consolidations[docId];
  commit();
  return { keptAs: before, created };
}

/** Whether the document's consolidated coding already covers this passage with the code at this path. */
export function isConsolidated(seg: Segment, path: string[]): boolean {
  const code = findCodeByPath(path);
  return !!code && !!consolidationOf(seg.docId)?.some(
    (s) => s.codeId === code.id && s.start <= seg.start && s.end >= seg.end,
  );
}

export interface AcceptItem {
  seg: Segment;
  /** The code's path in the coder's own codebook, matched against yours. */
  path: string[];
  color: string;
  source: string;
}

/** Copies segments of a coder into the consolidated coding, matching codes by path. Returns how many changed it. */
export function acceptIntoConsolidated(items: AcceptItem[]) {
  let changed = 0;
  for (const { seg, path, color, source } of items) {
    const doc = getDoc(seg.docId);
    const list = consolidationOf(seg.docId);
    if (!doc || !list) continue;
    if (addOrMerge(list, doc, seg.start, seg.end, codeForPath(path, color).id, source) !== 'contained') changed++;
  }
  commit();
  return changed;
}
