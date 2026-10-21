// Auto-coding: coding every occurrence of words or phrases (or the paragraphs containing them)
// in chosen documents with one code. Finding the passages is pure and is also used for the
// preview; applying them changes your coding in one undo step.

import { codeForPath, splitCodePath } from './codes';
import { getDoc } from './documents';
import { addOrMerge } from './segmentOps';
import { commit, project } from './state';
import type { Doc } from './types';

/** How the paragraphs around a match are found. */
export type ParagraphBreak = 'line' | 'blank' | 'custom';

export interface AutoCodeOptions {
  /** Words or phrases to look for; * stands for any letters within a word ("password*"). */
  phrases: string[];
  matchCase: boolean;
  /** Only whole words (a phrase "trust" does not match "distrust" or "trusted"). */
  wholeWords: boolean;
  /** Code each occurrence, or the paragraph containing it. */
  scope: 'occurrence' | 'paragraph';
  /** For paragraphs: they end at every line break, at empty lines, or at custom separators. */
  paragraphBreak: ParagraphBreak;
  /** Custom separators (e.g. "Interviewer:"); a paragraph ends where one begins. */
  separators: string[];
}

export interface Passage {
  docId: string;
  start: number;
  end: number;
}

/** The phrases as entered: one per line, trimmed, without empty ones and duplicates. */
export function parsePhrases(text: string): string[] {
  return [...new Set(text.split('\n').map((p) => p.trim()).filter(Boolean))];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where the phrases occur in a text, as [start, end) ranges in text order. */
export function findOccurrences(text: string, opts: Pick<AutoCodeOptions, 'phrases' | 'matchCase' | 'wholeWords'>): [number, number][] {
  const out: [number, number][] = [];
  for (const phrase of opts.phrases) {
    // Whitespace in a phrase matches any whitespace (e.g. a line break in the text), and * any
    // letters or digits within a word ("password*" also finds "passwords").
    const body = phrase
      .split(/\s+/)
      .map((word) => word.split('*').map(escape).join('[\\p{L}\\p{N}_]*'))
      .join('\\s+');
    const pattern = opts.wholeWords ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
    const re = new RegExp(pattern, `gu${opts.matchCase ? '' : 'i'}`);
    for (const m of text.matchAll(re)) if (m[0].length) out.push([m.index!, m.index! + m[0].length]);
  }
  return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** The paragraphs of a text as [start, end) ranges (without the separators and surrounding whitespace). */
export function paragraphs(text: string, opts: Pick<AutoCodeOptions, 'paragraphBreak' | 'separators'>): [number, number][] {
  // Positions where a paragraph ends and where the next one begins.
  const cuts: [number, number][] = [];
  if (opts.paragraphBreak === 'line') {
    for (const m of text.matchAll(/\n/g)) cuts.push([m.index!, m.index! + 1]);
  } else if (opts.paragraphBreak === 'blank') {
    for (const m of text.matchAll(/\n[ \t]*\n\s*/g)) cuts.push([m.index!, m.index! + m[0].length]);
  } else {
    // A custom separator starts a new paragraph (e.g. the next speaker), so it belongs to it.
    for (const sep of opts.separators.filter(Boolean)) {
      for (const m of text.matchAll(new RegExp(escape(sep), 'g'))) cuts.push([m.index!, m.index!]);
    }
  }
  cuts.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let from = 0;
  for (const [end, next] of [...cuts, [text.length, text.length] as [number, number]]) {
    let a = from;
    let b = end;
    while (a < b && /\s/.test(text[a])) a++;
    while (b > a && /\s/.test(text[b - 1])) b--;
    if (b > a) out.push([a, b]);
    from = Math.max(from, next);
  }
  return out;
}

/** The passages auto-coding would code in one document: occurrences, or their paragraphs. */
export function passagesIn(doc: Doc, opts: AutoCodeOptions): Passage[] {
  const hits = findOccurrences(doc.content, opts);
  if (opts.scope === 'occurrence') return hits.map(([start, end]) => ({ docId: doc.id, start, end }));
  const paras = paragraphs(doc.content, opts);
  const chosen = new Map<number, [number, number]>();
  for (const [s, e] of hits) {
    const p = paras.find(([a, b]) => s < b && e > a);
    if (p) chosen.set(p[0], p);
  }
  return [...chosen.values()].sort((a, b) => a[0] - b[0]).map(([start, end]) => ({ docId: doc.id, start, end }));
}

export interface AutoCodePreview {
  /** Every phrase occurrence in the chosen documents. */
  matches: number;
  passages: Passage[];
  /** Documents with at least one passage. */
  docs: number;
}

export function previewAutoCode(docIds: string[], opts: AutoCodeOptions): AutoCodePreview {
  let matches = 0;
  const passages: Passage[] = [];
  let docs = 0;
  for (const id of docIds) {
    const doc = getDoc(id);
    if (!doc) continue;
    matches += findOccurrences(doc.content, opts).length;
    const found = passagesIn(doc, opts);
    if (found.length) docs++;
    passages.push(...found);
  }
  return { matches, passages, docs };
}

/**
 * Codes the passages in your coding with the code at `codePath` (created with `color` if new).
 * Passages already coded with it are extended or left as they are. Returns how many segments
 * were added or extended.
 */
export function applyAutoCode(docIds: string[], opts: AutoCodeOptions, codePath: string, color: string): { added: number; extended: number } {
  const counts = { added: 0, extended: 0 };
  const parts = splitCodePath(codePath);
  if (!parts.length) return counts;
  const code = codeForPath(parts, color);
  for (const p of previewAutoCode(docIds, opts).passages) {
    const doc = getDoc(p.docId)!;
    const res = addOrMerge(project.segments, doc, p.start, p.end, code.id, undefined, project.coderName || undefined);
    if (res === 'added') counts.added++;
    else if (res === 'extended') counts.extended++;
  }
  commit();
  return counts;
}
