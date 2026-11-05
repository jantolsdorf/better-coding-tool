// The codebook as a spreadsheet (jspreadsheet CE), shown in place of the text. One row per code
// without subcodes: the codes from the top level down to it in level columns, each followed by
// its description; a parent's cells in consecutive rows look like one merged cell (separate
// rows on hover; can be turned off). Each code's number of coded segments is shown in its name
// cell. Edits in the table are applied to the codebook (model/codebookTable.ts) and every change
// of the codebook is shown in the table. A new name in a parent's cell renames the parent (all
// its rows), or, if picked in the list, moves only that row under a new or another parent.
// A level column can be inserted anywhere: codes after it move one column right, and a name
// typed into its empty cell inserts a code between that row's codes.
//
// Edits that cannot be applied stay in their cells with a flag (the reason on hover) until they
// are fixed; closing the table with flags left asks first. New rows whose parent level is still
// empty, and new rows that are an existing parent code (e.g. its cell pasted), wait as drafts
// until the missing level is filled in. Columns can be minimized (also all parent levels' descriptions at once).
//
// jspreadsheet handles its keyboard events on the main window's document, so the table always
// stays in the main window (even when the text is in a window of its own).

import jspreadsheet from 'jspreadsheet-ce';
import 'jsuites/dist/jsuites.css';
import 'jspreadsheet-ce/dist/jspreadsheet.css';
import 'jspreadsheet-ce/dist/jspreadsheet.themes.css';
import './codebookTable.css';
import { recolorCodesTo } from '../controller/codes';
import { redoChange, undoChange } from '../controller/history';
import { applyRowEdits, codebookRows, reorderAsRows, rowParentCode, type CellChoice, type CodebookRow, type RowEdit } from '../model/codebookTable';
import { codeById, codeChain, deleteCodes, findChildCode, nextColor, nextOrder, reparent, segmentCounts, subtreeOf } from '../model/codes';
import { commit, commitUI, historyRestores, project, projectState, saveUI, subscribe, ui } from '../model/state';
import type { Code } from '../model/types';
import { now, PALETTE, uid } from '../model/util';
import { revealCode } from './codebookList';
import { h, hexToRgba } from './dom';
import { confirmAction, toast } from './feedback';

type Worksheet = jspreadsheet.WorksheetInstance;

/** Cells of a code's row that could not be applied: kept as typed, with the reason. */
interface Issue {
  cells: Map<number, string>;
  message: string;
}

/** A new row that is not a code yet: its cells (name, description per level), and why, if it could not be added. */
interface Draft {
  /** Identifies the row (in the table's order and its hidden id column, as "draft:key"). */
  key: string;
  cells: string[];
  /** Choices made for its level cells (see CellChoice), by level. */
  choices?: (CellChoice | undefined)[];
  message?: string;
  /** The existing parent code the row is (copied or typed into its last level), waiting for a subcode. */
  subcodeOf?: string;
}

interface TableView {
  el: HTMLElement;
  host: HTMLElement;
  ws: Worksheet;
  levels: number;
  /** The code rows as last shown (by column), to know what an edit changed. */
  rows: ShownRow[];
  /**
   * Codes kept in a column other than their level's, by code id: set when a level column is
   * inserted (codes after it move one column right, leaving empty cells before them) and for
   * codes typed into such a column, so rows do not shift while the table is open.
   */
  pinned: Map<string, number>;
  /**
   * Codes created in a deeper level than they are (at the top level, their parents to be typed
   * later): the empty cells before them ask for their parents.
   */
  unparented: Set<string>;
  /** Unapplied edits of code rows, by the row's code id. */
  issues: Map<string, Issue>;
  /**
   * New rows that are not codes yet, anywhere in the table: empty rows inserted between codes, a
   * name typed in a deeper level while a level before it is still empty (its parent is missing),
   * or one that could not be added.
   */
  drafts: Draft[];
  /**
   * The order of the table's rows (code ids of rows, "draft:key" of drafts): the table never
   * reorders rows by itself; new rows go where they were typed (see reconcileOrder).
   */
  order: string[];
  /** Drafts becoming codes, by "draft:key": the names typed, to put their codes' rows in their place. */
  slots: Map<string, string[]>;
  /** A code next to whose rows the next new row goes (one added with "Add code"). */
  anchor: string | null;
  /** Level columns added with "+" (shown even while no code is that deep). */
  minLevels: number;
  /** The cells selected last ([x1, y1, x2, y2]), kept when the table loses the selection (e.g. to the menu bar). */
  selection: [number, number, number, number] | null;
  /** The codes of the rows selected last (kept when the selection is lost by clicking outside, e.g. on the color menu). */
  selectedIds: string[];
  colorBtn: HTMLButtonElement;
  descBtn: HTMLButtonElement;
  stop: () => void;
}

/**
 * A code's row as the table shows it: its codes' names, colors, descriptions and counts by column
 * (empty where a level was inserted before a code), the column of each of its codes, and the row
 * as the codebook has it (by level).
 */
interface ShownRow extends CodebookRow {
  cols: number[];
  base: CodebookRow;
}

let view: TableView | null = null;

/** The table's layout for a state of the project (what the codebook does not keep). */
interface Layout {
  order: string[];
  drafts: Draft[];
  pinned: Map<string, number>;
}
/**
 * The layout for each state of the project seen while the table is open (by projectState), so
 * that undo and redo bring back the rows as they were: a deleted code's row in its place,
 * instead of a new row next to the one left in its place.
 */
const layouts = new Map<string, Layout>();
let seenRestores = 0;
const LAYOUTS_KEPT = 120;

/** The columns of a chain of codes (top level first): a pinned code's column, else the next one. */
function colsOf(ids: string[]): number[] {
  let prev = -1;
  return ids.map((id) => {
    const pin = view?.pinned.get(id);
    prev = pin !== undefined && pin > prev ? pin : prev + 1;
    return prev;
  });
}

/** A codebook row as the table shows it (see ShownRow). */
function shownRow(base: CodebookRow): ShownRow {
  const cols = colsOf(base.ids);
  const width = (cols.at(-1) ?? -1) + 1;
  const spread = <T,>(list: T[], empty: T) => {
    const out = Array.from({ length: width }, () => empty);
    cols.forEach((c, i) => (out[c] = list[i]));
    return out;
  };
  return {
    id: base.id,
    ids: spread(base.ids, ''),
    path: spread(base.path, ''),
    colors: spread(base.colors, ''),
    descriptions: spread(base.descriptions, ''),
    segments: spread(base.segments, 0),
    cols,
    base,
  };
}

const shownRows = () => codebookRows().map(shownRow);

/** The codes shown in a level column. */
function codesInColumn(k: number): Code[] {
  const ids = new Set((view?.rows ?? []).map((r) => r.ids[k]).filter(Boolean));
  return [...ids].flatMap((id) => codeById(id) ?? []);
}

/** The column a code is shown in (-1 if none). */
function columnOf(id: string): number {
  for (const r of view?.rows ?? []) {
    const k = r.ids.indexOf(id);
    if (k >= 0) return k;
  }
  return -1;
}

/**
 * Whether column `k` is an inserted level: some row has an empty cell there before its code (not
 * one before a code whose parents are still to be typed: that cell is a missing parent).
 */
const isInsertedColumn = (k: number) =>
  !!view?.rows.some((r) => k < r.ids.length - 1 && !r.ids[k] && !r.ids.slice(k + 1).some((id) => !!id && view!.unparented.has(id)));

/**
 * A new row's level cells as the codebook's levels: empty cells in an inserted level column
 * are left out (other empty cells before the last name are missing parents). Also the column
 * of each level.
 */
function levelsOfRow<T>(names: string[], values: T[]): { names: string[]; values: T[]; cols: number[] } {
  const last = lastFilled(names);
  const cols = names.map((_, k) => k).filter((k) => k > last || names[k].trim() || !isInsertedColumn(k));
  return { names: cols.map((k) => names[k]), values: cols.map((k) => values[k]), cols };
}
/**
 * Choices for name cells about to change, by "x,y": picked from the suggestions while typing,
 * or set when pasting copied cells. Used (and cleared) when the change arrives.
 */
const choices = new Map<string, CellChoice>();
/** A copied cell's code, as the clipboard carries it with the cell's text (see onClipboardCopy). */
type CellMeta = { id: string | null; color?: string };
/**
 * What is being pasted: the cells with their codes (copied in a codebook table), or just text
 * (from anywhere else, or copied as text only). Set when the paste starts, used by onBeforePaste.
 */
let pasting: { values: string[][]; meta: CellMeta[][]; cut?: string } | 'text' | null = null;
/** Set while "Copy text only" copies: the clipboard then gets just the text. */
let copyTextOnly = false;
/** Set while cutting (⌘X): the copied cells are marked as cut, with this token. */
let cutting = false;
/**
 * The cut not pasted yet: pasting it moves its codes (once; then it pastes like a copy). Cutting
 * changes nothing until then.
 */
let cutToken: string | null = null;
/**
 * How the paste that is starting pastes copied codes under another parent: as identical copies
 * (with their coded segments and subcodes; ⌘V) or as new codes of just their names.
 */
let pasteMode: 'copy' | 'name' = 'copy';
/**
 * The cells being dragged with the fill handle (set when the drag starts): filled names are
 * those exact values, i.e. a parent's or top-level code's cell the same code, any other name a
 * code of exactly that name (no "name (2)").
 */
let fill: ReturnType<typeof cellsOf> = null;
/** True while the table is filled from the codebook (its change events are then not edits). */
let syncing = false;
const openListeners: ((open: boolean) => void)[] = [];

export const isCodebookTableOpen = () => !!view;

/** Whether the keyboard goes to the table (so other shortcuts, like Delete for selected codes, keep out). */
export const codebookTableHasFocus = () => !!view && jspreadsheet.current === view.ws;

/** Called when the table is opened or closed (e.g. to update the button). */
export function onCodebookTableToggle(fn: (open: boolean) => void) {
  openListeners.push(fn);
}

export function toggleCodebookTable() {
  if (view) void requestCloseCodebookTable();
  else openCodebookTable();
}

// ---------- columns and data ----------

// Each level has two columns, its code's name and description; then the (hidden) id of the row's code.
const nameCol = (k: number) => 2 * k;
const descCol = (k: number) => 2 * k + 1;
const idCol = (levels: number) => 2 * levels;
const isNameCol = (x: number, levels: number) => x < 2 * levels && x % 2 === 0;
const levelOf = (x: number) => Math.floor(x / 2);

/** A column's key for minimizing (stable when levels are added). */
const columnKey = (x: number, levels: number) => `${isNameCol(x, levels) ? 'name' : 'desc'}-${levelOf(x)}`;

const MINIMIZED_WIDTH = 30;
const isMinimized = (x: number, levels: number) => ui.tableMinimized.includes(columnKey(x, levels));

function columns(levels: number): jspreadsheet.Column[] {
  const width = (x: number, w: number) => (isMinimized(x, levels) ? MINIMIZED_WIDTH : (ui.tableWidths[columnKey(x, levels)] ?? w));
  return [
    ...Array.from({ length: levels }, (_, k): jspreadsheet.Column[] => [
      {
        title: `Code Level ${k + 1}`,
        type: 'text',
        width: width(nameCol(k), 160),
        align: 'left',
        // Wrapping is the table's own (cbt-wrap / cbt-nowrap, see markCells): jspreadsheet would
        // otherwise wrap any text over 200 characters (inline, over minimized columns, merged
        // cells and cells set not to wrap).
        wordWrap: false,
        render: (cell, _value, _x, y) => paintCell(cell, k, Number(y)),
      },
      { title: `Description ${k + 1}`, type: 'text', width: width(descCol(k), 240), align: 'left', wordWrap: false },
    ]).flat(),
    { title: 'id', type: 'hidden' },
  ];
}

/** A row of the table: a code's row, or a draft. */
type Line = { row: ShownRow; draft?: undefined } | { draft: Draft; row?: undefined };
let linesCache: { rows: ShownRow[]; drafts: Draft[]; order: string[]; lines: Line[] } | null = null;

/** The table's rows in their order. */
function lines(): Line[] {
  const { rows, drafts, order } = view!;
  if (linesCache?.rows === rows && linesCache.drafts === drafts && linesCache.order === order) return linesCache.lines;
  const byKey = new Map<string, Line>([...rows.map((row): [string, Line] => [row.id, { row }]), ...drafts.map((draft): [string, Line] => [`draft:${draft.key}`, { draft }])]);
  const out = order.flatMap((key) => byKey.get(key) ?? []);
  linesCache = { rows, drafts, order, lines: out };
  return out;
}

const rowAt = (y: number | null) => (view && y !== null ? lines()[y]?.row : undefined);
const draftAt = (y: number) => (view ? lines()[y]?.draft : undefined);
const keyOf = (line: Line) => (line.row ? line.row.id : `draft:${line.draft!.key}`);
const newDraft = (cells: string[] = []): Draft => ({ key: uid('d'), cells });

