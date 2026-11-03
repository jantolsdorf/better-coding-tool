// AI coding: which text goes to the language model, what it is asked, and turning its answer
// into suggestions to review. Pure apart from applying the accepted suggestions (one undo step);
// the requests themselves are made by the controller (controller/aiCoding.ts).
//
// The text is sent either as paragraphs (split as in auto-coding) or as whole documents (in
// chunks). Either way the model quotes only the sentences that make the point for a code, and
// the quotes are found in the text again: only those sentences are coded, not the paragraph.

import { paragraphs, type ParagraphBreak } from './autoCode';
import { codeById, codePath } from './codes';
import { getDoc } from './documents';
import { addOrMerge } from './segmentOps';
import { commit, project } from './state';

export type AiSplit =
  | { mode: 'paragraph'; paragraphBreak: ParagraphBreak; separators: string[] }
  | { mode: 'document' };

/** A piece of text sent to the model: a paragraph, or a chunk of a document. */
export interface AiUnit {
  docId: string;
  start: number;
  end: number;
}

export interface AiJob {
  codeIds: string[];
  docIds: string[];
  split: AiSplit;
  /** How many coded examples per code are shared (0 = none). */
  examplesPerCode: number;
  /** Characters of text per request at most. */
  batchChars: number;
}

export interface AiSuggestion {
  key: string;
  docId: string;
  /** The passage to code: the sentences the model quoted. */
  start: number;
  end: number;
  /** The text around it shown when reviewing: the paragraph, or the lines containing the quote. */
  context: [number, number];
  codeId: string;
  reason: string;
  status: 'open' | 'accepted' | 'rejected';
  /** Your coding already has this code on (at least) this passage. */
  alreadyCoded: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

const EXAMPLE_CHARS = 400;

// ---------- the text sent ----------

/** A document cut into chunks of at most `max` characters, at line breaks where possible. */
function chunks(docId: string, text: string, max: number): AiUnit[] {
  const out: AiUnit[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + max);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > start + max / 2) end = nl + 1;
    }
    if (text.slice(start, end).trim()) out.push({ docId, start, end });
    start = end;
  }
  return out;
}

/** The units of the chosen documents, in document order. */
export function aiUnits(job: Pick<AiJob, 'docIds' | 'split' | 'batchChars'>): AiUnit[] {
  return job.docIds.flatMap((id) => {
    const doc = getDoc(id);
    if (!doc) return [];
    const { split } = job;
    if (split.mode === 'document') return chunks(doc.id, doc.content, job.batchChars);
    return paragraphs(doc.content, split).map(([start, end]) => ({ docId: doc.id, start, end }));
  });
}

