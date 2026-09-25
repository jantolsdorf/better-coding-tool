// User actions while coding text.

import { applyCode, deleteSegment } from '../model/coding';
import { commitUI, ui } from '../model/state';
import type { UIState } from '../model/types';
import { toast } from '../view/feedback';

export interface Entry {
  /** What the entry creates: a code (the default) or a memo. */
  kind: 'code' | 'memo';
  /** The code name/path or memo text, without the "memo:"/"code:" prefix. */
  text: string;
  /** The typed prefix, e.g. "memo: " (kept when completing a suggestion). */
  prefix: string;
  /** Whether the user asked for help ("?"). */
  help: boolean;
}

/**
 * Interprets what was typed in the code box: "memo: …" creates a memo, "code: …" or anything
 * else a code, and "?" asks for help. The prefixes ignore case and spaces around the colon.
 */
export function parseEntry(input: string): Entry {
  const m = /^\s*(memo|code)\s*:\s*/i.exec(input);
  if (m) return { kind: m[1].toLowerCase() as Entry['kind'], text: input.slice(m[0].length), prefix: m[0], help: false };
  return { kind: 'code', text: input, prefix: '', help: input.trim() === '?' };
}

const IN_VIVO_MAX = 80;

/**
 * The name of an in-vivo code: the participant's own words from the passage, on one line,
 * without surrounding quotes or trailing . , ; : and without ">" (which would start a subcode).
 * Very long passages are shortened.
 */
export function inVivoName(passage: string): string {
  let name = passage
    .replace(/\s+/g, ' ')
    .replace(/[>›]/g, '-')
    .replace(/^[\s"'“”„‘’«»]+/, '')
    .replace(/[\s"'“”„‘’«».,;:]+$/, '');
  if (name.length > IN_VIVO_MAX) name = name.slice(0, IN_VIVO_MAX - 1).trimEnd() + '…';
  return name;
}

/** Whether the code box shows its help section. */
export function setCodeBoxHelp(open: boolean) {
  ui.codeBoxHelp = open;
  commitUI();
}

/** Codes a passage with a typed name or path, and explains when an existing segment was extended instead. */
export function codePassage(docId: string, start: number, end: number, codeNameOrPath: string, colorForNew: string) {
  const res = applyCode(docId, start, end, codeNameOrPath, colorForNew);
  if (res?.result === 'extended') toast(`Extended the existing “${res.code.name}” segment to include this passage.`);
  if (res?.result === 'contained') toast(`This passage is already part of a “${res.code.name}” segment.`);
  return res;
}

export function removeSegment(id: string) {
  deleteSegment(id);
}

/** While consolidating: whether new codes go into your coding or the consolidated one. */
export function setCodeTarget(target: UIState['codeTarget']) {
  ui.codeTarget = target;
  commitUI();
}