const pathKey = (names: string[]) =>
  names
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean)
    .join('\u0000');

/**
 * Brings the table's order up to date with the codebook's rows (`rows`, before they are shown),
 * without moving any row: rows that are gone leave, a draft that became a code is replaced by
 * its row, and a code whose row changed (it got its first subcode, or lost its last one) gets
 * the new rows in its place. Other new rows go after the rows of their closest relatives (or of
 * the code "Add code" was used next to), else at the end; drafts not placed yet go at the end.
 */
function reconcileOrder(rows: ShownRow[]) {
  const v = view!;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const oldById = new Map(v.rows.map((r) => [r.id, r]));
  const drafts = new Set(v.drafts.map((d) => `draft:${d.key}`));
  const known = new Set(v.order);
  const fresh = rows.filter((r) => !known.has(r.id));
  const placed = new Set<string>();
  const take = (r: CodebookRow | undefined) => {
    if (!r || placed.has(r.id)) return [];
    placed.add(r.id);
    return [r.id];
  };
  const out: string[] = [];
  for (const key of v.order) {
    const typed = v.slots.get(key);
    if (typed) {
      // The code typed in a draft: its row, else (renamed "name (2)") a new row at that depth.
      const want = pathKey(typed);
      const depth = typed.filter((n) => n.trim()).length;
      const free = fresh.filter((r) => !placed.has(r.id));
      out.push(...take(free.find((r) => pathKey(r.path) === want) ?? free.find((r) => r.base.path.length === depth)));
    }
    if (byId.has(key) || drafts.has(key)) {
      out.push(key);
      continue;
    }
    if (typed) continue;
    // A row that is gone: rows of its subcodes (it became a parent), or of its parent (now without subcodes).
    const old = oldById.get(key);
    for (const r of fresh) if (r.ids.includes(key) || old?.ids.includes(r.id)) out.push(...take(r));
  }
  for (const r of fresh) {
    if (placed.has(r.id)) continue;
    // After the last row of the "Add code" anchor, else of the row sharing the most parent codes with it.
    let best = -1;
    if (v.anchor) out.forEach((key, i) => byId.get(key)?.ids.includes(v.anchor!) && (best = i));
    let bestShared = 0;
    if (best < 0)
      out.forEach((key, i) => {
        const other = byId.get(key);
        let shared = 0;
        while (other && shared < Math.min(other.ids.length, r.ids.length) && other.ids[shared] === r.ids[shared]) shared++;
        if (shared && shared >= bestShared) {
          best = i;
          bestShared = shared;
        }
      });
    if (best < 0) out.push(r.id);
    else out.splice(best + 1, 0, r.id);
    placed.add(r.id);
  }
  for (const d of drafts) if (!out.includes(d)) out.push(d);
  v.order = out;
  v.slots.clear();
  v.anchor = null;
}

/**
 * Gives a level cell the color of the code at that level, parents the same as the row's own code
 * (also in a new row that is an existing code).
 */
function paintCell(cell: HTMLElement, k: number, y: number) {
  const row = rowAt(y);
  const draft = row ? undefined : draftAt(y);
  const choice = draft?.subcodeOf ? draft.choices?.[k] : undefined;
  const color = row?.colors[k] ?? (choice && 'id' in choice ? codeById(choice.id)?.color : undefined);
  cell.classList.toggle('cbt-colored', !!color);
  if (color) {
    cell.style.setProperty('--code-tint', hexToRgba(color, 0.25));
    cell.style.setProperty('--code-color', color);
  } else {
    cell.style.removeProperty('--code-tint');
    cell.style.removeProperty('--code-color');
  }
}

function dataOf(levels: number): jspreadsheet.CellValue[][] {
  const { issues } = view!;
  return lines().map(({ row: r, draft: d }) => {
    if (d) return [...Array.from({ length: 2 * levels }, (_, x) => d.cells[x] ?? ''), `draft:${d.key}`];
    const cells: jspreadsheet.CellValue[] = Array.from({ length: levels }, (_, k) => [r.path[k] ?? '', r.descriptions[k] ?? '']).flat();
    // Unapplied edits stay as typed.
    for (const [x, v] of issues.get(r.id)?.cells ?? []) cells[x] = v;
    return [...cells, r.id];
  });
}

const namesOf = (cells: string[], levels: number) => Array.from({ length: levels }, (_, k) => cells[nameCol(k)] ?? '');
const descriptionsOf = (cells: string[], levels: number) => Array.from({ length: levels }, (_, k) => cells[descCol(k)] ?? '');

/** Index of the last filled level (-1 if none). */
const lastFilled = (names: string[]) => names.reduce((last, v, i) => (v.trim() ? i : last), -1);

/** Whether a level before the last filled one is empty (the row's parent is missing). */
/** The name of the parents made for a code typed after empty levels (when so chosen): one per level, shared. */
const PLACEHOLDER = 'Unsorted';

const missingParent = (names: string[]) => names.slice(0, lastFilled(names)).some((v) => !v.trim());

/** Level columns: as many as the deepest code, or a draft row, needs (and at least as many as added with "+"). */
const levelsNeeded = (drafts: Draft[], levels: number) =>
  Math.max(1, ...(view?.rows ?? []).map((r) => r.ids.length), view?.minLevels ?? 0, ...drafts.map((d) => lastFilled(namesOf(d.cells, levels)) + 1));

/** Empty rows always below the last row. */
const SPARE_ROWS = 10;

/** How many rows have problems left to resolve (flags, and drafts with names; empty rows are just empty). */
const unresolved = () => (view ? view.issues.size + view.drafts.filter((d) => lastFilled(namesOf(d.cells, view!.levels)) >= 0).length : 0);

// ---------- edits from the table ----------

// What each edit came from (its cells as typed, read before applying refreshes the table).
type Target =
  | { kind: 'code'; id: string; xs: number[]; cells: string[] }
  | { kind: 'draft'; draft: Draft; cells: string[]; choices: (CellChoice | undefined)[]; cols: number[]; later?: boolean };

