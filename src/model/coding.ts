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
