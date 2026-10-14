// Merging copies of the same document: when coders each coded their own copy of a text (e.g. one
// folder per coder), the copies with identical text are combined into a new copy that holds
// everyone's coding. Each segment and memo keeps its author, unless authors are merged into one.

import { codeForPath, codePathParts, nextOrder } from './codes';
import { removeDocsData } from './documents';
import { addOrMerge } from './segmentOps';
import { commit, project } from './state';
import type { Code, Doc, ExternalCoding, Memo, Segment } from './types';
import { now, uid } from './util';

/** Documents with exactly the same text. */
export interface CopyGroup {
  copies: Doc[];
}

/** Groups the documents whose text is identical (only groups of two or more). */
export function identicalGroups(docs: Doc[]): CopyGroup[] {
  const byText = new Map<string, Doc[]>();
  for (const d of docs) {
    if (!byText.has(d.content)) byText.set(d.content, []);
    byText.get(d.content)!.push(d);
  }
  return [...byText.values()].filter((g) => g.length > 1).map((copies) => ({ copies }));
}

/** Who coded a document: author name → number of coded segments (and memos). */
export interface AuthorWork {
  name: string;
  segments: number;
  memos: number;
}

/** The author of one of your segments or memos (older ones have none: then it is you). */
const ownAuthor = (x: { author?: string }) => x.author || project.coderName || 'You';

/** Everyone who coded or wrote memos in a document, with counts. */
export function authorsOf(docId: string): AuthorWork[] {
  const work = new Map<string, AuthorWork>();
  const get = (name: string) => {
    if (!work.has(name)) work.set(name, { name, segments: 0, memos: 0 });
    return work.get(name)!;
  };
  for (const s of project.segments) if (s.docId === docId) get(ownAuthor(s)).segments++;
  for (const m of project.memos) if (m.docId === docId) get(ownAuthor(m)).memos++;
  for (const x of project.externalCodings) {
    for (const s of x.segments) if (s.docId === docId) get(x.coderName).segments++;
    for (const m of x.memos) if (m.docId === docId) get(x.coderName).memos++;
  }
  return [...work.values()];
}

export interface MergeOptions {
  /** The name each author's work gets in the merged copy; authors with the same name are merged. */
  rename: Map<string, string>;
  /** Which (renamed) author's work becomes your coding; everyone else becomes another coder. */
  me: string;
  /** Where the merged copies go (null = top level), or the name of a new top-level folder for them. */
  folderId: string | null;
  newFolder?: string;
  removeOriginals: boolean;
}

/** The code at a path in a coder's codebook, created (with a position and color) if missing. */
function codeIn(codes: Code[], path: string[], color: string): Code {
  let parentId: string | null = null;
  let code: Code | undefined;
  for (const name of path) {
    code = codes.find((c) => (c.parentId ?? null) === parentId && c.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!code) {
      code = { id: uid('c'), name: name.trim(), color, parentId, order: nextOrder(parentId, codes), updatedAt: now() };
      codes.push(code);
    }
    parentId = code.id;
  }
  return code!;
}

interface Work {
  author: string;
  segs: { seg: Segment; path: string[]; color: string }[];
  memos: Memo[];
}

/** Everyone's coding and memos on one copy, by author. */
function workOn(doc: Doc): Work[] {
  const byAuthor = new Map<string, Work>();
  const get = (author: string) => {
    if (!byAuthor.has(author)) byAuthor.set(author, { author, segs: [], memos: [] });
    return byAuthor.get(author)!;
  };
  const add = (author: string, seg: Segment, codes: Code[]) => {
    const code = codes.find((c) => c.id === seg.codeId);
    if (code) get(author).segs.push({ seg, path: codePathParts(code, codes), color: code.color });
  };
  for (const s of project.segments) if (s.docId === doc.id) add(ownAuthor(s), s, project.codes);
  for (const m of project.memos) if (m.docId === doc.id) get(ownAuthor(m)).memos.push(m);
  for (const x of project.externalCodings) {
    for (const s of x.segments) if (s.docId === doc.id) add(x.coderName, s, x.codes);
    for (const m of x.memos) if (m.docId === doc.id) get(x.coderName).memos.push(m);
  }
  return [...byAuthor.values()];
}

/** The other coder with this name, created if needed. */
function coderNamed(name: string): ExternalCoding {
  let x = project.externalCodings.find((c) => c.coderName === name);
  if (!x) {
    x = { id: uid('x'), coderName: name, codes: [], segments: [], memos: [], importedAt: now() };
    project.externalCodings.push(x);
  }
  return x;
}

/**
 * Creates one new document per group holding the coding and memos of all its copies, by author
 * (renamed or merged as chosen). Codes are matched by path; overlapping passages with the same
 * code from merged authors become one segment. Returns the new documents.
 */
export function mergeCopies(groups: CopyGroup[], opts: MergeOptions): Doc[] {
  const created: Doc[] = [];
  let folderId = opts.folderId;
  if (opts.newFolder?.trim()) {
    folderId = uid('f');
    project.folders.push({ id: folderId, name: opts.newFolder.trim(), parentId: null });
  }
  for (const { copies } of groups) {
    const first = copies[0];
    const doc: Doc = { id: uid('d'), name: first.name, folderId, content: first.content, addedAt: now() };
    project.docs.push(doc);
    created.push(doc);
    for (const copy of copies) {
      for (const work of workOn(copy)) {
        const target = opts.rename.get(work.author)?.trim() || work.author;
        const mine = target === opts.me;
        const coder = mine ? null : coderNamed(target);
        for (const { seg, path, color } of work.segs) {
          const codeId = mine ? codeForPath(path, color).id : codeIn(coder!.codes, path, color).id;
          addOrMerge(mine ? project.segments : coder!.segments, doc, seg.start, seg.end, codeId, undefined, target);
        }
        for (const m of work.memos) {
          const memo: Memo = { ...m, id: uid('m'), docId: doc.id, author: target };
          (mine ? project.memos : coder!.memos).push(memo);
        }
      }
    }
  }
  if (opts.removeOriginals) removeDocsData(new Set(groups.flatMap((g) => g.copies.map((d) => d.id))));
  commit();
  return created;
}
