// The codebook: codes, their hierarchy, and lookup by path.
//
// Code names are unique among siblings only: "Trust > Coping" and a top-level "Coping" are
// different codes. Codes are therefore looked up by their path from the top level.

import { getDoc } from './documents';
import { layerSegments } from './layers';
import { addOrMerge } from './segmentOps';
import { commit, project } from './state';
import type { Code, Segment } from './types';
import { byName, now, PALETTE, uid } from './util';

export const codeById = (id: string) => project.codes.find((c) => c.id === id);

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The subcode of `parentId` (null = top level) with this name. */
export function findChildCode(parentId: string | null, name: string, codes: Code[] = project.codes): Code | undefined {
  return codes.find((c) => (c.parentId ?? null) === parentId && sameName(c.name, name));
}

/** The code at a path like ["Trust", "Distrust"], or undefined if any level is missing. */
export function findCodeByPath(parts: string[], codes: Code[] = project.codes): Code | undefined {
  let code: Code | undefined;
  for (const name of parts) {
    code = findChildCode(code?.id ?? null, name, codes);
    if (!code) return undefined;
  }
  return code;
}

/** Codes from the top level down to `code`, looked up in `codes` (e.g. another coder's codebook). */
export function codeChain(code: Code, codes: Code[] = project.codes): Code[] {
  const chain = [code];
  for (let c = code, d = 0; c.parentId && d < 100; d++) {
    const parent = codes.find((x) => x.id === c.parentId);
    if (!parent) break;
    chain.unshift(parent);
    c = parent;
  }
  return chain;
}

export const codePathParts = (code: Code, codes: Code[] = project.codes) => codeChain(code, codes).map((c) => c.name);

/** "Parent > Child" path of a code, in the same form as it is typed. */
export function codePath(code: Code, codes: Code[] = project.codes): string {
  return codePathParts(code, codes).join(' > ');
}