/** Units grouped into requests: paragraphs up to `batchChars` together, document chunks one each. */
export function aiBatches(job: AiJob): AiUnit[][] {
  const units = aiUnits(job);
  if (job.split.mode === 'document') return units.map((u) => [u]);
  const batches: AiUnit[][] = [];
  let current: AiUnit[] = [];
  let size = 0;
  for (const u of units) {
    const len = u.end - u.start;
    if (current.length && size + len > job.batchChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(u);
    size += len;
  }
  if (current.length) batches.push(current);
  return batches;
}

/** How much text a job sends: characters of text (without the codebook and instructions). */
export const textSize = (batches: AiUnit[][]) => batches.flat().reduce((n, u) => n + u.end - u.start, 0);

// ---------- the prompt ----------

/** Codes are given to the model by short ids ("C1"), so names that look alike cannot be confused. */
const codeRef = (i: number) => `C${i + 1}`;

function examplesOf(codeId: string, n: number): string[] {
  if (!n) return [];
  return project.segments
    .filter((s) => s.codeId === codeId && getDoc(s.docId))
    .slice(0, n)
    .map((s) => (s.text.length > EXAMPLE_CHARS ? `${s.text.slice(0, EXAMPLE_CHARS)}…` : s.text).replace(/\s+/g, ' ').trim());
}

/** The codebook part of the prompt: each code's id, path, description and examples. */
export function codebookText(job: Pick<AiJob, 'codeIds' | 'examplesPerCode'>): string {
  return job.codeIds
    .map((id, i) => {
      const c = codeById(id);
      if (!c) return '';
      const lines = [`${codeRef(i)}: ${codePath(c)}`];
      if (c.description?.trim()) lines.push(`  Definition: ${c.description.trim().replace(/\s+/g, ' ')}`);
      for (const ex of examplesOf(id, job.examplesPerCode)) lines.push(`  Example: "${ex}"`);
      return lines.join('\n');
    })
    .join('\n');
}

/** The wording of the prompt; editable in the AI settings. The answer formats below are fixed. */
export interface AiPrompts {
  /** The system message. */
  system: string;
  /** What to do with paragraphs (each coded as a whole). */
  paragraphTask: string;
  /** What to do with a whole document (quoting the passages). */
  documentTask: string;
}

export const DEFAULT_PROMPTS: AiPrompts = {
  system: [
    'You assist a qualitative researcher with coding interview transcripts and other texts.',
    'Apply only codes from the given codebook, and only where a code clearly fits according to its name, definition and examples.',
    'It is fine to apply no code at all. Several codes may fit the same text.',
    'Answer with JSON only, exactly in the requested format.',
  ].join(' '),
  paragraphTask:
    'Decide for each passage which codes apply. For each code that applies, quote only the sentence or sentences of the passage ' +
    'that make the point, exactly as they appear (verbatim); quote the whole passage only if all of it is needed. ' +
    'The same code may be given several times for different parts of a passage.',
  documentTask:
    'Find the passages of the text that a code fits. Quote each passage exactly as it appears in the text (verbatim): ' +
    'only the sentence or sentences that make the point, not more.',
};

/** The answer formats, always added after the task: the tool reads the answer in this form. */
export const ANSWER_FORMATS = {
  paragraph:
    'Answer as {"results":[{"passage":"P1","codes":[{"code":"C1","quote":"exact sentence(s) from P1","reason":"one short sentence"}]}]}. Leave out passages that no code fits.',
  document: 'Answer as {"results":[{"code":"C1","quote":"exact text","reason":"one short sentence"}]}. Use an empty list if no code fits.',
};

/** A prompt text, or its default if left empty. */
const orDefault = (prompts: Partial<AiPrompts>, key: keyof AiPrompts) => prompts[key]?.trim() || DEFAULT_PROMPTS[key];

export function buildMessages(job: AiJob, batch: AiUnit[], prompts: Partial<AiPrompts> = DEFAULT_PROMPTS): ChatMessage[] {
  const system: ChatMessage = { role: 'system', content: orDefault(prompts, 'system') };
  const codebook = `Codebook:\n${codebookText(job)}`;
  if (job.split.mode === 'paragraph') {
    const passages = batch
      .map((u, i) => `[P${i + 1}]\n${getDoc(u.docId)!.content.slice(u.start, u.end)}`)
      .join('\n\n');
    return [
      system,
      { role: 'user', content: `${codebook}\n\n${orDefault(prompts, 'paragraphTask')}\n${ANSWER_FORMATS.paragraph}\n\nPassages:\n${passages}` },
    ];
  }
  const u = batch[0];
  return [
    system,
    {
      role: 'user',
      content: `${codebook}\n\n${orDefault(prompts, 'documentTask')}\n${ANSWER_FORMATS.document}\n\nText:\n${getDoc(u.docId)!.content.slice(u.start, u.end)}`,
    },
  ];
}

// ---------- the answer ----------

/** The JSON in a model's answer (also inside a ```json block or surrounded by text). */
function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  try {
    return JSON.parse(body);
  } catch {
    const from = body.indexOf('{');
    const to = body.lastIndexOf('}');
    if (from >= 0 && to > from) return JSON.parse(body.slice(from, to + 1));
    throw new Error('The answer is not JSON.');
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Models often change quotation marks, apostrophes and dashes; these match any of their kind.
const LOOKALIKES = [`'’‘‚`, `"“”„«»`, '-–—'];
const lookalike = (ch: string) => {
  const group = LOOKALIKES.find((g) => g.includes(ch));
  return group ? `[${group.replace('-', '\\-')}]` : escapeRe(ch);
};

/** Where a quote occurs in text[from, to): exactly, or with any whitespace between its words. */
export function locateQuote(text: string, from: number, to: number, quote: string): [number, number] | null {
  const q = quote.trim().replace(/^["“„']|["”']$/g, '').replace(/…$/, '').trim();
  if (!q) return null;
  const part = text.slice(from, to);
  const i = part.indexOf(q);
  if (i >= 0) return [from + i, from + i + q.length];
  const words = q.split(/\s+/).filter(Boolean).map((w) => [...w].map(lookalike).join(''));
  const m = new RegExp(words.join('\\s+'), 'i').exec(part);
  return m ? [from + m.index, from + m.index + m[0].length] : null;
}

const asList = (x: unknown): Record<string, unknown>[] => {
  const list = Array.isArray(x) ? x : x && typeof x === 'object' ? (x as { results?: unknown }).results : undefined;
  return Array.isArray(list) ? list.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
};

/**
 * The suggestions in a model's answer to one request. Unknown codes, passages and quotes that
 * cannot be found in the text are reported as problems instead.
 */
const WORD = /[\p{L}\p{N}_]/u;

/** A range widened to whole words, so a quote that starts or ends inside a word codes the full word. */
function wholeWords(text: string, start: number, end: number): [number, number] {
  while (start > 0 && WORD.test(text[start - 1]) && WORD.test(text[start])) start--;
  while (end < text.length && WORD.test(text[end - 1]) && WORD.test(text[end])) end++;
  return [start, end];
}

/** The lines containing a range, within [from, to). */
function linesAround(text: string, start: number, end: number, from: number, to: number): [number, number] {
  const a = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', end);
  return [Math.max(from, a), Math.min(to, nl < 0 ? text.length : nl)];
}

/**
 * The suggestions in a model's answer to one request: the quoted sentences, found in the text
 * again (in the passage they were quoted from). Unknown codes and passages, and quotes that
 * cannot be found, are reported as problems instead.
 */
export function parseAnswer(job: AiJob, batch: AiUnit[], answer: string): { suggestions: AiSuggestion[]; problems: string[] } {
  const problems: string[] = [];
  const suggestions: AiSuggestion[] = [];
  const codeOf = (ref: unknown) => {
    const n = /^C?(\d+)$/i.exec(String(ref ?? '').trim());
    return n ? job.codeIds[Number(n[1]) - 1] : undefined;
  };
  const add = (u: AiUnit, codeId: string, quote: unknown, reason: unknown, context: (start: number, end: number) => [number, number]) => {
    const doc = getDoc(u.docId)!;
    const quoted = typeof quote === 'string' && quote.trim();
    // Without a quote (e.g. with a changed prompt), a paragraph is coded as a whole.
    const at = quoted ? locateQuote(doc.content, u.start, u.end, quote) : job.split.mode === 'paragraph' ? ([u.start, u.end] as [number, number]) : null;
    if (!at) {
      problems.push(`A quote for “${codeById(codeId)?.name}” was not found in “${doc.name}”: “${String(quote ?? '').slice(0, 80)}”.`);
      return;
    }
    const [start, end] = wholeWords(doc.content, at[0], at[1]);
    suggestions.push({
      key: `${u.docId}:${start}:${end}:${codeId}`,
      docId: u.docId,
      start,
      end,
      context: context(start, end),
      codeId,
      reason: typeof reason === 'string' ? reason.trim() : '',
      status: 'open',
      alreadyCoded: project.segments.some((s) => s.docId === u.docId && s.codeId === codeId && s.start <= start && s.end >= end),
    });
  };
  const unknownCode = (ref: unknown) => problems.push(`The answer uses a code that is not in the codebook (“${String(ref)}”).`);
  const results = asList(parseJson(answer));
  if (job.split.mode === 'paragraph') {
    for (const r of results) {
      const n = /^P?(\d+)$/i.exec(String(r.passage ?? '').trim());
      const u = n ? batch[Number(n[1]) - 1] : undefined;
      if (!u) {
        problems.push(`The answer refers to a passage that was not sent (“${String(r.passage)}”).`);
        continue;
      }
      for (const c of asList(r.codes)) {
        const codeId = codeOf(c.code);
        if (codeId) add(u, codeId, c.quote, c.reason, () => [u.start, u.end]);
        else unknownCode(c.code);
      }
    }
  } else {
    const u = batch[0];
    const text = getDoc(u.docId)!.content;
    for (const r of results) {
      const codeId = codeOf(r.code);
      if (codeId) add(u, codeId, r.quote, r.reason, (start, end) => linesAround(text, start, end, u.start, u.end));
      else unknownCode(r.code);
    }
  }
  // The same code on the same sentences only once.
  const seen = new Set<string>();
  return { suggestions: suggestions.filter((x) => !seen.has(x.key) && seen.add(x.key)), problems };
}

// ---------- applying ----------

/** Codes the accepted suggestions in your coding, as one undo step. */
export function applyAiSuggestions(list: AiSuggestion[]): { added: number; extended: number } {
  const counts = { added: 0, extended: 0 };
  for (const s of list) {
    const doc = getDoc(s.docId);
    if (!doc || !codeById(s.codeId)) continue;
    const res = addOrMerge(project.segments, doc, s.start, s.end, s.codeId, undefined, project.coderName || undefined);
    if (res === 'added') counts.added++;
    else if (res === 'extended') counts.extended++;
  }
  commit();
  return counts;
}
