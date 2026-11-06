// Code sets: named groups of codes across the code hierarchy (a code can be in several sets).
// Each change is one undo step.

import { codeById } from './codes';
import { commit, project } from './state';
import type { CodeSet } from './types';
import { byName, uid } from './util';

/** The project's code sets (created on first use). */
export function codeSets(): CodeSet[] {
  return (project.codeSets ??= []);
}

export const codeSetById = (id: string) => codeSets().find((s) => s.id === id);

/** A name no set has yet ("New set", "New set 2", …). */
export function freeSetName(base = 'New set'): string {
  const taken = new Set(codeSets().map((s) => s.name.toLowerCase()));
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
}

/** Creates a set (with codes `codeIds`, if given). */
export function createCodeSet(name: string, codeIds: string[] = []): CodeSet {
  const set: CodeSet = { id: uid('set'), name: name.trim() || freeSetName(), codeIds: [] };
  codeSets().push(set);
  addToSet(set, codeIds);
  commit();
  return set;
}

export function renameCodeSet(id: string, name: string) {
  const set = codeSetById(id);
  if (!set || !name.trim() || set.name === name.trim()) return;
  set.name = name.trim();
  commit();
}

/** Deletes a set (its codes stay in the codebook). */
export function deleteCodeSet(id: string) {
  project.codeSets = codeSets().filter((s) => s.id !== id);
  commit();
}

/** Adds codes to a set; returns how many were not in it yet. */
export function addCodesToSet(id: string, codeIds: string[]): number {
  const set = codeSetById(id);
  if (!set) return 0;
  const added = addToSet(set, codeIds);
  if (added) commit();
  return added;
}

export function removeCodeFromSet(id: string, codeId: string) {
  const set = codeSetById(id);
  if (!set?.codeIds.includes(codeId)) return;
  set.codeIds = set.codeIds.filter((x) => x !== codeId);
  commit();
}

/** The sets a code is in, by name. */
export const setsOfCode = (codeId: string) => codeSets().filter((s) => s.codeIds.includes(codeId)).sort(byName);

function addToSet(set: CodeSet, codeIds: string[]): number {
  const fresh = [...new Set(codeIds)].filter((id) => codeById(id) && !set.codeIds.includes(id));
  set.codeIds.push(...fresh);
  return fresh.length;
}
