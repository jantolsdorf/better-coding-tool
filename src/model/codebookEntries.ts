// The codebook in a portable form, for exporting and importing just the code system.

import { codeForPath, codePathParts, findCodeByPath, nextColor } from './codes';
import { commit, project } from './state';
import type { Code } from './types';
import { now, uid } from './util';

export interface CodebookEntry {
  name: string;
  color: string;
  description?: string;
  /** Names from the top level down to this code (including it). */
  path?: string[];
  /** Name of the parent code (older codebook files, where names were unique). */
  parent?: string | null;
}

/** The codebook in a portable form: codes refer to their position by path. */
export function codebookEntries(codes: Code[] = project.codes): CodebookEntry[] {
  return codes.map((c) => {
    const path = codePathParts(c, codes);
    return { name: c.name, path, color: c.color, description: c.description, parent: path.at(-2) ?? null };
  });
}

/** The path of an entry; older files only name the parent, so follow parent names upwards. */
export function codebookEntryPath(e: CodebookEntry, entries: CodebookEntry[]): string[] {
  if (Array.isArray(e.path) && e.path.length) return e.path.map(String);
  const path = [e.name];
  for (let p = e.parent, d = 0; p && d < 100; d++) {
    path.unshift(p);
    p = entries.find((x) => x.name === p)?.parent;
  }
  return path;
}

/** How many entries already exist in the codebook (same name at the same place). */
export function countExistingEntries(entries: CodebookEntry[]): number {
  const valid = entries.filter((e) => typeof e?.name === 'string');
  return valid.filter((e) => findCodeByPath(codebookEntryPath(e, valid))).length;
}

/**
 * Adds the codes of another codebook, matched by path. Existing codes keep their color and
 * description unless `updateExisting` is set.
 */
export function importCodebook(entries: CodebookEntry[], updateExisting: boolean) {
  let added = 0;
  let updated = 0;
  const valid = entries.filter((e) => typeof e?.name === 'string' && e.name.trim());
  // Parents first, so their colors and descriptions are used when their subcodes are added.
  const withPaths = valid.map((e) => ({ e, path: codebookEntryPath(e, valid) })).sort((a, b) => a.path.length - b.path.length);
  for (const { e, path } of withPaths) {
    const color = /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : nextColor();
    const existing = findCodeByPath(path);
    if (existing) {
      if (updateExisting) {
        existing.color = color;
        existing.description = e.description || existing.description;
        existing.updatedAt = now();
        updated++;
      }
      continue;
    }
    const parent = path.length > 1 ? codeForPath(path.slice(0, -1), color) : null;
    project.codes.push({
      id: uid('c'),
      name: path.at(-1)!.trim(),
      color,
      description: e.description || undefined,
      parentId: parent?.id ?? null,
      updatedAt: now(),
    });
    added++;
  }
  commit();
  return { added, updated };
}
