// The comparison table: which coder columns are shown next to the text, and in which order.

import { allConsolidated, consolidationOf } from './layers';
import { project, ui } from './state';
import type { ColumnKey, TableColumn } from './types';

export const CONSOLIDATED_KEY = 'consolidated';
export const MINE_KEY = 'me';
/** The text column, which can be moved among the coder columns. */
export const TEXT_KEY = 'text';

/**
 * The coder columns shown next to the text, in the user's chosen order. The Consolidated column
 * is included when one of `docIds` (by default the open document) is being consolidated.
 */
export function tableColumns(docIds: (string | null)[] = [ui.selectedDocId]): TableColumn[] {
  const cols: TableColumn[] = [
    { key: MINE_KEY, kind: 'mine', name: project.coderName || 'You', codes: project.codes, segments: project.segments },
  ];
  if (docIds.some((id) => consolidationOf(id))) {
    cols.push({ key: CONSOLIDATED_KEY, kind: 'consolidated', name: 'Consolidated', codes: project.codes, segments: allConsolidated() });
  }
  for (const x of project.externalCodings) {
    if (!ui.hiddenExternal.includes(x.id)) {
      cols.push({ key: x.id, kind: 'external', name: x.coderName, codes: x.codes, segments: x.segments });
    }
  }
  // Columns not yet in the saved order go to the end, except a new consolidation, which starts next to the text.
  const rank = (k: ColumnKey) => {
    const i = ui.columnOrder.indexOf(k);
    return i !== -1 ? i : k === CONSOLIDATED_KEY ? -1 : Infinity;
  };
  return cols
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.key) - rank(b.c.key) || a.i - b.i)
    .map((x) => x.c);
}

/** Keys of all visible columns including the text column, in display order (text first by default). */
export function columnKeysInOrder(): ColumnKey[] {
  const keys = tableColumns().map((c) => c.key);
  const textAt = ui.columnOrder.indexOf(TEXT_KEY);
  if (textAt === -1) return [TEXT_KEY, ...keys];
  // Put the text column right after the last column that comes before it in the saved order.
  let pos = 0;
  keys.forEach((k, i) => {
    const saved = ui.columnOrder.indexOf(k);
    if (saved !== -1 && saved < textAt) pos = i + 1;
  });
  keys.splice(pos, 0, TEXT_KEY);
  return keys;
}

/**
 * The column order after moving `key` (a coder column or the text column) directly before or
 * after `target`, or null if nothing changes.
 */
export function reorderedColumns(key: ColumnKey, target: ColumnKey, after: boolean): ColumnKey[] | null {
  if (key === target) return null;
  const order = columnKeysInOrder().filter((k) => k !== key);
  const i = order.indexOf(target);
  if (i === -1) return null;
  order.splice(after ? i + 1 : i, 0, key);
  // Keep the positions of hidden coders so they come back where they were.
  return [...order, ...ui.columnOrder.filter((k) => !order.includes(k) && k !== key)];
}
