// Line numbers of documents. Segments store character offsets; lines are derived from them.

import type { Doc } from './types';

const lineCache = new Map<string, { content: string; starts: number[] }>();

/** Offsets at which each line of the document starts. */
export function lineStartsOf(doc: Doc): number[] {
  const cached = lineCache.get(doc.id);
  if (cached && cached.content === doc.content) return cached.starts;
  const starts = [0];
  for (let i = 0; i < doc.content.length; i++) if (doc.content[i] === '\n') starts.push(i + 1);
  lineCache.set(doc.id, { content: doc.content, starts });
  return starts;
}

/** 0-based index of the line containing offset. */
export function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function lineSpan(doc: Doc, start: number, end: number): [number, number] {
  const starts = lineStartsOf(doc);
  return [lineOf(starts, start) + 1, lineOf(starts, Math.max(start, end - 1)) + 1];
}

export function lineLabel(doc: Doc, start: number, end: number): string {
  const [a, b] = lineSpan(doc, start, end);
  return a === b ? `L${a}` : `L${a}–L${b}`;
}
