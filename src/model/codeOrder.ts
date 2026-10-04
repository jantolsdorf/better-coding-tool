// The custom order of codes: each code has a position among its sibling codes. Kept free of
// other model imports so that loading a project can use it.

import type { Code } from './types';
import { byName } from './util';

/** Sibling order: the custom position, then the name (codes without a position come last). */
export const byOrder = (a: Code, b: Code) => (a.order ?? Infinity) - (b.order ?? Infinity) || byName(a, b);

/**
 * Gives every code a position among its siblings, keeping existing positions and putting codes
 * without one after them, alphabetically (e.g. projects from before custom ordering).
 */
export function ensureCodeOrder(codes: Code[]) {
  const groups = new Map<string | null, Code[]>();
  for (const c of codes) {
    const key = c.parentId ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  for (const list of groups.values()) list.sort(byOrder).forEach((c, i) => (c.order = i));
}
