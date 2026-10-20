// Applying codes to passages of text, and removing coded segments.

import { codeForPath } from './codes';
import { getDoc } from './documents';
import { activeLayer, layerSegments } from './layers';
import { addOrMerge } from './segmentOps';
import { commit, project } from './state';

/** Codes the passage [start, end) of a document with the given code name or path, creating the code if needed. */
export function applyCode(docId: string, start: number, end: number, codeName: string, colorForNew?: string) {
  const doc = getDoc(docId);
  const name = codeName.trim();
  if (!doc || !name) return null;
  const code = codeForPath(name, colorForNew);
  const result = addOrMerge(layerSegments(activeLayer(), docId), doc, start, end, code.id, undefined, project.coderName || undefined);
  commit();
  return { code, result };
}

/** Removes a segment from your coding or the consolidated coding (ids are unique across both). */
export function deleteSegment(id: string) {
  dropSegments([id]);
  commit();
}

/** Removes segments from your coding and the consolidated codings, without recording an undo step (callers commit). */
export function dropSegments(ids: string[]) {
  const gone = new Set(ids);
  project.segments = project.segments.filter((s) => !gone.has(s.id));
  for (const [docId, list] of Object.entries(project.consolidations)) {
    project.consolidations[docId] = list.filter((s) => !gone.has(s.id));
  }
}

/**
 * Moves the boundaries of a segment of your coding or a consolidated coding. If it then
 * overlaps another segment with the same code, the two become one (as when coding).
 */
export function resizeSegment(id: string, start: number, end: number) {
  const list = [project.segments, ...Object.values(project.consolidations)].find((l) => l.some((s) => s.id === id));
  const seg = list?.find((s) => s.id === id);
  const doc = seg && getDoc(seg.docId);
  if (!list || !seg || !doc || end <= start || start < 0 || end > doc.content.length) return;
  seg.start = start;
  seg.end = end;
  for (const other of list.filter((o) => o !== seg && o.docId === seg.docId && o.codeId === seg.codeId && o.start < seg.end && o.end > seg.start)) {
    seg.start = Math.min(seg.start, other.start);
    seg.end = Math.max(seg.end, other.end);
    list.splice(list.indexOf(other), 1);
  }
  seg.text = doc.content.slice(seg.start, seg.end);
  commit();
}
