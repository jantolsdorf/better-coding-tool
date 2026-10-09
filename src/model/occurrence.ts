// Code occurrence: which codes each coder used in a document at all, regardless of where.
// Codes are matched across coders by path (case-insensitive), like in consolidation.

import { codePathParts } from './codes';
import type { TableColumn } from './types';

export interface OccurrenceRow {
  /** The code's path (as the first coder using it names it). */
  path: string[];
  color: string;
  /** Segments with this code in the document, per column (same order as the columns). */
  counts: number[];
  /** Whether every coder used the code in this document. */
  agreed: boolean;
}

/** One row per code used by any of the coders in the document, in path order. */
export function codeOccurrence(docId: string, cols: TableColumn[]): OccurrenceRow[] {
  const rows = new Map<string, OccurrenceRow>();
  cols.forEach((col, i) => {
    const codes = new Map(col.codes.map((c) => [c.id, c]));
    for (const s of col.segments) {
      const code = s.docId === docId ? codes.get(s.codeId) : undefined;
      if (!code) continue;
      const path = codePathParts(code, col.codes);
      const key = path.map((p) => p.trim().toLowerCase()).join('>');
      let row = rows.get(key);
      if (!row) rows.set(key, (row = { path, color: code.color, counts: cols.map(() => 0), agreed: false }));
      row.counts[i]++;
    }
  });
  const out = [...rows.values()];
  for (const r of out) r.agreed = r.counts.every((n) => n > 0);
  return out.sort((a, b) => a.path.join(' > ').localeCompare(b.path.join(' > '), undefined, { sensitivity: 'base', numeric: true }));
}

/** Share of codes (used by anyone) that all coders used; null if no code was used. */
export function occurrenceAgreement(rows: OccurrenceRow[]): number | null {
  return rows.length ? rows.filter((r) => r.agreed).length / rows.length : null;
}
