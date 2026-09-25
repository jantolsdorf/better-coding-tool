// CSV exports: the comparison table (one row per line), all coded segments, and the codebook.

import { codeById, codePath, codesInTreeOrder } from '../codes';
import { folderChain, folderPath, getDoc } from '../documents';
import { allConsolidated } from '../layers';
import { lineSpan } from '../lines';
import { project } from '../state';
import type { Code, Doc, MemoColumn, Segment, TableColumn } from '../types';

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows: (string | number)[][]): string {
  // The BOM makes Excel read the file as UTF-8.
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Path of a document inside the project, e.g. "Wave 1/Students/interview.txt". */
function docPath(doc: Doc): string {
  return [...folderChain(doc.folderId), doc.name].join('/');
}

/**
 * One row per line of text, with one column per memo column and per coder in the given order.
 * Each cell lists the memos or codes (full paths) on that line, separated by semicolons.
 */
export function tableCSV(docs: Doc[], cols: TableColumn[], memoCols: MemoColumn[]): string {
  const rows: (string | number)[][] = [['file', 'line', 'text', ...memoCols.map((c) => c.name), ...cols.map((c) => c.name)]];
  for (const doc of docs) {
    const lines = doc.content.split('\n');
    const memoCells = memoCols.map((col) => {
      const perLine = lines.map(() => [] as string[]);
      for (const m of col.memos.filter((x) => x.docId === doc.id).sort((a, b) => a.start - b.start)) {
        const [a, b] = lineSpan(doc, m.start, m.end);
        for (let i = a; i <= b; i++) perLine[i - 1]?.push(m.note);
      }
      return perLine;
    });
    const cells = cols.map((col) => {
      // Full paths, since the same name can occur under different parent codes.
      const names = new Map(col.codes.map((c) => [c.id, codePath(c, col.codes)]));
      const perLine = lines.map(() => new Set<string>());
      const segs = col.segments.filter((s) => s.docId === doc.id).sort((a, b) => a.start - b.start);
      for (const s of segs) {
        const [a, b] = lineSpan(doc, s.start, s.end);
        const name = names.get(s.codeId) ?? '(unknown code)';
        for (let i = a; i <= b; i++) perLine[i - 1]?.add(name);
      }
      return perLine;
    });
    const file = docPath(doc);
    lines.forEach((text, i) =>
      rows.push([file, i + 1, text, ...memoCells.map((c) => c[i].join('; ')), ...cells.map((c) => [...c[i]].join('; '))]),
    );
  }
  return toCSV(rows);
}

/** One row per coded segment, for all coders, for analysis in a spreadsheet. */
export function segmentsCSV(): string {
  const rows: (string | number)[][] = [
    ['coder', 'folder', 'document', 'code', 'start_line', 'end_line', 'start_offset', 'end_offset', 'text'],
  ];
  const add = (coder: string, codes: Code[], segments: Segment[]) => {
    const byId = new Map(codes.map((c) => [c.id, codePath(c, codes)]));
    for (const s of segments) {
      const doc = getDoc(s.docId);
      if (!doc) continue;
      const [a, b] = lineSpan(doc, s.start, s.end);
      rows.push([coder, folderPath(doc.folderId), doc.name, byId.get(s.codeId) ?? '', a, b, s.start, s.end, s.text]);
    }
  };
  add(project.coderName || 'me', project.codes, project.segments);
  add('Consolidated', project.codes, allConsolidated());
  for (const x of project.externalCodings) add(x.coderName, x.codes, x.segments);
  return toCSV(rows);
}

export function codebookCSV(): string {
  const mine = new Map<string, number>();
  const consolidated = new Map<string, number>();
  for (const s of project.segments) mine.set(s.codeId, (mine.get(s.codeId) ?? 0) + 1);
  for (const s of allConsolidated()) consolidated.set(s.codeId, (consolidated.get(s.codeId) ?? 0) + 1);
  const rows: (string | number)[][] = [['code', 'path', 'parent', 'color', 'description', 'segments', 'consolidated_segments']];
  const parentName = (c: Code) => (c.parentId && codeById(c.parentId)?.name) || '';
  for (const c of codesInTreeOrder()) {
    rows.push([c.name, codePath(c), parentName(c), c.color, c.description ?? '', mine.get(c.id) ?? 0, consolidated.get(c.id) ?? 0]);
  }
  return toCSV(rows);
}
