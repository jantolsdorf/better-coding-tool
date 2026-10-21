// Creating and validating projects (e.g. from files or local storage).

import { ensureCodeOrder } from './codeOrder';
import { now, uid } from './util';
import type { Challenge, Code, Doc, ExternalCoding, Folder, Memo, Project, Segment } from './types';

export function emptyProject(coderName = ''): Project {
  return {
    format: 'bct-project',
    version: 1,
    coderName,
    folders: [],
    docs: [],
    codes: [],
    segments: [],
    memos: [],
    externalCodings: [],
    consolidations: {},
    challenges: [],
  };
}

/** Validates a parsed JSON value and returns it as a Project. Throws on invalid input. */
export function parseProject(data: unknown): Project {
  if (!data || typeof data !== 'object') throw new Error('The file does not contain a project.');
  const d = data as Record<string, unknown>;
  if (d.format !== 'bct-project') throw new Error('This file is not a Better Coding Tool export.');
  const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  // A passage of a document: [start, end) with start < end.
  const validRange = (r: { docId: unknown; start: unknown; end: unknown } | null) =>
    !!r && typeof r.docId === 'string' && Number.isInteger(r.start) && Number.isInteger(r.end) && (r.start as number) >= 0 && (r.end as number) > (r.start as number);
  const validSegment = (s: Segment) => validRange(s);
  const validMemo = (m: Memo) => validRange(m) && typeof m.note === 'string';
  const externalCodings = arr<ExternalCoding>(d.externalCodings).map((x) => ({
    ...x,
    codes: arr<Code>(x.codes),
    segments: arr<Segment>(x.segments).filter(validSegment),
    memos: arr<Memo>(x.memos).filter(validMemo),
  }));
  const codes = arr<Code>(d.codes);
  // Projects from before custom ordering get positions (alphabetical per level).
  ensureCodeOrder(codes);
  for (const x of externalCodings) ensureCodeOrder(x.codes);
  const result: Project = {
    format: 'bct-project',
    version: 1,
    coderName: typeof d.coderName === 'string' ? d.coderName : '',
    folders: arr<Folder>(d.folders),
    docs: arr<Doc>(d.docs).filter((doc) => typeof doc?.content === 'string'),
    codes,
    segments: arr<Segment>(d.segments).filter(validSegment),
    memos: arr<Memo>(d.memos).filter(validMemo),
    externalCodings,
    consolidations: parseConsolidations(d, validSegment),
    myColumnId: typeof d.myColumnId === 'string' ? d.myColumnId : undefined,
    challenges: arr<Challenge>(d.challenges).filter(
      (c) => validRange(c) && typeof c.coderName === 'string' && typeof c.comment === 'string' && Array.isArray(c.codePath),
    ),
  };
  splitByAuthor(result);
  return result;
}

/**
 * Every coder has their own coding. Older projects could hold the work of several coders in
 * one (told apart by author); everything not by the current coder becomes that coder's coding.
 */
function splitByAuthor(p: Project) {
  const me = p.coderName;
  if (!me) return;
  const byAuthor = new Map<string, { segments: Segment[]; memos: Memo[] }>();
  const of = (name: string) => {
    if (!byAuthor.has(name)) byAuthor.set(name, { segments: [], memos: [] });
    return byAuthor.get(name)!;
  };
  p.segments = p.segments.filter((s) => (s.author && s.author !== me ? (of(s.author).segments.push(s), false) : true));
  p.memos = p.memos.filter((m) => (m.author && m.author !== me ? (of(m.author).memos.push(m), false) : true));
  for (const [name, work] of byAuthor) {
    let x = p.externalCodings.find((c) => c.coderName === name);
    if (!x) {
      x = { id: uid('x'), coderName: name, codes: [], segments: [], memos: [], importedAt: now() };
      p.externalCodings.push(x);
    }
    // Their segments use codes of the shared codebook; copy the ones their codebook lacks.
    const known = new Set(x.codes.map((c) => c.id));
    x.codes.push(...p.codes.filter((c) => !known.has(c.id)).map((c) => ({ ...c })));
    x.segments.push(...work.segments);
    x.memos.push(...work.memos);
  }
}

/** Per-document consolidations; older files had one project-wide list, which is split by document. */
function parseConsolidations(d: Record<string, unknown>, valid: (s: Segment) => boolean): Record<string, Segment[]> {
  const out: Record<string, Segment[]> = {};
  if (d.consolidations && typeof d.consolidations === 'object' && !Array.isArray(d.consolidations)) {
    for (const [docId, list] of Object.entries(d.consolidations as Record<string, unknown>)) {
      if (Array.isArray(list)) out[docId] = (list as Segment[]).filter(valid);
    }
  } else if (Array.isArray(d.consolidated)) {
    for (const s of (d.consolidated as Segment[]).filter(valid)) (out[s.docId] ??= []).push(s);
  }
  return out;
}
