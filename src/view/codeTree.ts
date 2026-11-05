// Codes as a tree for lists that search codes (the code box when coding, the code picker): the
// codes matching a search, as the code box finds them (by name, or by path "trust > dist"), with
// their parents for context, in the codebook's order, each with the tree's lines before it:
//
//   Parent
//   ├─ Code
//   │  └─ Code
//   └─ Code

import './codeTree.css';
import { byOrder } from '../model/codeOrder';
import { childCodes, codeById, codeChain, codePath, isCodeInSubtree, matchesCodeQuery } from '../model/codes';
import { ui } from '../model/state';
import type { Code } from '../model/types';
import { byName } from '../model/util';
import { h } from './dom';

export interface TreeRow {
  code: Code;
  /** The tree's lines before the name (│ ├─ └─). */
  prefix: string;
  /** Matches the search (false for parents shown for context, and when nothing is searched). */
  match: boolean;
}

/** Codes depth-first, siblings in the codebook's order (by name, or the custom order). */
function treeOrder(parentId: string | null = null, depth = 0): Code[] {
  if (depth > 100) return [];
  return childCodes(parentId)
    .sort(ui.codeSort === 'name' ? byName : byOrder)
    .flatMap((c) => [c, ...treeOrder(c.id, depth + 1)]);
}

/**
 * The rows for a search (all codes when nothing is searched): the matches and their parents,
 * and with `withSubcodes` also all subcodes of the matches.
 */
export function codeTreeRows(query: string, { withSubcodes = false } = {}): TreeRow[] {
  const q = query.trim();
  const all = treeOrder();
  const matched = new Set(all.filter((c) => !q || matchesCodeQuery(c, q)).map((c) => c.id));
  const shown = new Set<string>();
  for (const id of matched) for (const c of codeChain(codeById(id)!)) shown.add(c.id);
  if (withSubcodes && q) for (const c of all) if ([...matched].some((m) => isCodeInSubtree(c.id, m))) shown.add(c.id);
  const visible = all.filter((c) => shown.has(c.id));
  // The tree's lines: a code is the last of its siblings among the codes shown.
  const lastChild = new Map<string | null, string>();
  for (const c of visible) lastChild.set(c.parentId ?? null, c.id);
  const isLast = (c: Code) => lastChild.get(c.parentId ?? null) === c.id;
  const prefix = (c: Code) => {
    const chain = codeChain(c);
    return chain
      .slice(1)
      .map((x, i) => (i === chain.length - 2 ? (isLast(x) ? '└─ ' : '├─ ') : isLast(x) ? '   ' : '│  '))
      .join('');
  };
  return visible.map((c) => ({ code: c, prefix: prefix(c), match: !!q && matched.has(c.id) }));
}

/** A row's class for a list: a match, or a parent shown for context while searching. */
export const treeRowClass = (row: TreeRow, query: string) => (row.match ? 'tree-match' : query.trim() ? 'tree-context' : '');

/** A code's color as a swatch: the color goes in as --code-color, its use is in codeTree.css. */
function swatch(color: string): HTMLElement {
  const el = h('span', { class: 'swatch code-tree-swatch' });
  el.style.setProperty('--code-color', color);
  return el;
}

/** A row's content: the tree's lines, the code's color and name, and (if given) its number of coded segments. */
export function treeRowContent(row: TreeRow, count?: number): (HTMLElement | null)[] {
  return [
    h('span', { class: 'code-tree-lines', 'aria-hidden': 'true' }, row.prefix),
    swatch(row.code.color),
    h('span', { class: 'code-tree-name', title: codePath(row.code) }, row.code.name),
    count === undefined ? null : h('span', { class: 'code-tree-count muted', title: `${count} coded segment${count === 1 ? '' : 's'}` }, String(count)),
  ];
}
