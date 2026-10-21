// The coders of this project. Every coder has their own, independent coding: the current coder's
// is "yours" (editable; Project.codes, segments and memos), everyone else's is one of the other
// coders (Project.externalCodings), exactly like an imported coding. Switching the coder swaps them.

import { mergeCodingInto, type CodingData } from './coders';
import { commit, project } from './state';
import type { ExternalCoding } from './types';
import { now, uid } from './util';

export interface ProjectCoder {
  name: string;
  segments: number;
  memos: number;
  current: boolean;
}

/** Everyone coding in this project, the current coder first. */
export function projectCoders(): ProjectCoder[] {
  const me: ProjectCoder[] = project.coderName
    ? [{ name: project.coderName, segments: project.segments.length, memos: project.memos.length, current: true }]
    : [];
  const others = project.externalCodings
    .map((x) => ({ name: x.coderName, segments: x.segments.length, memos: x.memos.length, current: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...me, ...others];
}

/** Your coding as one of the other coders (its codebook copied, as it is now). */
function myCodingAsOther(): ExternalCoding {
  return {
    id: project.myColumnId ?? uid('x'),
    coderName: project.coderName,
    codes: project.codes.map((c) => ({ ...c })),
    segments: project.segments,
    memos: project.memos,
    importedAt: now(),
  };
}

const sameDoc = (id: string) => id;

/** Makes another coder's coding yours (their codes go into your codebook by path). Does not commit. */
function takeOver(x: ExternalCoding) {
  project.externalCodings = project.externalCodings.filter((c) => c !== x);
  project.myColumnId = x.id;
  project.segments = [];
  project.memos = [];
  mergeCodingInto({ codes: project.codes, segments: project.segments, memos: project.memos, mine: true }, x, sameDoc, x.coderName);
  project.coderName = x.coderName;
}

/**
 * Switches to another coder: your coding becomes one of the other coders, and theirs (if they
 * have one) becomes yours. A new name starts with an empty coding.
 */
export function switchCoder(name: string) {
  const n = name.trim();
  if (!n || n === project.coderName) return;
  if (project.coderName) project.externalCodings.push(myCodingAsOther());
  const target = project.externalCodings.find((x) => x.coderName === n && x.coderName !== project.coderName);
  if (target) takeOver(target);
  else {
    project.myColumnId = undefined;
    project.segments = [];
    project.memos = [];
    project.coderName = n;
  }
  commit();
}

const codingOf = (name: string): CodingData | undefined =>
  name === project.coderName
    ? { coderName: name, codes: project.codes, segments: project.segments, memos: project.memos }
    : project.externalCodings.find((x) => x.coderName === name);

/**
 * Renames a coder (you or another coder) everywhere. Renaming to the name of an existing coder
 * merges the two codings into one (codes matched by path, overlapping same-code segments combined).
 */
export function renameCoder(from: string, to: string) {
  const n = to.trim();
  if (!n || n === from || !codingOf(from)) return;
  const into = codingOf(n);
  if (!into) {
    // A plain rename.
    if (from === project.coderName) {
      project.coderName = n;
      for (const s of project.segments) if (!s.author || s.author === from) s.author = n;
      for (const m of project.memos) if (!m.author || m.author === from) m.author = n;
    } else {
      const x = project.externalCodings.find((c) => c.coderName === from)!;
      x.coderName = n;
    }
  } else if (n === project.coderName) {
    // Another coder merged into you.
    const x = project.externalCodings.find((c) => c.coderName === from)!;
    project.externalCodings = project.externalCodings.filter((c) => c !== x);
    mergeCodingInto({ codes: project.codes, segments: project.segments, memos: project.memos, mine: true }, x, sameDoc, n);
  } else if (from === project.coderName) {
    // You merged into another coder: you continue as them, with both codings.
    const y = project.externalCodings.find((c) => c.coderName === n)!;
    const mine: CodingData = { coderName: from, codes: project.codes.map((c) => ({ ...c })), segments: project.segments, memos: project.memos };
    takeOver(y);
    mergeCodingInto({ codes: project.codes, segments: project.segments, memos: project.memos, mine: true }, mine, sameDoc, n);
  } else {
    // Two other coders merged.
    const x = project.externalCodings.find((c) => c.coderName === from)!;
    const y = project.externalCodings.find((c) => c.coderName === n)!;
    project.externalCodings = project.externalCodings.filter((c) => c !== x);
    mergeCodingInto({ ...y, mine: false }, x, sameDoc, n);
  }
  // Your challenges of that coder now concern the new name.
  for (const c of project.challenges) if (c.coderName === from) c.coderName = n;
  commit();
}

/** Removes another coder without any codes or memos. */
export function forgetCoder(name: string) {
  project.externalCodings = project.externalCodings.filter((x) => x.coderName !== name || x.segments.length || x.memos.length);
  commit();
}
