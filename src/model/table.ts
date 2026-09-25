// The comparison table: which columns are shown next to the text, and in which order.
//
// Columns are the text, coder columns (your codes, the consolidated coding, other coders' codes)
// and memo columns (your memos, other coders' memos). Each can be hidden individually
// (ui.hiddenColumns); the master switches ui.showCodes / ui.showMemos hide all columns of a kind
// on screen, but not in exports.

import { allConsolidated, consolidationOf } from './layers';
import { project, ui } from './state';
import type { ColumnKey, MemoColumn, TableColumn } from './types';

export const CONSOLIDATED_KEY = 'consolidated';
export const MINE_KEY = 'me';
/** The text column, which can be moved among the other columns. */
export const TEXT_KEY = 'text';
/** Your memos (sticky notes). */
export const MEMOS_KEY = 'memos';
/** Another coder's memos. */
export const memoColumnKey = (coderId: string) => `memos:${coderId}`;

const isHidden = (key: ColumnKey) => ui.hiddenColumns.includes(key);

/**
 * The coder columns that are not hidden, in the user's chosen order. The Consolidated column is
 * included when one of `docIds` (by default the open document) is being consolidated.
 */
export function tableColumns(docIds: (string | null)[] = [ui.selectedDocId]): TableColumn[] {
  const cols: TableColumn[] = [
    { key: MINE_KEY, kind: 'mine', name: project.coderName || 'You', codes: project.codes, segments: project.segments },
  ];
  if (docIds.some((id) => consolidationOf(id))) {
    cols.push({ key: CONSOLIDATED_KEY, kind: 'consolidated', name: 'Consolidated', codes: project.codes, segments: allConsolidated() });
  }
  for (const x of project.externalCodings) {
    cols.push({ key: x.id, kind: 'external', name: x.coderName, codes: x.codes, segments: x.segments });
  }
  // Columns not yet in the saved order go to the end, except a new consolidation, which starts next to the text.
  const rank = (k: ColumnKey) => {
    const i = ui.columnOrder.indexOf(k);
    return i !== -1 ? i : k === CONSOLIDATED_KEY ? -1 : Infinity;
  };
  return cols
    .filter((c) => !isHidden(c.key))
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.key) - rank(b.c.key) || a.i - b.i)
    .map((x) => x.c);
}

/** The memo columns that are not hidden and have memos in one of `docIds`. */
export function memoColumns(docIds: (string | null)[] = [ui.selectedDocId]): MemoColumn[] {
  const inDocs = <T extends { docId: string }>(list: T[]) => list.filter((m) => docIds.includes(m.docId));
  const cols: MemoColumn[] = [
    { key: MEMOS_KEY, name: 'Memos', mine: true, memos: inDocs(project.memos) },
    ...project.externalCodings.map((x) => ({ key: memoColumnKey(x.id), name: `${x.coderName} · memos`, mine: false, memos: inDocs(x.memos) })),
  ];
  return cols.filter((c) => c.memos.length && !isHidden(c.key));
}

/**
 * Keys of the columns shown on screen, in display order: the text, the coder columns (if codes
 * are shown) and the memo columns (if memos are shown). By default the text comes first, your
 * memos right after it, and another coder's memos right after their codes.
 */
export function columnKeysInOrder(): ColumnKey[] {
  const keys = ui.showCodes ? tableColumns().map((c) => c.key) : [];
  insertAtSavedPosition(keys, TEXT_KEY, 0);
  if (ui.showMemos) {
    for (const col of memoColumns()) {
      const coderKey = col.mine ? TEXT_KEY : col.key.slice('memos:'.length);
      const after = keys.indexOf(coderKey);
      insertAtSavedPosition(keys, col.key, after === -1 ? keys.length : after + 1);
    }
  }
  return keys;
}

/**
 * Inserts `key` right after the last column that comes before it in the saved order, or at
 * `defaultPos` if it has not been moved yet.
 */
function insertAtSavedPosition(keys: ColumnKey[], key: ColumnKey, defaultPos: number) {
  const savedAt = ui.columnOrder.indexOf(key);
  let pos = defaultPos;
  if (savedAt !== -1) {
    pos = 0;
    keys.forEach((k, i) => {
      const saved = ui.columnOrder.indexOf(k);
      if (saved !== -1 && saved < savedAt) pos = i + 1;
    });
  }
  keys.splice(pos, 0, key);
}

/**
 * The column order after moving `key` (any column, including the text) directly before or after
 * `target`, or null if nothing changes.
 */
export function reorderedColumns(key: ColumnKey, target: ColumnKey, after: boolean): ColumnKey[] | null {
  if (key === target) return null;
  const order = columnKeysInOrder().filter((k) => k !== key);
  const i = order.indexOf(target);
  if (i === -1) return null;
  order.splice(after ? i + 1 : i, 0, key);
  // Keep the positions of hidden columns so they come back where they were.
  return [...order, ...ui.columnOrder.filter((k) => !order.includes(k) && k !== key)];
}

export interface ColumnChoice {
  key: ColumnKey;
  label: string;
  kind: 'codes' | 'memos';
  visible: boolean;
  /** Codes or memos of this column in the open document. */
  count: number;
}

/** Every column that can be shown for the open document, for choosing which ones to show. */
export function availableColumns(): ColumnChoice[] {
  const docId = ui.selectedDocId;
  const count = <T extends { docId: string }>(list: T[]) => list.filter((x) => x.docId === docId).length;
  const choice = (key: ColumnKey, label: string, kind: ColumnChoice['kind'], n: number): ColumnChoice => ({
    key,
    label,
    kind,
    visible: !isHidden(key),
    count: n,
  });
  const me = project.coderName || 'You';
  const out = [choice(MINE_KEY, `${me} — codes`, 'codes', count(project.segments)), choice(MEMOS_KEY, `${me} — memos`, 'memos', count(project.memos))];
  const consolidated = consolidationOf(docId);
  if (consolidated) out.push(choice(CONSOLIDATED_KEY, 'Consolidated', 'codes', consolidated.length));
  for (const x of project.externalCodings) {
    out.push(choice(x.id, `${x.coderName} — codes`, 'codes', count(x.segments)));
    if (x.memos.length) out.push(choice(memoColumnKey(x.id), `${x.coderName} — memos`, 'memos', count(x.memos)));
  }
  return out;
}
