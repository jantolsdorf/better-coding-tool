// Creating and validating projects (e.g. from files or local storage).

import type { Code, Doc, ExternalCoding, Folder, Project, Segment } from './types';

export function emptyProject(coderName = ''): Project {
  return {
    format: 'bct-project',
    version: 1,
    coderName,
    folders: [],
    docs: [],
    codes: [],
    segments: [],
    externalCodings: [],
    consolidations: {},
  };
}

/** Validates a parsed JSON value and returns it as a Project. Throws on invalid input. */
export function parseProject(data: unknown): Project {
  if (!data || typeof data !== 'object') throw new Error('The file does not contain a project.');
  const d = data as Record<string, unknown>;
  if (d.format !== 'bct-project') throw new Error('This file is not a Better Coding Tool export.');
  const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  const validSegment = (s: Segment) =>
    s && typeof s.docId === 'string' && Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start;
  const externalCodings = arr<ExternalCoding>(d.externalCodings).map((x) => ({
    ...x,
    codes: arr<Code>(x.codes),
    segments: arr<Segment>(x.segments).filter(validSegment),
  }));
  return {
    format: 'bct-project',
    version: 1,
    coderName: typeof d.coderName === 'string' ? d.coderName : '',
    folders: arr<Folder>(d.folders),
    docs: arr<Doc>(d.docs).filter((doc) => typeof doc?.content === 'string'),
    codes: arr<Code>(d.codes),
    segments: arr<Segment>(d.segments).filter(validSegment),
    externalCodings,
    consolidations: parseConsolidations(d, validSegment),
  };
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