function onEdits(ws: Worksheet, changes: jspreadsheet.CellChange[]) {
  if (syncing || !view) return;
  const { levels } = view;
  const xsByRow = new Map<number, number[]>();
  for (const c of changes) {
    const y = Number(c.y);
    xsByRow.set(y, [...(xsByRow.get(y) ?? []), Number(c.x)]);
  }
  const edits: RowEdit[] = [];
  const targets: Target[] = [];
  // Drafts as they become: changed in place, or added for the spare row (and rows added by pasting).
  const drafts: Draft[] = [...view.drafts];
  const put = (old: Draft | undefined, next: Draft | null) => {
    const i = old ? drafts.indexOf(old) : -1;
    if (i < 0) {
      if (next) drafts.push(next);
    } else if (next) drafts[i] = next;
    else drafts.splice(i, 1);
  };
  let waitingForParent = false;
  let waitingForSubcode: string | undefined;
  let moves = 0;
  // Codes moved by pasting a cut: those without subcodes take their own row along.
  const movedIds = new Set<string>();
  // Rows moved to below the table's rows (pasted into the empty rows there): after new drafts.
  const tail: string[] = [];
  /** Puts a code's own row (if it has one) in place of the table row `key` (or below the rows). */
  const relocate = (id: string, key: string | null) => {
    if (!view!.rows.some((r) => r.id === id)) return false;
    const order = view!.order.filter((k) => k !== id);
    const i = key ? order.indexOf(key) : -1;
    if (i < 0) tail.push(id);
    view!.order = i < 0 ? order : [...order.slice(0, i), id, ...order.slice(i + 1)];
    return true;
  };
  /** The new drafts (in their order) and then the rows moved below the rows, at the end of the table's order. */
  const appendNew = () => {
    const ordered = new Set(view!.order);
    view!.order = [...view!.order, ...drafts.map((d) => `draft:${d.key}`).filter((k) => !ordered.has(k)), ...tail];
  };
  // Typing in a lower one of the empty rows below the table: the empty rows above it stay as rows.
  let end = lines().length;
  const fillGap = (y: number) => {
    while (end < y) {
      drafts.push(newDraft());
      end++;
    }
    end = Math.max(end, y + 1);
  };
  for (const y of [...xsByRow.keys()].sort((a, b) => a - b)) {
    const data = ws.getRowData(y) ?? [];
    const cells = Array.from({ length: 2 * levels }, (_, x) => String(data[x] ?? ''));
    const names = namesOf(cells, levels);
    const descriptions = descriptionsOf(cells, levels);
    const row = rowAt(y);
    const draftBefore = row ? undefined : draftAt(y);
    const rowChoices = Array.from({ length: levels }, (_, k) => {
      const key = `${nameCol(k)},${y}`;
      // A draft's earlier choice holds as long as its cell keeps that name.
      const kept = draftBefore && sameName(namesOf(draftBefore.cells, levels)[k], names[k]) ? draftBefore.choices?.[k] : undefined;
      let choice = choices.get(key) ?? kept;
      choices.delete(key);
      if (choice && 'moveTo' in choice && choice.moveTo !== undefined) {
        // A cut code pasted under another parent moves there (into its own subcodes it is copied).
        moves++;
        const ok = reparent(choice.id, choice.moveTo, false, true) === 'ok';
        if (ok) movedIds.add(choice.id);
        choice = ok ? { id: choice.id, replace: true } : { copy: true, from: choice.id, replace: true };
      }
      if (choice || !xsByRow.get(y)!.includes(nameCol(k))) return choice;
      return fillChoice(nameCol(k), names[k]) ?? nearestNamed(names[k], k, y);
    });
    if (row) {
      // From columns to the codebook's levels: the cells of the row's codes, then the free levels
      // after them; names typed into empty cells between its codes (an inserted level) insert
      // codes there.
      const { base, cols } = row;
      const last = cols[cols.length - 1];
      const byLevel = <T,>(list: T[]) => [...cols.map((c) => list[c]), ...list.slice(last + 1)];
      const inserts = names
        .map((name, k) => ({ k, name }))
        .filter(({ k, name }) => k < last && !cols.includes(k) && name.trim())
        .map(({ k, name }) => ({ before: cols.findIndex((c) => c > k), name, choice: rowChoices[k], description: descriptions[k], col: k }));
      const lastCol = row.cols[row.cols.length - 1];
      const own = rowChoices[lastCol];
      // A cut code pasted over this row's code, or after it: its own row takes this row's place.
      const after = rowChoices.slice(lastCol + 1).find((c): c is { id: string } => !!c && 'id' in c && movedIds.has(c.id));
      const taken = (own && 'id' in own && movedIds.has(own.id) && own.id !== row.id && relocate(own.id, row.id)) || (!!after && relocate(after.id, row.id));
      if (!taken) keepPlace(row, names, rowChoices, cells, xsByRow.get(y)!, drafts);
      // A parent's name cleared from this row: the codes after it stay in their columns (not moved
      // up a level), the emptied cell asking for a parent again.
      const cleared = cols.filter((c, i) => i < cols.length - 1 && !names[c].trim() && !!row.path[c]?.trim());
      if (cleared.length) {
        cols.forEach((c, i) => view!.pinned.set(base.ids[i], c));
        const next = cols.findIndex((c) => c > Math.min(...cleared));
        if (next >= 0) view!.unparented.add(base.ids[next]);
      }
      edits.push({
        ids: base.ids,
        path: byLevel(names),
        oldPath: base.path,
        choices: byLevel(rowChoices),
        descriptions: byLevel(descriptions),
        oldDescriptions: base.descriptions,
        inserts,
      });
      targets.push({ kind: 'code', id: row.id, xs: xsByRow.get(y)!, cells });
      continue;
    }
    const base = draftBefore ?? newDraft();
    // A name after empty levels (its parents missing), created as chosen in the suggestions:
    // with placeholder parents, or at the top level with its parents to be typed later.
    const last = lastFilled(names);
    const lastChoice = rowChoices[last];
    const parents = last > 0 && names.slice(0, last).some((v) => !v.trim()) && lastChoice && 'new' in lastChoice ? lastChoice.parents : undefined;
    if (parents === 'placeholder') {
      for (let j = 0; j < last; j++) {
        if (names[j].trim()) continue;
        names[j] = PLACEHOLDER;
        cells[nameCol(j)] = PLACEHOLDER;
      }
    }
    const levelled = parents === 'later' ? { names: [names[last]], values: [lastChoice], cols: [last] } : levelsOfRow(names, rowChoices);
    const parent = rowParentCode(levelled.names, levelled.values);
    const hasText = cells.some((c) => c.trim());
    if (!draftBefore && hasText) fillGap(y);
    if (lastFilled(names) < 0) {
      // No name (a description alone does not make a code): the row stays as it is, with what is
      // in it; an empty row below the rows goes.
      put(draftBefore, draftBefore || hasText ? { key: base.key, cells } : null);
    } else if (parent && movedIds.has(parent.id) && relocate(parent.id, draftBefore ? `draft:${draftBefore.key}` : null)) {
      // A cut code without subcodes pasted here: its own row is now here.
      put(draftBefore, null);
    } else if (parent) {
      // An existing parent code (e.g. its cell pasted): the same code, waiting for a subcode.
      put(draftBefore, { ...asParentRow(cells, parent), key: base.key });
      waitingForSubcode = parent.name;
    } else if (missingParent(levelled.names)) {
      // Wait for the parent: keep the row as it is.
      put(draftBefore, { key: base.key, cells, choices: rowChoices });
      waitingForParent = true;
    } else {
      // Becomes a code (the draft goes once it is added, or stays with the problem).
      const draft: Draft = { key: base.key, cells, choices: rowChoices };
      put(draftBefore, draft);
      edits.push({ ids: [], path: levelled.names, choices: levelled.values, descriptions: levelled.cols.map((k) => descriptions[k]) });
      targets.push({ kind: 'draft', draft, cells, choices: rowChoices, cols: levelled.cols, later: parents === 'later' });
    }
  }
  fill = null;
  if (waitingForSubcode) toast(`This row is the existing code “${waitingForSubcode}”: type a new subcode for it in the next level.`, 5000);
  else if (waitingForParent) toast('Type the parent code in the empty level before it (an existing code or a new one); the row then becomes its subcode.', 5000);
  if (!edits.length) {
    view.drafts = drafts;
    appendNew();
    // Moved codes (cut and pasted) are a change of the codebook too.
    if (moves) commit();
    return refresh();
  }
  // A draft that becomes a code: its row goes in the draft's place (the table is refreshed while
  // applying, so the drafts, new ones too, are in the table's order already).
  view.drafts = drafts;
  appendNew();
  for (const t of targets) if (t.kind === 'draft') view.slots.set(`draft:${t.draft.key}`, namesOf(t.cells, levels));
  const existed = new Set(project.codes.map((c) => c.id));
  const before = deletionSnapshot();
  const { problems } = applyRowEdits(edits);
  if (!view) return;
  // Codes deleted by clearing or replacing their cells (no dialog: said, with Undo).
  noteDeleted(before, [...existed].filter((id) => !codeById(id)));
  // New codes stay in the columns they were typed in (also where those are after an inserted level).
  edits.forEach((edit, i) => {
    const t = targets[i];
    if (t.kind === 'draft') edit.created?.forEach((id, j) => !existed.has(id) && view!.pinned.set(id, t.cols[j]));
    if (t.kind === 'draft' && t.later && edit.created?.length) view!.unparented.add(edit.created.at(-1)!);
    for (const insert of edit.inserts ?? []) if (insert.id) view!.pinned.set(insert.id, (insert as typeof insert & { col: number }).col);
  });
  const failed = new Map(problems.map((p) => [p.edit, p.message]));
  targets.forEach((t, i) => {
    const message = failed.get(i);
    if (t.kind === 'draft') {
      put(t.draft, message ? { ...t.draft, message } : null);
      return;
    }
    if (!message) {
      view!.issues.delete(t.id);
      return;
    }
    // Keep what was typed in the changed cells (and earlier unapplied cells of the row).
    const issue = view!.issues.get(t.id) ?? { cells: new Map<number, string>(), message };
    for (const x of t.xs) issue.cells.set(x, t.cells[x] ?? '');
    issue.message = message;
    view!.issues.set(t.id, issue);
  });
  view.drafts = drafts;
  refresh();
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What a name filled into column `x` with the fill handle stands for (see `fill`). */
function fillChoice(x: number, name: string): CellChoice | undefined {
  if (!fill || !name.trim()) return undefined;
  const sources = fill.values.flatMap((r, i) => r.map((v, j) => ({ v, id: fill!.ids[i][j], x: fill!.x + j })));
  const source = sources.find((c) => c.x === x && c.v === name) ?? sources.find((c) => c.v === name);
  if (!source?.id) return undefined;
  const code = codeById(source.id);
  return code && isParentLike(code) ? { id: source.id } : { new: true };
}

/** Inserts an empty row above (or below) row `y`. */
function insertRow(y: number, below: boolean) {
  if (!view) return;
  const at = below ? y + 1 : y;
  const line = lines()[at];
  const draft = newDraft();
  const key = `draft:${draft.key}`;
  const i = line ? view.order.indexOf(keyOf(line)) : -1;
  view.order = i < 0 ? [...view.order, key] : [...view.order.slice(0, i), key, ...view.order.slice(i)];
  view.drafts = [...view.drafts, draft];
  refresh();
  view.ws.updateSelectionFromCoords(0, at, 0, at);
}

/**
 * Before a code row's edit is applied: keeps the row where it is when its code goes. Replaced by
 * an existing code (pasted as that code), the row becomes that code; replaced by a copy or a new
 * code, that code's row takes its place; with its code's cell cleared, the row stays as its
 * parent (when the parent keeps other subcodes; else the parent's own row takes its place), or
 * as an empty row when all its names are cleared.
 */
function keepPlace(row: ShownRow, names: string[], rowChoices: (CellChoice | undefined)[], cells: string[], xs: number[], drafts: Draft[]) {
  const v = view!;
  const lastCol = row.cols[row.cols.length - 1];
  const own = rowChoices[lastCol];
  const at = v.order.indexOf(row.id);
  const addDraft = (draft: Draft) => {
    drafts.push(draft);
    v.order = at < 0 ? [...v.order, `draft:${draft.key}`] : [...v.order.slice(0, at), `draft:${draft.key}`, ...v.order.slice(at)];
  };
  if (own && 'replace' in own && own.replace && !('id' in own && own.id === row.id)) {
    if ('id' in own) {
      const code = codeById(own.id);
      if (code) addDraft({ ...asParentRow(cells, code), key: uid('d') });
    } else v.slots.set(row.id, names);
    return;
  }
  const cleared = row.cols.filter((c) => xs.includes(nameCol(c)) && !names[c].trim());
  if (!cleared.includes(lastCol)) return;
  const remaining = row.cols.filter((c) => !cleared.includes(c));
  if (!remaining.length) return addDraft(newDraft());
  const parent = codeById(row.ids[remaining[remaining.length - 1]]);
  const othersRemain = !!parent && project.codes.some((c) => c.parentId === parent.id && c.id !== row.base.ids[row.cols.indexOf(remaining[remaining.length - 1]) + 1]);
  if (parent && othersRemain) addDraft({ ...asParentRow(cells, parent), key: uid('d') });
}

/**
 * A new row that is an existing parent code: its parents' levels filled in (names, and empty
 * descriptions), and the code chosen in each level, so a subcode typed next goes under it.
 */
function asParentRow(cells: string[], parent: Code): Omit<Draft, 'key'> {
  const chain = codeChain(parent);
  const cols = colsOf(chain.map((c) => c.id));
  const out = [...cells];
  const picked: (CellChoice | undefined)[] = [];
  for (const [i, c] of chain.entries()) {
    const k = cols[i];
    picked[k] = { id: c.id };
    const typed = cells[nameCol(k)]?.trim();
    if (typed && !sameName(typed, c.name)) {
      const where = chain.slice(0, -1).map((p) => p.name).join(' › ');
      return { cells, message: `“${parent.name}” is under “${where}”, not under “${typed}”. Empty the levels before it (they are filled in), or type a new name.` };
    }
    if (!typed) out[nameCol(k)] = c.name;
    if (!out[descCol(k)]?.trim()) out[descCol(k)] = c.description ?? '';
  }
  return { cells: out, choices: picked, subcodeOf: parent.id };
}

/**
 * When several codes at a level have the name typed or filled into a cell: the one in the
 * nearest row (filling down a parent's cell repeats that parent). Undefined if the name is clear.
 */
function nearestNamed(name: string, k: number, y: number): CellChoice | undefined {
  if (!view || !name.trim() || codesInColumn(k).filter((c) => sameName(c.name, name)).length < 2) return undefined;
  let best: { id: string; d: number } | undefined;
  lines().forEach(({ row: r }, ry) => {
    const id = r?.ids[k];
    const c = id ? codeById(id) : undefined;
    if (!c || ry === y || !sameName(c.name, name)) return;
    const d = Math.abs(ry - y);
    if (!best || d < best.d) best = { id: c.id, d };
  });
  return best && { id: best.id };
}

// ---------- copying and pasting ----------

/** The code a level cell stands for: in a code's row, or in a new row that is an existing code (e.g. pasted). */
function codeInCell(k: number, y: number): string | null {
  const row = rowAt(y);
  if (row) return row.ids[k] || null;
  const choice = draftAt(y)?.choices?.[k];
  return choice && 'id' in choice && codeById(choice.id) ? choice.id : null;
}

/** Cells of a range (without the hidden id column), with the codes of their name cells. */
function cellsOf(ws: Worksheet, range: [number, number, number, number]) {
  if (!view) return null;
  const last = 2 * view.levels - 1;
  const [x1, y1, x2, y2] = [Math.min(range[0], range[2]), Math.min(range[1], range[3]), Math.min(last, Math.max(range[0], range[2])), Math.max(range[1], range[3])];
  const values: string[][] = [];
  const ids: (string | null)[][] = [];
  for (let y = y1; y <= y2; y++) {
    values.push([]);
    ids.push([]);
    for (let x = x1; x <= x2; x++) {
      values.at(-1)!.push(String(ws.getValueFromCoords(x, y) ?? ''));
      ids.at(-1)!.push(isNameCol(x, view.levels) ? codeInCell(levelOf(x), y) : null);
    }
  }
  return { values, ids, x: x1 };
}

/** A cell's text in tab-separated text (quoted if it has tabs, line breaks or quotes, as spreadsheets do). */
const tsvCell = (v: string) => (/[\t\n\r"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const escapeHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Copying cells of the table (⌘C, or Copy in the menu, which jspreadsheet does with a copy
 * command): the clipboard gets their text, and an HTML table of the same cells whose name cells
 * carry their code's id and color. Pasting reads these back (onClipboardPaste), so a copied cell
 * is that code, and text from elsewhere is just text. Other apps (spreadsheets, Miro) paste the
 * HTML table or the text.
 */
function onClipboardCopy(e: ClipboardEvent) {
  if (!view || jspreadsheet.current !== view.ws || view.ws.edition || !e.clipboardData) return;
  const sel = view.ws.getSelection();
  const cells = sel && cellsOf(view.ws, sel as [number, number, number, number]);
  if (!cells) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', cells.values.map((r) => r.map(tsvCell).join('\t')).join('\n'));
  // jspreadsheet recognizes its own copies when pasting and then pastes the cells' formatting
  // (code colors) too: pasting reads just the values from the clipboard instead.
  const ws = view.ws as Worksheet & { hashString?: unknown };
  setTimeout(() => (ws.hashString = null));
  if (copyTextOnly) {
    copyTextOnly = false;
    return;
  }
  const rows = cells.values.map((r, i) =>
    r
      .map((v, j) => {
        const id = cells.ids[i][j];
        const code = id ? codeById(id) : undefined;
        const meta = code ? ` data-bct-id="${escapeHtml(code.id)}" data-bct-color="${escapeHtml(code.color)}"` : '';
        return `<td data-bct-value="${escapeHtml(v)}"${meta}>${escapeHtml(v).replace(/\n/g, '<br>')}</td>`;
      })
      .join(''),
  );
  if (cutting) cutToken = uid('cut');
  const cut = cutting ? ` data-bct-cut="${cutToken}"` : '';
  e.clipboardData.setData('text/html', `<table data-bct-cells="1"${cut}>${rows.map((r) => `<tr>${r}</tr>`).join('')}</table>`);
}

/** The cells and their codes in copied HTML (see onClipboardCopy), or null if it has none. */
function cellsFromHtml(html: string): { values: string[][]; meta: CellMeta[][]; cut?: string } | null {
  if (!html.includes('data-bct-cells')) return null;
  const table = new DOMParser().parseFromString(html, 'text/html').querySelector('table[data-bct-cells]');
  if (!table) return null;
  const rows = [...table.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td')]);
  return {
    values: rows.map((r) => r.map((td) => td.dataset.bctValue ?? td.textContent ?? '')),
    meta: rows.map((r) => r.map((td) => ({ id: td.dataset.bctId ?? null, color: td.dataset.bctColor }))),
    cut: (table as HTMLElement).dataset.bctCut,
  };
}

/**
 * Cutting (⌘X): copies the cells marked as cut. Pasting them moves their codes (see
 * onBeforePaste); until then nothing changes (jspreadsheet's own cut would empty the cells at
 * once, which deletes codes).
 */
function cutCells(ws: Worksheet) {
  cutting = true;
  try {
    ws.copy();
  } finally {
    cutting = false;
  }
}

/** Pasting into the table (⌘V): notes whether the clipboard has copied codes or just text. */
function onClipboardPaste(e: ClipboardEvent) {
  if (!view || jspreadsheet.current !== view.ws || view.ws.edition) return;
  pasting = cellsFromHtml(e.clipboardData?.getData('text/html') ?? '') ?? 'text';
}

/** Paste in the menu: reads the clipboard (with the copied codes, if any) and pastes at the selection. */
async function pasteFromClipboard(ws: Worksheet, mode: 'copy' | 'name') {
  const sel = ws.getSelection();
  if (!sel) return;
  let text = '';
  let html = '';
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
      if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
    }
  } catch {
    text = await navigator.clipboard.readText().catch(() => '');
  }
  if (!text) return toast('The clipboard is empty, or the browser did not allow reading it. Use ⌘V / Ctrl+V instead.');
  pasting = cellsFromHtml(html) ?? 'text';
  pasteMode = mode;
  ws.paste(Math.min(Number(sel[0]), Number(sel[2])), Math.min(Number(sel[1]), Number(sel[3])), text);
}

/** A code with subcodes, or at the top level (it can get subcodes): pasted or filled, it stays that code. */
const isParentLike = (code: Code) => !code.parentId || project.codes.some((c) => c.parentId === code.id);

/**
 * The parent a name pasted into column `x` of row `y` goes under: the code in the nearest filled
 * level before it, in the pasted cells (`pasted`, from column `col`, with what they stand for) or
 * else in the row. Null for the top level, 'unset' if the levels before it are empty (they are
 * filled in from the pasted code), 'other' for a name that is not one existing code.
 */
function parentAt(x: number, y: number, col: number, pasted: { value: string; choice?: CellChoice }[]): string | null | 'unset' | 'other' {
  if (!view) return 'other';
  for (let k = levelOf(x) - 1; k >= 0; k--) {
    const px = nameCol(k);
    const cell = px >= col ? pasted[px - col] : undefined;
    if (cell) {
      if (!cell.value.trim()) continue;
      return cell.choice && 'id' in cell.choice ? cell.choice.id : 'other';
    }
    const id = codeInCell(k, y);
    if (id) return id;
    const typed = namesOf(draftAt(y)?.cells ?? [], view.levels)[k]?.trim();
    if (typed) {
      const found = codesInColumn(k).filter((c) => sameName(c.name, typed));
      return found.length === 1 ? found[0].id : 'other';
    }
  }
  return levelOf(x) === 0 ? null : 'unset';
}

/**
 * What pasted names stand for. Cells copied in a table carry their code: pasted under the same
 * parent (or where the levels before it are empty, in its own column), a code is that same code;
 * under another parent, an identical copy of it with new ids (its coded segments and subcodes
 * too), or with "Paste code name only" a new code of just its name. A code this project does not
 * have becomes a new code of that name and color. Just text (pasted from elsewhere, or copied as
 * text only) is new codes of exactly those names.
 */
function onBeforePaste(data: { value: jspreadsheet.CellValue }[][], col: number, row: number) {
  const source = pasting;
  const mode = pasteMode;
  pasting = null;
  pasteMode = 'copy';
  if (!view || !source) return;
  const levels = view.levels;
  // The copied cells, also repeated to fill a larger selection (as spreadsheets paste).
  const copied = source === 'text' ? null : source;
  const h = copied?.values.length ?? 0;
  const w = copied?.values[0]?.length ?? 0;
  const same = !!copied && !!w && data.every((r, i) => r.every((c, j) => String(c.value ?? '') === copied.values[i % h][j % w]));
  // Pasting a cut moves its codes, once.
  const cut = same && !!copied!.cut && copied!.cut === cutToken;
  if (cut) cutToken = null;
  data.forEach((r, i) => {
    // Left to right, so a pasted parent decides for the names after it.
    const pasted: { value: string; choice?: CellChoice }[] = [];
    r.forEach((c, j) => {
      const x = col + j;
      const value = String(c.value ?? '');
      pasted[j] = { value };
      if (!isNameCol(x, levels) || !value.trim()) return;
      const meta = same ? copied!.meta[i % h][j % w] : undefined;
      const code = meta?.id ? codeById(meta.id) : undefined;
      let choice: CellChoice;
      if (!meta?.id) choice = { new: true, replace: true };
      else if (!code) choice = { new: true, color: meta.color, replace: true };
      else {
        const parent = parentAt(x, row + i, col, pasted);
        const sameParent = parent === (code.parentId ?? null) || (parent === 'unset' && columnOf(code.id) === levelOf(x));
        if (sameParent) choice = { id: code.id, replace: true };
        // Cut: the code itself moves under that parent (if it is one; else it is copied).
        else if (cut && parent !== 'unset' && parent !== 'other') choice = { id: code.id, replace: true, moveTo: parent };
        else if (mode === 'name') choice = { new: true, replace: true };
        else choice = { copy: true, from: code.id, replace: true };
      }
      pasted[j].choice = choice;
      choices.set(`${x},${row + i}`, choice);
    });
  });
}

// ---------- suggestions while typing a name ----------

interface Suggestion {
  /** The name it puts in the cell. */
  name: string;
  /** What the list shows (else the name). */
  label?: string;
  hint: string;
  choice: CellChoice;
}

let suggest: { el: HTMLElement; close: () => void; place: () => void } | null = null;

/** While a cell is edited: keeps its popped-out editor (and suggestions) over the cell as the table scrolls. */
let followEditor: (() => void) | null = null;

/** A list below a name cell being edited: the codes of that level column, and "(new) name" for a new code of an existing name. */
/**
 * The editor pops out of its cell (as in Google Sheets): over the cell and at least its size, it
 * grows to the right as the text gets longer (as far as the table shows), then its lines wrap and
 * it grows downwards. The cell keeps its height meanwhile, so the rows do not move.
 */
function popOutEditor(td: HTMLTableCellElement) {
  const ed = td.querySelector<HTMLTextAreaElement>(':scope > textarea');
  const area = view?.host.querySelector<HTMLElement>('.jss_content')?.getBoundingClientRect();
  if (!ed || !area) return;
  const cell = td.getBoundingClientRect();
  td.style.height = `${cell.height}px`;
  ed.classList.add('cbt-editor');
  ed.style.minHeight = '';
  const scroller = view!.host.querySelector<HTMLElement>('.jss_content')!;
  // Over the cell, cut off where the table does not show (outside it, under its column headers).
  const place = () => {
    const c = td.getBoundingClientRect();
    ed.style.left = `${c.left}px`;
    ed.style.top = `${c.top}px`;
    const shown = scroller.getBoundingClientRect();
    const top = Math.max(shown.top, scroller.querySelector('thead')?.getBoundingClientRect().bottom ?? shown.top);
    const r = ed.getBoundingClientRect();
    const cut = [top - r.top, r.right - shown.right, r.bottom - shown.bottom, shown.left - r.left].map((v) => `${Math.max(0, Math.round(v))}px`);
    ed.style.clipPath = `inset(${cut.join(' ')})`;
    // Its suggestions only while it shows.
    suggest?.place();
    if (suggest) suggest.el.style.visibility = c.bottom < top || c.top > shown.bottom ? 'hidden' : '';
  };
  const style = getComputedStyle(ed);
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = style.font;
  const frameX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
  const frameY = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const maxWidth = Math.max(cell.width, Math.min(520, area.right - cell.left - 4));
  const maxHeight = Math.max(cell.height, Math.min(area.bottom, innerHeight) - cell.top - 4);
  const fit = () => {
    const longest = Math.max(0, ...ed.value.split('\n').map((line) => ctx.measureText(line).width));
    ed.style.width = `${Math.min(maxWidth, Math.max(cell.width, Math.ceil(longest + frameX + 2)))}px`;
    ed.style.height = '0';
    ed.style.height = `${Math.min(maxHeight, Math.max(cell.height, ed.scrollHeight + frameY))}px`;
    place();
  };
  ed.addEventListener('input', fit);
  fit();
  followEditor = place;
}

function onEditionStart(ws: Worksheet, td: HTMLTableCellElement, x: number, y: number) {
  closeSuggestions();
  if (!view || !isNameCol(x, view.levels)) return;
  const input = td.querySelector<HTMLInputElement>('input, textarea');
  if (!input) return;
  const k = levelOf(x);
  const row = rowAt(y);
  const own = row?.ids[k] || undefined;
  const parentId = row ? (row.ids.slice(0, k).filter(Boolean).at(-1) ?? null) : null;
  const list = h('ul', { class: 'cbt-suggest', role: 'listbox' });
  let items: Suggestion[] = [];
  let active = -1;
  const key = `${x},${y}`;
  // The highlighted suggestion is what the cell stands for when it is left (Enter, Tab or a click elsewhere).
  const setActive = (i: number) => {
    active = i;
    if (i >= 0) choices.set(key, items[i].choice);
    else choices.delete(key);
    list.querySelectorAll('li').forEach((li, j) => li.classList.toggle('active', j === i));
  };
  const pick = (i: number) => {
    input.value = items[i].name;
    choices.set(key, items[i].choice);
  };
  // What the editor commits never has leading or trailing whitespace.
  const trimValue = () => {
    const t = input.value.trim();
    if (t !== input.value) input.value = t;
  };
  // A parent's cell: a new name renames the parent (for all its rows) or moves only this row.
  const parentCell = !!row && !!own && k < row.ids.length - 1;
  const renderParent = (q: string): { items: Suggestion[]; active: number } => {
    const current = codeById(own!)!;
    const moved = codeById(row!.ids.slice(k + 1).find(Boolean) ?? '')?.name ?? '';
    const n = view!.rows.filter((r) => r.ids[k] === own).length;
    const others = codesInColumn(k)
      .filter((c) => c.id !== own && (!q || c.name.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => Number(sameName(b.name, q)) - Number(sameName(a.name, q)) || a.name.localeCompare(b.name))
      .slice(0, 30)
      .map((c): Suggestion => {
        const parents = codeChain(c).slice(0, -1).map((p) => p.name).join(' › ');
        return { name: c.name, label: `Move “${moved}” under “${c.name}”`, hint: [parents, 'only this row'].filter(Boolean).join(' · '), choice: { id: c.id } };
      });
    if (!q || q === current.name) return { items: others, active: -1 };
    return {
      items: [
        { name: q, label: `Rename code to “${q}”`, hint: n > 1 ? `all ${n} rows` : 'this code', choice: { rename: true } },
        { name: q, label: `Turn into new L${k + 1} code “${q}”`, hint: 'only this row', choice: { new: true } },
        ...others,
      ],
      // Enter renames.
      active: 0,
    };
  };
  /** Where a new code in this (empty) cell goes: under the code (or name) in the level before it. */
  const newCodeHint = () => {
    if (!k) return 'top level';
    const parentName = (parentId ? codeById(parentId)?.name : undefined) ?? String(ws.getValueFromCoords(nameCol(k - 1), y) ?? '').trim();
    return parentName ? `subcode of “${parentName}”` : `in Level ${k + 1}`;
  };
  const render = () => {
    const raw = input.value;
    const q = raw.trim();
    // A trailing space means the name is still being typed, not that it is an existing code.
    const typing = /\s$/.test(raw);
    const all = codesInColumn(k);
    if (parentCell) {
      ({ items, active } = renderParent(q));
    } else {
      items = all
        .filter((c) => c.id !== own && (!q || c.name.toLowerCase().includes(q.toLowerCase())))
        .sort((a, b) => Number(sameName(b.name, q)) - Number(sameName(a.name, q)) || Number((b.parentId ?? null) === parentId) - Number((a.parentId ?? null) === parentId) || a.name.localeCompare(b.name))
        .slice(0, 30)
        .map((c) => {
          const parents = codeChain(c).slice(0, -1).map((p) => p.name).join(' › ');
          const subs = project.codes.filter((s) => s.parentId === c.id).length;
          return { name: c.name, hint: [parents, subs ? `${subs} subcode${subs === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '), choice: { id: c.id } };
        });
      const taken = all.some((c) => c.id !== own && sameName(c.name, q));
      // A new row's name after empty levels: its parents are missing.
      const orphan = !row && k > 0 && Array.from({ length: k }, (_, j) => String(ws.getValueFromCoords(nameCol(j), y) ?? '').trim()).some((v) => !v);
      if (q && !own && orphan) {
        // How to make it a code without its parents: first (unless it names a code).
        items.unshift(
          { name: q, label: `Create new L${k + 1} code “${q}”`, hint: 'type its parent codes later', choice: { new: true, parents: 'later' } },
          { name: q, label: `Create “${q}” under placeholder parents`, hint: `“${PLACEHOLDER}” in each empty level, to rename later`, choice: { new: true, parents: 'placeholder' } },
          { name: q, label: 'Keep as draft', hint: 'a code once its parent codes are typed', choice: { new: true, parents: 'wait' } },
        );
      } else if (q && !own) {
        // An empty cell: a new code at this level, first (as the typed name already is, unless it names a code).
        items.unshift({ name: q, label: `Create new L${k + 1} code “${q}”`, hint: newCodeHint(), choice: { new: true } });
      } else if (q && taken) {
        // The row's code, with the name of another code: this code under that name (not that code).
        items.push({ name: q, label: `Turn into new L${k + 1} code “${q}”`, hint: `this code, renamed (not the other “${q}”)`, choice: { new: true } });
      }
      // An exact name is that code unless something else is picked (or the name is still being
      // typed); in an empty cell, else the new code.
      active = typing ? -1 : items.findIndex((i) => 'id' in i.choice && sameName(i.name, q));
      if (active < 0 && q && !own && !typing) active = 0;
    }
    list.replaceChildren(
      ...items.map((it, i) =>
        h(
          'li',
          {
            class: i === active ? 'active' : '',
            role: 'option',
            onMousedown: (e: MouseEvent) => {
              e.preventDefault();
              pick(i);
              ws.closeEditor(td, true);
            },
          },
          h('span', { class: 'cbt-suggest-name' }, it.label ?? it.name),
          it.hint ? h('span', { class: 'cbt-suggest-hint' }, it.hint) : null,
        ),
      ),
    );
    list.hidden = !items.length;
    setActive(active);
    place();
  };
  // Below the editor (which grows out of the cell).
  const place = () => {
    const r = input.getBoundingClientRect();
    list.style.left = `${r.left}px`;
    list.style.top = `${r.bottom + 2}px`;
    list.style.minWidth = `${Math.max(r.width, 200)}px`;
  };
  const onKey = (e: KeyboardEvent) => {
    // Leaving with Enter or Tab: the input's own listener runs before the worksheet's.
    if (e.key === 'Enter' || e.key === 'Tab') trimValue();
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // The list's keys, not the table's.
      e.preventDefault();
      e.stopPropagation();
      setActive(e.key === 'ArrowDown' ? Math.min(items.length - 1, active + 1) : Math.max(-1, active - 1));
      list.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
    } else if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0) {
      pick(active);
    }
  };
  // Leaving with a click or tap elsewhere: capture runs before the worksheet's document handler closes the editor.
  const onPointerDown = (e: PointerEvent) => {
    if (e.target instanceof Node && input.contains(e.target)) return;
    trimValue();
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.body.append(list);
  render();
  suggest = {
    el: list,
    place,
    close: () => {
      input.removeEventListener('input', render);
      input.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
      list.remove();
      suggest = null;
    },
  };
}

function closeSuggestions() {
  suggest?.close();
}

/** A name not used yet under `parentId` ("New code", "New code 2", …). */
function freeName(parentId: string | null): string {
  let name = 'New code';
  for (let n = 2; findChildCode(parentId, name); n++) name = `New code ${n}`;
  return name;
}

/** Adds a code (next to the code `nextTo`, or as its subcode) and starts editing its name. */
function addCode(nextTo: string | null, asSubcode: boolean) {
  const code = nextTo ? codeById(nextTo) : undefined;
  const parentId = code ? (asSubcode ? code.id : (code.parentId ?? null)) : null;
  const top = parentId ? codeChain(codeById(parentId)!)[0] : undefined;
  const created = { id: uid('c'), name: freeName(parentId), color: top?.color ?? nextColor(), parentId, order: nextOrder(parentId), updatedAt: now() };
  project.codes.push(created);
  if (view) view.anchor = nextTo;
  commit();
  refresh();
  editName(created.id);
}

/** Selects a code's name cell and opens its editor. */
function editName(id: string) {
  if (!view) return;
  const y = lines().findIndex((l) => l.row?.ids.includes(id));
  if (y < 0) return;
  const x = nameCol(rowAt(y)!.ids.indexOf(id));
  const cell = view.ws.getCellFromCoords(x, y);
  cell.scrollIntoView({ block: 'nearest' });
  // Opened once scrolling is done, so the editor pops out where the cell ends up.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (!view) return;
      // The table takes the keyboard (Enter, Tab, arrows) as if it had been clicked.
      jspreadsheet.current = view.ws;
      view.ws.updateSelectionFromCoords(x, y, x, y);
      view.ws.openEditor(cell);
      // Typing replaces the placeholder name.
      cell.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')?.select();
    }),
  );
}

/** Shows the code of the selected cell (the first one of a range) in the codebook. */
function revealSelectedCode() {
  const sel = view?.selection;
  if (!view || !sel) return;
  const x = Math.min(Number(sel[0]), Number(sel[2]));
  const y = Math.min(Number(sel[1]), Number(sel[3]));
  if (x >= 2 * view.levels) return;
  const id = codeInCell(levelOf(x), y);
  if (id) revealCode(id);
}

/** The codes in the selected cells (each level cell is that level's code; selected rows are all their codes). */
function selectedCodeIds(ws: Worksheet): string[] {
  const sel = ws.getSelection();
  if (!sel || !view) return [];
  const [x1, y1, x2, y2] = sel;
  const ids = new Set<string>();
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
    const row = rowAt(y);
    if (!row) continue;
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2) && x < 2 * view.levels; x++) {
      const id = row.ids[levelOf(x)];
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/** What a message about deleted codes needs to know, taken before deleting. */
function deletionSnapshot() {
  return { segments: segmentCounts(), names: new Map(project.codes.map((c) => [c.id, c.name])), parents: new Map(project.codes.map((c) => [c.id, c.parentId ?? null])) };
}

/**
 * Says which codes were deleted (`gone`), with how many coded segments, and that their subcodes
 * moved up a level: in the table it can look like just emptying a cell. With Undo.
 */
function noteDeleted(before: ReturnType<typeof deletionSnapshot>, gone: string[]) {
  if (!gone.length) return;
  const segments = gone.reduce((n, id) => n + (before.segments.get(id) ?? 0), 0);
  const goneSet = new Set(gone);
  // Their subcodes that are left: now under the deleted code's parent (or at the top level).
  const orphans = [...before.parents].filter(([id, parent]) => parent && goneSet.has(parent) && codeById(id)).map(([id]) => codeById(id)!);
  const where = (id: string) => {
    const parent = codeById(id)?.parentId;
    return parent ? `under “${codeById(parent)?.name}”` : 'top-level codes';
  };
  const moved =
    orphans.length === 1
      ? `; “${orphans[0].name}” is now ${where(orphans[0].id).replace('top-level codes', 'a top-level code')}`
      : orphans.length
        ? new Set(orphans.map((c) => c.parentId ?? null)).size === 1
          ? `; ${gone.length === 1 ? 'its' : 'their'} ${orphans.length} subcodes are now ${where(orphans[0].id)}`
          : `; ${gone.length === 1 ? 'its' : 'their'} ${orphans.length} subcodes moved up a level`
        : '';
  const what = gone.length === 1 ? `code “${before.names.get(gone[0])}”` : `${gone.length} codes`;
  const parts = [`Deleted ${what}`, segments ? ` and ${segments} coded segment${segments === 1 ? '' : 's'}` : ' (no coded segments)', moved, '.'];
  toast(parts.join(''), 8000, { label: 'Undo', run: () => undoChange() });
}

/** Deletes codes (from the menus), saying what was deleted (see noteDeleted). */
function deleteCodesNoted(ids: string[]) {
  const before = deletionSnapshot();
  deleteCodes(ids);
  noteDeleted(before, ids.filter((id) => !codeById(id)));
}

function deleteRows(ys: number[]) {
  if (!view) return;
  // Rows just go, without asking (undo brings codes back).
  const gone = new Set(ys.map(draftAt).filter(Boolean));
  if (gone.size) {
    view.drafts = view.drafts.filter((d) => !gone.has(d));
    refresh();
  }
  const ids = [...new Set(ys.map((y) => rowAt(y)?.id).filter((id): id is string => !!id))];
  if (ids.length) deleteCodesNoted(ids);
}

/** After a row was dragged: the codes' custom order follows the rows (see reorderAsRows). */
function onMoveRow(ws: Worksheet) {
  if (syncing || !view) return;
  // The codes of the rows (parents before their subcodes) in the order the rows now have.
  const col = idCol(view.levels);
  const byId = new Map(view.rows.map((r) => [r.id, r]));
  const data = (ws.getData() as jspreadsheet.CellValue[][]).map((r) => String(r[col] ?? ''));
  // The table keeps the order the rows were dragged into.
  view.order = data.filter(Boolean);
  const ids = data.flatMap((id) => byId.get(id)?.base.ids ?? []);
  const wasCustom = ui.codeSort === 'custom';
  if (reorderAsRows(ids) && !wasCustom) toast('The codebook is now in your custom order (Sort: Custom), so rows stay where you put them.', 5000);
  refresh();
}

function contextMenu(ws: Worksheet, x: unknown, y: unknown, _e: unknown, items: jspreadsheet.ContextMenuItem[], role: string): jspreadsheet.ContextMenuItem[] {
  const col = x === null || x === undefined ? null : Number(x);
  const minimizeItem = (c: number): jspreadsheet.ContextMenuItem => ({
    title: isMinimized(c, view!.levels) ? 'Expand column' : 'Minimize column',
    onclick: () => toggleMinimized(c),
  });
  const levelItems = (c: number): jspreadsheet.ContextMenuItem[] =>
    c < 2 * view!.levels
      ? [
        { title: `Insert code column left of Level ${levelOf(c) + 1}`, onclick: () => insertLevel(levelOf(c)) },
        { title: `Insert code column right of Level ${levelOf(c) + 1}`, onclick: () => insertLevel(levelOf(c) + 1) },
      ]
      : [];
  if (role === 'header' && col !== null) return [minimizeItem(col), { type: 'line', title: '' }, ...levelItems(col)];
  const row = y === null || y === undefined ? null : Number(y);
  if (role === 'row' && row !== null) return rowMenu(row);
  // jspreadsheet's Copy and Paste, and copying only the text (pasted as new codes of those names).
  const keep = items
    .filter((i) => /^(copy|paste)/i.test(i.title ?? ''))
    .flatMap((i): jspreadsheet.ContextMenuItem[] =>
      /^copy/i.test(i.title ?? '')
        ? [
          { title: 'Cut', shortcut: '⌘X', onclick: () => cutCells(ws) } as jspreadsheet.ContextMenuItem,
          { ...i, title: 'Copy' },
          {
            title: 'Copy text only',
            onclick: () => {
              copyTextOnly = true;
              ws.copy();
              copyTextOnly = false;
            },
          },
        ]
        : [
          { ...i, title: 'Paste identical copy (with coded segments)', onclick: () => void pasteFromClipboard(ws, 'copy') },
          { title: 'Paste code name only', onclick: () => void pasteFromClipboard(ws, 'name') },
        ],
    );
  const ids = selectedCodeIds(ws);
  return [
    { title: 'Insert row above', disabled: row === null, onclick: () => insertRow(row!, false) },
    { title: 'Insert row below', disabled: row === null, onclick: () => insertRow(row!, true) },
    ...(col !== null ? levelItems(col) : []),
    { type: 'line', title: '' },
    ...keep,
    ...(keep.length ? [{ type: 'line' as const, title: '' }] : []),
    ...(col !== null ? [minimizeItem(col), { type: 'line' as const, title: '' }] : []),
    {
      title: ids.length > 1 ? `Delete ${ids.length} codes` : ids.length ? `Delete “${codeById(ids[0])?.name}”` : 'Delete code',
      disabled: !ids.length,
      onclick: () => deleteCodesNoted(ids),
    },
  ];
}

/**
 * The menu of a row number: inserting an empty row, and deleting the rows (those selected, if the
 * row is one of them), which deletes their codes.
 */
function rowMenu(row: number): jspreadsheet.ContextMenuItem[] {
  const sel = view?.selection;
  const [a, b] = sel ? [Math.min(Number(sel[1]), Number(sel[3])), Math.max(Number(sel[1]), Number(sel[3]))] : [row, row];
  const total = lines().length;
  // Only rows of the table (not the empty rows below it).
  const ys = (row >= a && row <= b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [row]).filter((y) => y < total);
  const codes = [...new Set(ys.map((y) => rowAt(y)?.id).filter((id): id is string => !!id))];
  const what = codes.length === 1 ? `deletes “${codeById(codes[0])?.name}”` : codes.length ? `deletes ${codes.length} codes` : '';
  return [
    { title: 'Insert row above', onclick: () => insertRow(row, false) },
    { title: 'Insert row below', onclick: () => insertRow(row, true) },
    { type: 'line', title: '' },
    {
      title: `${ys.length > 1 ? `Delete ${ys.length} rows` : 'Delete row'}${what ? ` (${what})` : ''}`,
      disabled: !ys.length,
      onclick: () => deleteRows(ys),
    },
  ];
}

// ---------- minimized columns and parent descriptions ----------

function toggleMinimized(x: number) {
  if (!view) return;
  const key = columnKey(x, view.levels);
  ui.tableMinimized = ui.tableMinimized.includes(key) ? ui.tableMinimized.filter((k) => k !== key) : [...ui.tableMinimized, key];
  saveUI();
  applyColumnWidths();
}

/** Column widths and the minimized look (a narrow column whose text is hidden; colors stay visible). */
/**
 * Inserts an empty level (a name and a description column) before level column `g`: every code
 * keeps its column, those from `g` on one further right, so each row gets an empty cell there.
 * A name typed into it inserts a code between that row's codes (see onEdits).
 */
function insertLevel(g: number) {
  if (!view) return;
  const v = view;
  for (const r of v.rows) r.ids.forEach((id, k) => id && v.pinned.set(id, k >= g ? k + 1 : k));
  // Drafts and unapplied edits move with their cells.
  const shift = <T,>(list: T[], at: number, n: number, empty: T) => [...list.slice(0, at), ...Array.from({ length: n }, () => empty), ...list.slice(at)];
  v.drafts = v.drafts.map((d) => ({
    ...d,
    cells: shift(Array.from({ length: 2 * v.levels }, (_, x) => d.cells[x] ?? ''), 2 * g, 2, ''),
    choices: d.choices && shift([...d.choices], g, 1, undefined),
  }));
  for (const issue of v.issues.values()) issue.cells = new Map([...issue.cells].map(([x, value]) => [x >= 2 * g ? x + 2 : x, value]));
  v.minLevels = v.levels + 1;
  refresh();
}

/** One more level column pair, for subcodes one level deeper. */
function addLevel() {
  if (!view) return;
  view.minLevels = view.levels + 1;
  refresh();
  view.host.querySelector('.jss_content')?.scrollTo({ left: 1e6, behavior: 'smooth' });
}

/** While applyColumnWidths sets widths (not resized by hand). */
let settingWidths = false;

function applyColumnWidths() {
  if (!view) return;
  const { ws, levels, host } = view;
  const cols = columns(levels);
  // Only the widths that change, in one call: each call makes jspreadsheet lay out the whole
  // table again (and report it as a resize, which is not one by hand: ignored, see onresizecolumn).
  const changed = cols.flatMap((c, x) => (c.type !== 'hidden' && typeof c.width === 'number' && Number(ws.options.columns?.[x]?.width) !== c.width ? [x] : []));
  if (changed.length) {
    settingWidths = true;
    ws.setWidth(changed, changed.map((x) => cols[x].width as number));
    settingWidths = false;
  }
  for (const td of host.querySelectorAll<HTMLElement>('thead td[data-x]')) {
    const x = Number(td.dataset.x);
    const min = isMinimized(x, levels);
    td.classList.toggle('cbt-min-col', min);
    let btn = td.querySelector<HTMLElement>('.cbt-min-btn');
    if (!btn) {
      btn = h('span', { class: 'cbt-min-btn', role: 'button' });
      // Not a click on the header (which selects the column).
      btn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleMinimized(x);
      });
      td.append(btn);
    }
    btn.textContent = min ? '›' : '‹';
    btn.title = min ? `Expand “${cols[x].title}”` : `Minimize “${cols[x].title}”`;
  }
  // "+" after the last column: one more level.
  const head = host.querySelector('thead tr:last-child');
  if (head && !head.querySelector('.cbt-add-level')) {
    head.append(
      h(
        'td',
        { class: 'cbt-add-level' },
        h('button', { type: 'button', class: 'cbt-add-level-btn', title: 'Add a level (a name and a description column)', onMousedown: (e: MouseEvent) => e.stopPropagation(), onClick: addLevel }, '+'),
      ),
    );
  }
  let style = host.querySelector<HTMLStyleElement>('style.cbt-min-style');
  if (!style) {
    style = h('style', { class: 'cbt-min-style' });
    host.prepend(style);
  }
  style.textContent = cols
    .map((_, x) => x)
    .filter((x) => isMinimized(x, levels))
    .map((x) => `.cbt-host .jss_worksheet td[data-x="${x}"]:not(.jss_row){color:transparent;white-space:nowrap;overflow:hidden}`)
    .join('\n');
  updateDescButton();
}

/** The description columns of all levels but the deepest: the parent codes' descriptions. */
const parentDescKeys = () => (view ? Array.from({ length: view.levels - 1 }, (_, k) => `desc-${k}`) : []);
const parentDescsMinimized = () => parentDescKeys().every((k) => ui.tableMinimized.includes(k));

/** Minimizes (or expands) the parent codes' description columns together. */
function toggleParentDescriptions() {
  const keys = parentDescKeys();
  if (!keys.length) return;
  ui.tableMinimized = parentDescsMinimized() ? ui.tableMinimized.filter((k) => !keys.includes(k)) : [...new Set([...ui.tableMinimized, ...keys])];
  saveUI();
  applyColumnWidths();
}

function updateDescButton() {
  if (!view) return;
  const hidden = parentDescsMinimized();
  view.descBtn.disabled = !parentDescKeys().length;
  view.descBtn.textContent = hidden && parentDescKeys().length ? 'Show parent descriptions' : 'Hide parent descriptions';
  view.descBtn.title = view.descBtn.disabled
    ? 'There are no parent codes yet'
    : hidden
      ? 'Expand the description columns of the parent levels'
      : 'Minimize the description columns of all levels but the deepest';
}

// ---------- the menu bar (next to the search): heights, widths, line wrapping, code colors, parent descriptions ----------

/**
 * Whether the cell in row `rowKey`, column `x` wraps its lines: its own setting, else its column's
 * (descriptions wrap by default; with `setOnly`, only cells set to wrap do).
 */
function isWrapped(rowKey: string, x: number, setOnly = false): boolean {
  const col = columnKey(x, view!.levels);
  return ui.tableWrap.cells[`${rowKey}|${col}`] ?? ui.tableWrap.cols[col] ?? (!setOnly && !isNameCol(x, view!.levels));
}

/** The selected cells (or all of them): row keys and column indexes. */
function targetCells(all: boolean): { rows: string[]; cols: number[] } | null {
  if (!view) return null;
  const ls = lines();
  const width = 2 * view.levels;
  if (all) return { rows: ls.map(keyOf), cols: Array.from({ length: width }, (_, x) => x) };
  const sel = view.selection;
  if (!sel) return null;
  const [x1, y1, x2, y2] = sel.map(Number);
  const range = (a: number, b: number, max: number) => Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i).filter((v) => v < max);
  return { rows: range(y1, y2, ls.length).map((y) => keyOf(ls[y])), cols: range(x1, x2, width) };
}

const NO_SELECTION = 'Select cells in the table first.';

/** In ui.tableHeights: the height of all rows without their own (also the empty rows below). */
const ALL_ROWS = '*';

/**
 * Rows fit their content (rows of the selection, or all): heights set by hand are dropped. With
 * `same`, they all get the height of the tallest of them (as its text needs).
 */
function fitHeights(all: boolean, same = false) {
  const t = targetCells(all);
  if (!t || !view) return toast(NO_SELECTION);
  for (const key of t.rows) delete ui.tableHeights[key];
  if (all) delete ui.tableHeights[ALL_ROWS];
  markCells();
  if (same) {
    // Measured as they are now, each fitting its content.
    const keys = new Set(t.rows);
    let tallest = 0;
    lines().forEach((line, y) => {
      const tr = view!.ws.getCellFromCoords(0, y)?.parentElement;
      if (tr && keys.has(keyOf(line))) tallest = Math.max(tallest, tr.getBoundingClientRect().height);
    });
    const height = Math.ceil(tallest);
    if (height) {
      for (const key of t.rows) ui.tableHeights[key] = height;
      if (all) ui.tableHeights[ALL_ROWS] = height;
    }
  }
  commitUI();
  markCells();
}

/** Turns the merged look of a parent's cells over several rows on or off. */
function toggleMerged() {
  ui.tableMerged = !ui.tableMerged;
  commitUI();
  markCells();
  updateMergeButton();
}

function updateMergeButton() {
  const btn = view?.host.querySelector<HTMLElement>('[data-tool="merge"]');
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(ui.tableMerged));
  btn.title = ui.tableMerged ? 'Show each row’s parent cells separately' : 'Show a parent’s cells over several rows as one merged cell';
}

/** Columns as wide as their longest text (in the selected cells, or in all), within limits. */
function fitWidths(all: boolean) {
  const t = targetCells(all);
  if (!t || !view) return toast(NO_SELECTION);
  const { ws, levels } = view;
  const ys = new Set(t.rows);
  const ls = lines();
  const ctx = document.createElement('canvas').getContext('2d')!;
  for (const x of t.cols) {
    const key = columnKey(x, levels);
    // A minimized column only when it was picked itself.
    if (isMinimized(x, levels)) {
      if (all) continue;
      ui.tableMinimized = ui.tableMinimized.filter((k) => k !== key);
    }
    let widest = 0;
    ls.forEach((line, y) => {
      if (!ys.has(keyOf(line))) return;
      const cell = ws.getCellFromCoords(x, y);
      if (!cell) return;
      const style = getComputedStyle(cell);
      ctx.font = style.font;
      const text = String(ws.getValueFromCoords(x, y) ?? '');
      const lineWidth = Math.max(0, ...text.split('\n').map((l) => ctx.measureText(l).width));
      widest = Math.max(widest, lineWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 4);
    });
    // The header's title fits too.
    const head = view.host.querySelector<HTMLElement>(`thead td[data-x="${x}"]`);
    if (head) {
      ctx.font = getComputedStyle(head).font;
      widest = Math.max(widest, ctx.measureText(head.textContent ?? '').width + 30);
    }
    ui.tableWidths[key] = Math.round(Math.min(600, Math.max(48, widest)));
  }
  saveUI();
  applyColumnWidths();
  markCells();
}

/** Turns line wrapping on or off for the selected cells, or for all (then cell settings are dropped). */
function setWrap(all: boolean, on: boolean) {
  const t = targetCells(all);
  if (!t || !view) return toast(NO_SELECTION);
  const levels = view.levels;
  if (all) {
    ui.tableWrap = { cols: Object.fromEntries(t.cols.map((x) => [columnKey(x, levels), on])), cells: {} };
  } else {
    const ls = lines();
    for (const row of t.rows)
      for (const x of t.cols) {
        ui.tableWrap.cells[`${row}|${columnKey(x, levels)}`] = on;
        // In the merged view, a block's cells all wrap (or not) as the cell that shows its text.
        const id = ui.tableMerged ? ls.find((l) => keyOf(l) === row)?.row?.ids[levelOf(x)] : undefined;
        if (id) for (const l of ls) if (l.row?.ids[levelOf(x)] === id) ui.tableWrap.cells[`${keyOf(l)}|${columnKey(x, levels)}`] = on;
      }
  }
  commitUI();
  markCells();
}

let toolMenu: { el: HTMLElement; close: () => void } | null = null;

function closeToolMenu() {
  toolMenu?.close();
}

/** A menu below a menu bar button: items (null for a separator). */
function openToolMenu(anchor: HTMLElement, items: ([string, () => void] | null)[]) {
  const open = toolMenu?.el.dataset.anchor === anchor.dataset.tool;
  closeToolMenu();
  if (open) return;
  const el = h(
    'div',
    { class: 'cbt-tool-menu', role: 'menu', 'data-anchor': anchor.dataset.tool ?? '' },
    ...items.map((item) =>
      item
        ? h(
          'button',
          {
            type: 'button',
            class: 'cbt-tool-item',
            role: 'menuitem',
            onMousedown: (e: MouseEvent) => e.preventDefault(),
            onClick: () => {
              closeToolMenu();
              item[1]();
            },
          },
          item[0],
        )
        : h('div', { class: 'cbt-tool-sep' }),
    ),
  );
  const r = anchor.getBoundingClientRect();
  el.style.top = `${r.bottom + 4}px`;
  el.style.left = `${r.left}px`;
  document.body.append(el);
  const outside = (e: MouseEvent) => {
    if (!el.contains(e.target as Node) && !anchor.contains(e.target as Node)) closeToolMenu();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeToolMenu();
  };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  document.addEventListener('keydown', esc, true);
  toolMenu = {
    el,
    close: () => {
      el.remove();
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', esc, true);
      toolMenu = null;
    },
  };
}

/** The menu bar next to the search. */
function toolbar(): HTMLElement {
  const button = (tool: string, label: string, title: string, open: (btn: HTMLElement) => void) => {
    const btn: HTMLElement = h(
      'button',
      {
        type: 'button',
        class: 'btn small',
        title,
        'data-tool': tool,
        'aria-haspopup': 'true',
        // Keep the table's selection.
        onMousedown: (e: MouseEvent) => e.preventDefault(),
        onClick: () => open(btn),
      },
      label,
    );
    return btn;
  };
  return h(
    'div',
    { class: 'cbt-tools', role: 'toolbar' },
    button('height', 'Row height ▾', 'Fit row heights to their content', (b) =>
      openToolMenu(b, [
        ['Fit selected row', () => fitHeights(false)],
        ['Fit all rows', () => fitHeights(true)],
        null,
        ['Fit selected rows to same height', () => fitHeights(false, true)],
        ['Fit all rows to same height', () => fitHeights(true, true)],
      ]),
    ),
    button('width', 'Width ▾', 'Fit column widths to their content', (b) =>
      openToolMenu(b, [
        ['Fit to selected cells', () => fitWidths(false)],
        ['Fit all columns', () => fitWidths(true)],
      ]),
    ),
    button('wrap', 'Text wrapping ▾', 'Wrap long text onto several lines', (b) =>
      openToolMenu(b, [
        ['Wrap text in selected cells', () => setWrap(false, true)],
        ['Don’t wrap text in selected cells', () => setWrap(false, false)],
        null,
        ['Wrap text in all cells', () => setWrap(true, true)],
        ['Don’t wrap text in any cell', () => setWrap(true, false)],
      ]),
    ),
    // The selected codes' color, and minimizing the parent levels' descriptions.
    view!.colorBtn,
    view!.descBtn,
    h('button', { type: 'button', class: 'btn small cbt-toggle', 'data-tool': 'merge', onMousedown: (e: MouseEvent) => e.preventDefault(), onClick: toggleMerged }, 'Merged view'),
  );
}

/**
 * Marks cells beyond what jspreadsheet renders (also when the table did not need to be
 * refilled): a parent's cells in consecutive rows as one merged cell, the number of coded
 * segments in name cells, flags on unapplied edits, and the empty parent levels of drafts.
 */
function markCells() {
  if (!view) return;
  const { ws, issues, levels } = view;
  const total = (ws.getData() as unknown[]).length;
  // Heights are kept by code (ui.tableHeights), not by jspreadsheet's row numbers: it would give
  // them to the rows it creates at those numbers later (after reordering: other codes).
  ws.options.rows = [];
  // Empty cells in an inserted level are not missing parents.
  const inserted = new Set(Array.from({ length: levels }, (_, k) => k).filter(isInsertedColumn));
  /** Whether level `k`'s cells in row `y` are part of a merged block (its code also in the row above or below). */
  const mergedAt = (k: number, y: number) => {
    const id = ui.tableMerged ? rowAt(y)?.ids[k] : undefined;
    return !!id && (rowAt(y - 1)?.ids[k] === id || rowAt(y + 1)?.ids[k] === id);
  };
  /** Whether a merged block of level `k` starts in row `y` or ends in the row above it. */
  const blockEdgeAt = (k: number, y: number) =>
    rowAt(y)?.ids[k] !== rowAt(y - 1)?.ids[k] && (mergedAt(k, y) || mergedAt(k, y - 1));
  for (let y = 0; y < total; y++) {
    const row = rowAt(y);
    const draft = row ? undefined : draftAt(y);
    const line = lines()[y];
    const rowKey = line ? keyOf(line) : '';
    const tr = ws.getCellFromCoords(0, y)?.parentElement;
    // Not while its height is being dragged (jspreadsheet keeps the new height in the attribute until the mouse is released).
    if (tr && !tr.classList.contains('resizing')) {
      const height = ui.tableHeights[rowKey] ?? ui.tableHeights[ALL_ROWS];
      tr.style.height = height ? `${height}px` : '';
      // Left by a drag: it would keep the row at least that tall, also after fitting it to its content.
      tr.removeAttribute('height');
    }
    const issue = row ? issues.get(row.id) : undefined;
    const names = draft ? namesOf(draft.cells, levels) : undefined;
    for (let x = 0; x < 2 * levels; x++) {
      const cell = ws.getCellFromCoords(x, y);
      if (!cell) continue;
      const k = levelOf(x);
      // Colors here too: jspreadsheet renders a pasted cell before its row is known.
      if (isNameCol(x, levels)) paintCell(cell, k, y);
      // An empty cell before a code created with its parents to be typed later.
      const unparentedAt = row ? row.ids.findIndex((id) => !!id && view!.unparented.has(id)) : -1;
      const missing =
        (!!names && isNameCol(x, levels) && k < lastFilled(names) && !names[k].trim() && !inserted.has(k)) ||
        (unparentedAt > 0 && isNameCol(x, levels) && k < unparentedAt && !row!.ids[k]);
      // A row that is an existing parent code: its subcode comes next.
      const subcodeNext = !!draft?.subcodeOf && !draft.message && isNameCol(x, levels) && k === lastFilled(names!) + 1;
      const flagged = !!issue?.cells.has(x) || (!!draft?.message && isNameCol(x, levels) && k === lastFilled(names!));
      cell.classList.toggle('cbt-missing', missing || subcodeNext);
      if (missing || subcodeNext) cell.dataset.hint = missing ? 'parent code?' : 'subcode?';
      else delete cell.dataset.hint;
      cell.classList.toggle('cbt-issue', flagged);
      if (flagged) cell.title = issue?.message ?? draft!.message!;
      else if (missing) cell.title = 'Type the parent code here (an existing code or a new one).';
      else if (subcodeNext) cell.title = `Type a new subcode of “${codeById(draft!.subcodeOf!)?.name ?? ''}” here.`;
      else cell.removeAttribute('title');
      // The same code as in the row above (below): shown as one merged cell (separate rows on hover).
      const id = row?.ids[k];
      const merge = !!id && ui.tableMerged;
      const cont = merge && rowAt(y - 1)?.ids[k] === id;
      const next = merge && rowAt(y + 1)?.ids[k] === id;
      cell.classList.toggle('cbt-merge-cont', cont);
      cell.classList.toggle('cbt-merge-next', next);
      // The block's text in its middle row (with an even number of rows: at the bottom of the
      // upper middle one, i.e. at the block's center).
      let label = false;
      let low = false;
      if (cont || next) {
        let top = y;
        while (rowAt(top - 1)?.ids[k] === id) top--;
        let bottom = y;
        while (rowAt(bottom + 1)?.ids[k] === id) bottom++;
        const middle = top + Math.floor((bottom - top) / 2);
        label = y === middle;
        low = label && (bottom - top) % 2 === 1;
      }
      cell.classList.toggle('cbt-merged', cont || next);
      // A thicker line above and below a block, going on over its subcodes' columns (the deeper levels).
      cell.classList.toggle('cbt-edge-top', Array.from({ length: k + 1 }, (_, j) => j).some((j) => blockEdgeAt(j, y)));
      cell.classList.toggle('cbt-merge-label', label);
      // The cells of a merged block whose text does not show (it shows in the middle row) wrap
      // only when set to: by default, a long text does not make each of the block's rows as tall.
      const wrap = isWrapped(rowKey, x, (cont || next) && !label);
      cell.classList.toggle('cbt-wrap', wrap);
      cell.classList.toggle('cbt-nowrap', !wrap);
      cell.classList.toggle('cbt-merge-low', low);
      const count = id && isNameCol(x, levels) ? (row!.segments[k] ?? 0) : 0;
      if (count) cell.dataset.count = String(count);
      else delete cell.dataset.count;
    }
  }
}

// ---------- showing the codebook ----------

function build(host: HTMLElement, levels: number): Worksheet {
  host.replaceChildren();
  const [ws] = jspreadsheet(host as HTMLDivElement, {
    worksheets: [
      {
        data: dataOf(levels),
        columns: columns(levels),
        minDimensions: [2 * levels + 1, 1],
        minSpareRows: SPARE_ROWS,
        tableOverflow: true,
        tableHeight: '100%',
        tableWidth: '100%',
        search: true,
        allowInsertColumn: false,
        allowDeleteColumn: false,
        allowRenameColumn: false,
        columnDrag: false,
        rowDrag: true,
        allowInsertRow: true,
        allowManualInsertRow: false,
        allowDeleteRow: true,
        columnSorting: false,
      },
    ],
    parseFormulas: false,
    onafterchanges: onEdits,
    onbeforepaste: (_ws, data, col, row) => {
      onBeforePaste(data, Number(col), Number(row));
      return undefined;
    },
    // jspreadsheet creates the editor's input after this event: a text area (not a one-line
    // input) when its column wraps, so the column wraps until then.
    oneditionstart: (ws, td, x, y) => {
      const col = ws.options.columns?.[Number(x)];
      if (col) col.wordWrap = true;
      setTimeout(() => {
        if (col) col.wordWrap = false;
        popOutEditor(td);
        onEditionStart(ws, td, Number(x), Number(y));
      });
    },
    // A choice left over from an edit that changed nothing must not apply to a later change of the cell.
    oneditionend: (_ws, td, x, y) => {
      td.style.height = '';
      followEditor = null;
      closeSuggestions();
      setTimeout(() => choices.delete(`${x},${y}`));
    },
    onmoverow: (ws) => onMoveRow(ws),
    // Deleting rows deletes their codes (after asking); the table then shows the codebook again.
    onbeforedeleterow: (_ws, removed) => {
      deleteRows(removed);
      return false;
    },
    contextMenu: (ws, x, y, e, items, role) => contextMenu(ws, x, y, e, items, role),
    onselection: (ws) => {
      if (view) {
        view.selectedIds = selectedCodeIds(ws);
        view.selection = ws.getSelection() as [number, number, number, number] | null;
        updateColorButton();
        revealSelectedCode();
      }
    },
    // Widths and heights set by hand are kept (also when the table is opened again).
    onresizecolumn: (_ws, cols, widths) => {
      if (!view || settingWidths) return;
      const list = Array.isArray(cols) ? cols : [cols];
      list.forEach((x, i) => {
        if (!isMinimized(Number(x), view!.levels)) ui.tableWidths[columnKey(Number(x), view!.levels)] = Math.round(Number(Array.isArray(widths) ? widths[i] : widths));
      });
      saveUI();
    },
    onresizerow: (_ws, y, height) => {
      const line = view && lines()[Number(y)];
      if (!line) return;
      ui.tableHeights[keyOf(line)] = Math.round(Number(height));
      commitUI();
    },
  });
  host.querySelector('.jss_filter')?.prepend(toolbar());
  // Scrolling keeps an open editor (jspreadsheet's own handler would close it; it does nothing
  // else without lazy loading and frozen columns): the editor follows its cell.
  const content = (ws as Worksheet & { content?: HTMLElement }).content;
  if (content) content.onscroll = () => followEditor?.();
  // The search runs as you type (jspreadsheet starts it from keys, which it does not get; see onKeyDown).
  const search = host.querySelector<HTMLInputElement>('.jss_search');
  let searchTimer = 0;
  search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => view?.ws.search(search.value), 200);
  });
  setTimeout(updateMergeButton);
  return ws;
}

/** Rebuilds the table (when the number of levels changes), keeping the drafts' cells per level. */
function rebuild(levels: number) {
  if (!view) return;
  const old = view.levels;
  view.drafts = view.drafts.map((d) => ({ ...d, cells: Array.from({ length: 2 * levels }, (_, x) => (x < 2 * old ? (d.cells[x] ?? '') : '')) }));
  view.levels = levels;
  // The new table keeps the old one's scroll position and selection (the view does not jump).
  const content = view.host.querySelector<HTMLElement>('.jss_content');
  const scroll = content ? [content.scrollTop, content.scrollLeft] : null;
  const sel = view.ws.getSelection() as [number, number, number, number] | null;
  const wasCurrent = jspreadsheet.current === view.ws;
  syncing = true;
  view.ws = build(view.host, levels);
  syncing = false;
  applyColumnWidths();
  markCells();
  const next = view.host.querySelector<HTMLElement>('.jss_content');
  if (next && scroll) [next.scrollTop, next.scrollLeft] = scroll;
  if (sel) {
    if (wasCurrent) jspreadsheet.current = view.ws;
    const max = 2 * levels - 1;
    view.ws.updateSelectionFromCoords(Math.min(sel[0], max), sel[1], Math.min(sel[2], max), sel[3]);
    // Selecting scrolls the cell into view; the position stays as it was.
    if (next && scroll) [next.scrollTop, next.scrollLeft] = scroll;
  }
}

/** Shows the codebook's current state: refills the table if it differs (keeping the selection and scroll position). */
function refresh() {
  if (!view) return;
  // Not while a cell is being edited (also while jspreadsheet reports the edit's change): again once it is done.
  if (view.ws.edition) {
    setTimeout(refresh, 30);
    return;
  }
  const rows = shownRows();
  const colors = (list: CodebookRow[]) => list.map((r) => r.colors.join()).join('|');
  // Undone or redone: the layout the table had in that state.
  const state = projectState();
  if (historyRestores() !== seenRestores) {
    seenRestores = historyRestores();
    const saved = layouts.get(state);
    if (saved) {
      view.order = [...saved.order];
      view.drafts = saved.drafts.map((d) => ({ ...d, cells: [...d.cells], choices: d.choices && [...d.choices] }));
      view.pinned = new Map(saved.pinned);
    }
  }
  reconcileOrder(rows);
  layouts.delete(state);
  layouts.set(state, { order: view.order, drafts: view.drafts, pinned: new Map(view.pinned) });
  if (layouts.size > LAYOUTS_KEPT) layouts.delete(layouts.keys().next().value!);
  const colorsSame = colors(rows) === colors(view.rows);
  view.rows = rows;
  // Unapplied edits of codes that are gone are gone too.
  for (const id of view.issues.keys()) if (!rows.some((r) => r.id === id)) view.issues.delete(id);
  view.selectedIds = view.selectedIds.filter((id) => codeById(id));
  updateColorButton();
  const levels = levelsNeeded(view.drafts, view.levels);
  if (levels !== view.levels) {
    rebuild(levels);
    return updateDescButton();
  }
  const data = dataOf(levels);
  // The table shows the rows plus the empty rows below them when it is up to date.
  const shown = view.ws.getData() as jspreadsheet.CellValue[][];
  const same =
    colorsSame &&
    shown.length === data.length + SPARE_ROWS &&
    shown.slice(data.length).every((r) => r.every((v) => String(v ?? '') === '')) &&
    data.every((r, y) => r.every((v, x) => String(v) === String(shown[y][x] ?? '')));
  if (same) return markCells();
  const scroller = view.host.querySelector<HTMLElement>('.jss_content');
  const top = scroller?.scrollTop ?? 0;
  const sel = view.ws.getSelection();
  const left = scroller?.scrollLeft ?? 0;
  syncing = true;
  view.ws.setData(data);
  syncing = false;
  if (sel) view.ws.updateSelectionFromCoords(...sel);
  // Rows get their heights (wrapped descriptions, merged cells) here: only then is the table as
  // tall as before, so the scroll position is set after it (set before, near the end of the
  // table it would be cut to the shorter table's, and the view would move up).
  markCells();
  if (scroller) {
    scroller.scrollTop = top;
    scroller.scrollLeft = left;
  }
}

// ---------- the Color menu ----------

let colorMenu: { el: HTMLElement; close: () => void } | null = null;

/** The Color button shows the selected codes' color (if they share one) and is off without a selection. */
function updateColorButton() {
  if (!view) return;
  const colors = new Set(view.selectedIds.map((id) => codeById(id)?.color));
  const swatch = view.colorBtn.querySelector<HTMLElement>('.cbt-color-swatch')!;
  swatch.style.background = colors.size === 1 ? [...colors][0]! : 'transparent';
  swatch.classList.toggle('mixed', colors.size > 1);
  const n = view.selectedIds.length;
  view.colorBtn.disabled = !n;
  view.colorBtn.title = n ? `Change the color of the ${n === 1 ? 'selected code' : `${n} selected codes`}` : 'Select codes (rows) in the table to change their color';
}

function closeColorMenu() {
  colorMenu?.close();
}

/** A menu below the Color button: palette, custom color, and whether subcodes get the color too. */
function openColorMenu(anchor: HTMLElement) {
  if (!view) return;
  if (colorMenu) return closeColorMenu();
  const ids = [...view.selectedIds];
  if (!ids.length) return;
  const withSubcodes = h('input', { type: 'checkbox' });
  const subcodes = new Set(ids.flatMap((id) => subtreeOf(id).map((c) => c.id)).filter((id) => !ids.includes(id)));
  const apply = (color: string) => {
    recolorCodesTo(withSubcodes.checked ? [...ids, ...subcodes] : ids, color);
    closeColorMenu();
  };
  const current = ids.length === 1 ? codeById(ids[0])?.color : undefined;
  const custom = h('input', { type: 'color', class: 'swatch-input', value: current ?? PALETTE[0], title: 'Any color' });
  custom.addEventListener('change', () => apply(custom.value));
  const el = h(
    'div',
    { class: 'cbt-color-menu', role: 'menu' },
    h('div', { class: 'cbt-color-title muted' }, ids.length === 1 ? `Color of “${codeById(ids[0])?.name}”` : `Color of ${ids.length} codes`),
    h(
      'div',
      { class: 'cbt-palette' },
      ...PALETTE.map((c) =>
        h('button', {
          type: 'button',
          class: 'cbt-palette-swatch' + (c === current ? ' on' : ''),
          style: { background: c },
          title: c,
          'aria-label': `Color ${c}`,
          onClick: () => apply(c),
        }),
      ),
    ),
    h('label', { class: 'cbt-color-row' }, custom, ' Other color…'),
    subcodes.size
      ? h('label', { class: 'cbt-color-row' }, withSubcodes, ` Also its ${subcodes.size} subcode${subcodes.size === 1 ? '' : 's'}`)
      : null,
  );
  const r = anchor.getBoundingClientRect();
  el.style.top = `${r.bottom + 4}px`;
  el.style.left = `${Math.max(8, r.right - 220)}px`;
  document.body.append(el);
  // Clicks outside close it; clicks inside (e.g. on the color picker) do not.
  const outside = (e: MouseEvent) => {
    if (!el.contains(e.target as Node) && e.target !== anchor) closeColorMenu();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeColorMenu();
  };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  document.addEventListener('keydown', esc, true);
  colorMenu = {
    el,
    close: () => {
      el.remove();
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('keydown', esc, true);
      colorMenu = null;
    },
  };
}

// ---------- opening and closing ----------

// Undo and redo in the table are the app's undo and redo (the table's own history would get out
// of step with the codebook). Delete or Backspace on selected rows deletes them right away
// (jspreadsheet would ask first).
function onKeyDown(e: KeyboardEvent) {
  if (!view || jspreadsheet.current !== view.ws) return;
  if (view.ws.edition) {
    // Alt+Enter (or Ctrl/⌘+Enter) starts a new line in a description (as in Google Sheets); names are one line.
    const ed = e.target instanceof HTMLTextAreaElement && e.target.classList.contains('cbt-editor') ? e.target : null;
    if (ed && e.key === 'Enter' && (e.altKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (isNameCol(Number(view.ws.edition[2]), view.levels)) return;
      ed.setRangeText('\n', ed.selectionStart, ed.selectionEnd, 'end');
      ed.dispatchEvent(new Event('input'));
    }
    return;
  }
  // Typing in a text field (e.g. the table's search): its keys are its own. jspreadsheet would
  // take them for the selected cells (open an editor, delete rows), so it does not get them.
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]') && !e.target.classList.contains('jss_textarea')) {
    e.stopImmediatePropagation();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && (view.ws as Worksheet & { selectedRow?: unknown }).selectedRow != null) {
    e.preventDefault();
    e.stopImmediatePropagation();
    view.ws.deleteRow();
    return;
  }
  // Enter on a selected cell edits it, keeping its text (jspreadsheet would go to the next cell).
  // Enter while editing still applies the edit and goes down.
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const at = (view.ws as Worksheet & { selectedCell?: number[] | null }).selectedCell;
    const cell = at ? view.ws.getCellFromCoords(Number(at[0]), Number(at[1])) : null;
    if (cell) {
      e.preventDefault();
      e.stopImmediatePropagation();
      view.ws.openEditor(cell, false);
    }
    return;
  }
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'x') {
    e.preventDefault();
    e.stopImmediatePropagation();
    cutCells(view.ws);
    return;
  }
  if (key !== 'z' && key !== 'y') return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (key === 'z' && !e.shiftKey) undoChange();
  else redoChange();
}

let hovered: HTMLElement[] = [];

/** Hovering a merged-looking block of a parent's cells: shows them as the separate rows they are. */
function onHover(e: MouseEvent) {
  const td = e.target instanceof Element ? e.target.closest<HTMLElement>('tbody td[data-x]') : null;
  if (hovered.includes(td!)) return;
  hovered.forEach((c) => c.classList.remove('cbt-merge-hover'));
  hovered = [];
  if (!view || !td || !(td.classList.contains('cbt-merge-cont') || td.classList.contains('cbt-merge-next'))) return;
  const x = Number(td.dataset.x);
  const y = Number(td.dataset.y);
  const k = levelOf(x);
  const id = rowAt(y)?.ids[k];
  let top = y;
  while (rowAt(top - 1)?.ids[k] === id) top--;
  for (let at = top; rowAt(at)?.ids[k] === id; at++) {
    const cell = view.ws.getCellFromCoords(x, at);
    if (cell) hovered.push(cell);
  }
  hovered.forEach((c) => c.classList.add('cbt-merge-hover'));
}

/** Starting to drag the fill handle: remembers the cells it fills from (see `fill`). */
function onMouseDown(e: MouseEvent) {
  if (!view || !(e.target instanceof Element) || !e.target.classList.contains('jss_corner') || !view.host.contains(e.target)) return;
  const sel = view.ws.getSelection();
  fill = sel ? cellsOf(view.ws, sel as [number, number, number, number]) : null;
  // A drag that fills nothing leaves no change to clear it.
  document.addEventListener('mouseup', () => setTimeout(() => (fill = null)), { once: true, capture: true });
}

export function openCodebookTable() {
  if (view) return;
  const layout = document.querySelector<HTMLElement>('.layout')!;
  const viewer = document.getElementById('viewer')!;
  const host = h('div', { class: 'cbt-host' });
  const colorBtn = h(
    'button',
    {
      type: 'button',
      class: 'btn small cbt-color-btn',
      'aria-haspopup': 'true',
      // Keep the table's selection (and an open editor) when the menu opens.
      onMousedown: (e: MouseEvent) => e.preventDefault(),
      onClick: (e: MouseEvent) => {
        e.stopPropagation();
        openColorMenu(colorBtn);
      },
    },
    h('span', { class: 'swatch cbt-color-swatch' }),
    'Color ▾',
  );
  const descBtn = h('button', { type: 'button', class: 'btn small', onClick: toggleParentDescriptions });
  const el = h(
    'section',
    { class: 'codebook-table' },
    h(
      'div',
      { class: 'cbt-head' },
      h('strong', {}, 'Codebook table'),
      h(
        'span',
        {
          class: 'muted cbt-hint grow',
          title:
            'One row per code without subcodes, with its parent codes before it; each level is followed by that code’s description, and a parent’s cells over several rows look like one merged cell. ' +
            'Each level cell is that code: editing it renames the code, editing a description cell describes it. Type in an empty row to add a code (missing parents are created), or in the free level after a code to add a subcode. ' +
            'Drag a row by the ⋮ next to its number to reorder; right-click for adding, coloring and deleting codes. To move a code to another parent, drag it in the codebook. ' +
            'Paste from a spreadsheet works too. Changes that cannot be applied keep a red flag (hover for why) until they are fixed.',
        },
        'One row per code without subcodes; a parent spans its subcodes’ rows. Edit a name to rename that code; drag ⋮ to reorder; right-click for more. Hover for details.',
      ),
      h('button', { type: 'button', class: 'btn small', title: 'Add a code at the top level', onClick: () => addCode(null, false) }, '+ Code'),
      h('button', { type: 'button', class: 'btn small', title: 'Back to the text', onClick: () => void requestCloseCodebookTable() }, 'Close table'),
    ),
    host,
  );
  // In the text's place (and order) in the layout.
  el.style.order = viewer.style.order;
  layout.append(el);
  layout.classList.add('table-open');
  // No inserted levels yet: codes in their levels' columns.
  const rows = shownRows();
  const levels = Math.max(1, ...rows.map((r) => r.ids.length));
  view = {
    el,
    host,
    ws: null as unknown as Worksheet,
    levels,
    rows,
    pinned: new Map(),
    unparented: new Set(),
    issues: new Map(),
    drafts: [],
    order: rows.map((r) => r.id),
    slots: new Map(),
    anchor: null,
    selection: null,
    minLevels: 0,
    selectedIds: [],
    colorBtn,
    descBtn,
    stop: () => { },
  };
  updateColorButton();
  updateDescButton();
  view.ws = build(host, levels);
  // Undo and redo from here on bring back the table's layouts (see layouts).
  seenRestores = historyRestores();
  layouts.set(projectState(), { order: view.order, drafts: view.drafts, pinned: new Map() });
  applyColumnWidths();
  markCells();
  const unsubscribe = subscribe(refresh);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('mousedown', onMouseDown, true);
  host.addEventListener('mouseover', onHover);
  host.addEventListener('mouseleave', onHover);
  document.addEventListener('copy', onClipboardCopy, true);
  document.addEventListener('paste', onClipboardPaste, true);
  view.stop = () => {
    unsubscribe();
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('copy', onClipboardCopy, true);
    document.removeEventListener('paste', onClipboardPaste, true);
  };
  openListeners.forEach((f) => f(true));
}

/** Closes the table, after asking if rows still have problems (their unapplied cells are then lost). */
export async function requestCloseCodebookTable(): Promise<boolean> {
  const n = unresolved();
  if (n) {
    const ok = await confirmAction(
      `${n === 1 ? 'One row has' : `${n} rows have`} changes that could not be applied yet (marked with a red flag, or a missing parent code). Hover over a flag to see why. If you close the table now, these changes are lost.`,
      { title: 'Close with unresolved problems?', confirm: 'Close and discard them', cancel: 'Keep editing', danger: true },
    );
    if (!ok) return false;
  }
  closeCodebookTable();
  return true;
}

export function closeCodebookTable() {
  if (!view) return;
  closeColorMenu();
  closeToolMenu();
  closeSuggestions();
  choices.clear();
  pasting = null;
  layouts.clear();
  view.stop();
  jspreadsheet.destroy(view.host as jspreadsheet.JspreadsheetInstanceElement, true);
  view.el.remove();
  document.querySelector('.layout')?.classList.remove('table-open');
  view = null;
  openListeners.forEach((f) => f(false));
}