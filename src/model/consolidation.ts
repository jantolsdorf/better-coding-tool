// Consolidation happens per document: each document has its own consolidated coding, built by
// accepting segments from every coder. Finishing or discarding it leaves other documents alone.

import { codeForPath, codePathParts, findCodeByPath } from './codes';
import { getDoc } from './documents';
import { consolidationOf } from './layers';
import { lineLabel, lineSpan } from './lines';
import { addOrMerge } from './segmentOps';
import { commit, project } from './state';
import type { Code, Doc, ExternalCoding, Segment, TableColumn } from './types';
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

// ---------- agreement between coders ----------

/**
 * How a segment relates to another coder column: 'match' when that column has the same code on
 * the same lines (on overlapping text), 'boundary' when it has the code on an overlapping passage
 * but on other lines, 'missing' when it does not have the code there at all.
 */
export type Agreement = 'match' | 'boundary' | 'missing';

export interface SegmentAgreement {
  /** The worst relation to any other column: a segment only matches if every column agrees. */
  status: Agreement;
  others: { name: string; status: Agreement; lines?: string; seg?: Segment }[];
}

/** Identifies a segment within a column (coders who imported the same project share segment ids). */
export const segmentKey = (col: TableColumn, s: Segment) => `${col.key}:${s.id}`;

interface Entry {
  seg: Segment;
  code: Code;
  path: string;
  lines: [number, number];
}

/** A column's segments in a document with their code path (case-insensitive) and lines. */
function entriesOf(doc: Doc, col: TableColumn): Entry[] {
  const codes = new Map(col.codes.map((c) => [c.id, c]));
  return col.segments.flatMap((seg) => {
    const code = seg.docId === doc.id ? codes.get(seg.codeId) : undefined;
    if (!code) return [];
    const path = codePathParts(code, col.codes).map((p) => p.trim().toLowerCase()).join('>');
    return [{ seg, code, path, lines: lineSpan(doc, seg.start, seg.end) }];
  });
}

/**
 * Compares the coder columns (at least two) of a document: for every segment, whether all other
 * columns have the same code on the same lines. Keys are `segmentKey`s.
 */
export function compareCodings(doc: Doc, cols: TableColumn[]): Map<string, SegmentAgreement> {
  const out = new Map<string, SegmentAgreement>();
  if (cols.length < 2) return out;
  const entries = cols.map((c) => entriesOf(doc, c));
  cols.forEach((col, i) => {
    for (const e of entries[i]) {
      const others = cols.flatMap((other, j): SegmentAgreement['others'] => {
        if (j === i) return [];
        const same = entries[j].filter((o) => o.path === e.path && o.seg.start < e.seg.end && e.seg.start < o.seg.end);
        const exact = same.find((o) => o.lines[0] === e.lines[0] && o.lines[1] === e.lines[1]);
        if (exact) return [{ name: other.name, status: 'match', seg: exact.seg }];
        if (same.length) return [{ name: other.name, status: 'boundary', lines: lineLabel(doc, same[0].seg.start, same[0].seg.end) }];
        return [{ name: other.name, status: 'missing' }];
      });
      const worst = (a: Agreement) => others.some((o) => o.status === a);
      const status = worst('missing') ? 'missing' : worst('boundary') ? 'boundary' : 'match';
      out.set(segmentKey(col, e.seg), { status, others });
    }
  });
  return out;
}

/**
 * The passages all columns agree on, ready to accept: one item per match, covering the union of
 * the coders' segments.
 */
export function matchingItems(doc: Doc, cols: TableColumn[]): AcceptItem[] {
  const agreement = compareCodings(doc, cols);
  if (!agreement.size) return [];
  const source = cols.map((c) => c.name).join(' + ');
  return entriesOf(doc, cols[0]).flatMap((e) => {
    const a = agreement.get(segmentKey(cols[0], e.seg));
    if (a?.status !== 'match') return [];
    const segs = [e.seg, ...a.others.map((o) => o.seg!)];
    const start = Math.min(...segs.map((s) => s.start));
    const end = Math.max(...segs.map((s) => s.end));
    return [{ seg: { ...e.seg, start, end }, path: codePathParts(e.code, cols[0].codes), color: e.code.color, source }];
  });
}
