// Adding coded segments to a list of segments.

import type { Doc, Segment } from './types';
import { now, uid } from './util';

export type AddResult = 'added' | 'extended' | 'contained';

/**
 * Adds a coded segment to `list`. If the same code already covers an overlapping passage,
 * no new segment is created: the existing one is extended to cover both (and any other
 * overlapping segments of that code are folded into it).
 */
export function addOrMerge(list: Segment[], doc: Doc, start: number, end: number, codeId: string, source?: string): AddResult {
  const overlapping = list
    .filter((s) => s.docId === doc.id && s.codeId === codeId && s.start < end && s.end > start)
    .sort((a, b) => a.start - b.start);
  if (!overlapping.length) {
    list.push({ id: uid('s'), docId: doc.id, codeId, start, end, text: doc.content.slice(start, end), createdAt: now(), source });
    return 'added';
  }
  const [keep, ...absorbed] = overlapping;
  const newStart = Math.min(start, keep.start);
  const newEnd = Math.max(end, ...overlapping.map((s) => s.end));
  if (!absorbed.length && newStart === keep.start && newEnd === keep.end) return 'contained';
  keep.start = newStart;
  keep.end = newEnd;
  keep.text = doc.content.slice(newStart, newEnd);
  for (const s of absorbed) list.splice(list.indexOf(s), 1);
  return 'extended';
}