/** Splits "Level 1 > Level 2 > …" into its code names (› works too). */
export function splitCodePath(input: string): string[] {
  return input.split(/[>›]/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Whether a code matches a search like "dist" or "trust > dist": the last part must occur in
 * the code's name and the earlier parts, in order, in the names of its parent codes. A trailing
 * ">" ("trust >") matches all subcodes of matching parents.
 */
export function matchesCodeQuery(code: Code, query: string): boolean {
  const parts = query.toLowerCase().split(/[>›]/).map((s) => s.trim());
  if (parts.length > 1 && parts[0] === '') parts.shift();
  const chain = codeChain(code).map((c) => c.name.toLowerCase());
  const last = parts.pop() ?? '';
  if (!chain[chain.length - 1].includes(last)) return false;
  let j = 0;
  for (const part of parts) {
    while (j < chain.length - 1 && !chain[j].includes(part)) j++;
    if (j >= chain.length - 1) return false;
    j++;
  }
  return true;
}

/** Which names of a path do not exist yet at their position (and would be created). */
export function missingInPath(parts: string[]): string[] {
  let code: Code | undefined;
  for (const [i, name] of parts.entries()) {
    code = findChildCode(code?.id ?? null, name);
    // Once a level is missing, everything below it is new as well.
    if (!code) return parts.slice(i);
  }
  return [];
}

export const childCodes = (parentId: string | null) =>
  project.codes.filter((c) => (c.parentId ?? null) === parentId && c.id !== parentId);

/** Codes depth-first in the order the codebook shows them. */
export function codesInTreeOrder(parentId: string | null = null, depth = 0): Code[] {
  if (depth > 100) return [];
  return childCodes(parentId)
    .sort(byName)
    .flatMap((c) => [c, ...codesInTreeOrder(c.id, depth + 1)]);
}

/** Whether code `id` is `rootId` itself or one of its (nested) subcodes. */
export function isCodeInSubtree(id: string, rootId: string): boolean {
  for (let c = codeById(id), depth = 0; c && depth < 100; c = c.parentId ? codeById(c.parentId) : undefined, depth++) {
    if (c.id === rootId) return true;
  }
  return false;
}

export function nextColor(): string {
  const used = new Set(project.codes.map((c) => c.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[project.codes.length % PALETTE.length];
}

/** Segments per code in the active coding (yours, or the consolidated one while consolidating into it). */
export function segmentCounts(): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of layerSegments()) m.set(s.codeId, (m.get(s.codeId) ?? 0) + 1);
  return m;
}

/** When each code was last edited or applied (ISO dates; older projects fall back to their newest segment). */
export function lastEditedByCode(): Map<string, string> {
  const m = new Map(project.codes.map((c) => [c.id, c.updatedAt ?? '']));
  for (const s of project.segments) if (s.createdAt > (m.get(s.codeId) ?? '￿')) m.set(s.codeId, s.createdAt);
  return m;
}

/**
 * The code at a typed name or path like "Trust > Distrust", creating missing codes along the
 * way (a single name means a top-level code). New subcodes take the color of the level 1 code.
 * Does not commit; callers commit once their whole change is done.
 */
export function codeForPath(input: string | string[], colorForNew?: string): Code {
  const parts = typeof input === 'string' ? splitCodePath(input) : input;
  let parentId: string | null = null;
  let rootColor = colorForNew ?? nextColor();
  let code: Code | undefined;
  for (const [i, name] of parts.entries()) {
    code = findChildCode(parentId, name);
    if (!code) {
      code = { id: uid('c'), name: name.trim(), color: rootColor, parentId };
      project.codes.push(code);
    }
    if (i === 0) rootColor = code.color;
    code.updatedAt = now();
    parentId = code.id;
  }
  return code!;
}

/** Creates a code; "Parent > Child" creates it as a subcode (see codeForPath). */
export function createCode(name: string, color = nextColor()): Code {
  const code = codeForPath(name, color);
  commit();
  return code;
}

export function updateCode(id: string, patch: Partial<Omit<Code, 'id'>>) {
  const c = codeById(id);
  if (!c) return;
  Object.assign(c, patch, { updatedAt: now() });
  commit();
}

/** Deletes a code and its segments; its subcodes move up to the deleted code's parent. */
export function deleteCode(id: string) {
  const code = codeById(id);
  for (const c of project.codes) if (c.parentId === id) c.parentId = code?.parentId ?? null;
  project.codes = project.codes.filter((c) => c.id !== id);
  project.segments = project.segments.filter((s) => s.codeId !== id);
  for (const [docId, list] of Object.entries(project.consolidations)) {
    project.consolidations[docId] = list.filter((s) => s.codeId !== id);
  }
  commit();
}

function mergeIn(list: Segment[], fromId: string, intoId: string) {
  for (const s of list.filter((x) => x.codeId === fromId)) {
    list.splice(list.indexOf(s), 1);
    const doc = getDoc(s.docId);
    if (doc) addOrMerge(list, doc, s.start, s.end, intoId, s.source);
  }
}

/** Reassigns all segments and subcodes of `fromId` to `intoId` and removes `fromId`. */
export function mergeCode(fromId: string, intoId: string) {
  const from = codeById(fromId);
  if (!from || fromId === intoId) return;
  mergeIn(project.segments, fromId, intoId);
  for (const list of Object.values(project.consolidations)) mergeIn(list, fromId, intoId);
  for (const c of project.codes) {
    // If a code is merged into its own subcode, that subcode takes the merged code's place.
    if (c.parentId === fromId) c.parentId = c.id === intoId ? (from.parentId ?? null) : intoId;
  }
  project.codes = project.codes.filter((c) => c.id !== fromId);
  const into = codeById(intoId);
  if (into) into.updatedAt = now();
  commit();
}

/** A code and all its (nested) subcodes. */
export const subtreeOf = (id: string) => project.codes.filter((c) => isCodeInSubtree(c.id, id));

/** Gives a code and all its subcodes one color. */
export function setSubtreeColor(id: string, color: string) {
  for (const c of subtreeOf(id)) {
    c.color = color;
    c.updatedAt = now();
  }
  commit();
}

/**
 * Makes `id` a subcode of `parentId` (null = top level). Refuses to create cycles, and to
 * create two codes with the same name under one parent (those should be merged instead).
 * With `adoptParentColor`, the code and its subcodes take the new parent's color.
 */
export function setCodeParent(id: string, parentId: string | null, { adoptParentColor = false } = {}): 'ok' | 'cycle' | 'duplicate' {
  const code = codeById(id);
  if (!code || (parentId && isCodeInSubtree(parentId, id))) return 'cycle';
  const clash = findChildCode(parentId, code.name);
  if (clash && clash.id !== id) return 'duplicate';
  code.parentId = parentId;
  code.updatedAt = now();
  const parent = parentId ? codeById(parentId) : undefined;
  if (adoptParentColor && parent) for (const c of subtreeOf(id)) c.color = parent.color;
  commit();
  return 'ok';
}
