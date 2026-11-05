// The codebook as a table (the spreadsheet view): one row per code without subcodes, with the
// codes from the top level down to it in level columns, each followed by that code's
// description (Level 1 | Description 1 | Level 2 | Description 2 | …). A parent code appears in
// the rows of all its subcodes (the table shows those cells as one merged cell). Each level cell
// stands for the code at that level: editing it renames that code, editing a description cell
// describes it. Rows without a code (new rows) create codes under the parents they name.
// A name that a code at that level has stands for that code (so pasting or filling down a
// parent's cell puts rows under that same parent); a new code of an existing name is made only
// on request, and a copied code without subcodes is named "name (2)". Edits are applied as one
// undo step. Names may repeat: codes are identified by their ids (GUIDs in REFI-QDA exports).

import { byOrder } from './codeOrder';
import { childCodes, codeById, codeChain, codesInTreeOrder, nextColor, nextOrder, removeCode, reparent, segmentCounts } from './codes';
import { commit, project, ui } from './state';
import type { Code } from './types';
import { byName, now, uid } from './util';

export interface CodebookRow {
  /** The code of the row (one without subcodes). */
  id: string;
  /** The codes from the top level down to it. */
  ids: string[];
  /** Their names, colors (the table tints each level's cell with its code's color) and descriptions. */
  path: string[];
  colors: string[];
  descriptions: string[];
  /** Their numbers of coded segments. */
  segments: number[];
}

/** As many level columns as the deepest code has levels (at least one). */
export function tableLevels(): number {
  return Math.max(1, ...codesInTreeOrder().map((c) => codeChain(c).length));
}

/**
 * Codes depth-first, siblings sorted as in the codebook: by name, or in the custom order (also
 * for "last edited", which would move a row whenever it is edited).
 */
function rowOrder(parentId: string | null = null, depth = 0): Code[] {
  if (depth > 100) return [];
  return childCodes(parentId)
    .sort(ui.codeSort === 'name' ? byName : byOrder)
    .flatMap((c) => [c, ...rowOrder(c.id, depth + 1)]);
}

/** The codebook as rows: one per code without subcodes, in the codebook's order. */
export function codebookRows(): CodebookRow[] {
  const counts = segmentCounts();
  const hasChildren = new Set(project.codes.map((c) => c.parentId).filter(Boolean));
  return rowOrder()
    .filter((c) => !hasChildren.has(c.id))
    .map((c) => {
      const chain = codeChain(c);
      return {
        id: c.id,
        ids: chain.map((x) => x.id),
        path: chain.map((x) => x.name),
        colors: chain.map((x) => x.color),
        descriptions: chain.map((x) => x.description ?? ''),
        segments: chain.map((x) => counts.get(x.id) ?? 0),
      };
    });
}

/**
 * What a typed or pasted name in a level cell stands for, when it was chosen explicitly: an
 * existing code (picked from the suggestions, or a copied parent code), a new code even if the
 * name exists, a copy of a code (see below), or renaming the code in that
 * cell (for all its rows) even to a name another code has. Without a choice, a name that a code
 * at that level has is that code.
 */
/**
 * `replace`: pasted over a cell: in a code's own cell, the code there is replaced (deleted) by
 * the pasted one.
 */
export type CellChoice =
  /** `moveTo`: cut and pasted under another parent: the code moves there first (see the table view). */
  | { id: string; replace?: boolean; moveTo?: string | null }
  /**
   * A new code. `parents`, for a name typed after empty levels (its parents missing): created at
   * the top level with its parents to be typed later ("later"), under placeholder parents
   * ("placeholder"), or kept as a draft until they are typed ("wait"; see the table view).
   */
  | { new: true; color?: string; replace?: boolean; parents?: 'later' | 'placeholder' | 'wait' }
  /**
   * A pasted copy of a code (`from`): a new code that is an identical copy of it (name, color,
   * description, coded segments, subcodes), only with new ids; named "name (2)" if `numbered`.
   */
  | { copy: true; color?: string; from?: string; numbered?: boolean; replace?: boolean }
  | { rename: true };

/** The color a choice brings for a new code (pasted with the copied code's color). */
const colorOf = (choice: CellChoice | undefined) => (choice && ('new' in choice || 'copy' in choice) ? choice.color : undefined);

export interface RowEdit {
  /** The row's codes from the top level down (empty for a new row). */
  ids: string[];
  /** The level cells (names), empty ones included. */
  path: string[];
  /** The level cells before the edit: only changed ones are applied. */
  oldPath?: string[];
  /** Explicit choices for level cells, by level. */
  choices?: (CellChoice | undefined)[];
  /** The description cells, one per level. */
  descriptions: string[];
  /** The description cells before the edit: only changed ones are applied. */
  oldDescriptions?: string[];
  /**
   * Codes to insert between the row's codes (typed into an inserted, empty level): each above the
   * row's code at index `before`, in this order. Applying sets `id` to the code it was (a new
   * code, or an existing one with that name or chosen there).
   */
  inserts?: { before: number; name: string; choice?: CellChoice; description?: string; id?: string }[];
  /** Set when applied to a new row: its codes from the top level down; or the code that replaced the row's code. */
  created?: string[];
  /** Set when the row's code was replaced by an existing code (pasted as that code). */
  replacedBy?: string;
}

/** An edit that could not be applied, by its index in the edits. */
export interface RowProblem {
  edit: number;
  message: string;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const NAME_RULE = 'A code name cannot contain “>”; it separates a code from its subcodes.';
const UNCLEAR = (name: string) => `Several codes at this level are named “${name}”. Type it again and pick the one you mean from the suggestions.`;

/** The codes at a level (0 = top level), i.e. in one level column of the table. */
export const codesAtLevel = (k: number) => project.codes.filter((c) => codeChain(c).length === k + 1);

/** The codes at level `k` named `name`: those under `parentId` if there are any, else all of them. */
function namedAtLevel(name: string, k: number, parentId: string | null): Code[] {
  const all = codesAtLevel(k).filter((c) => sameName(c.name, name));
  const near = all.filter((c) => (c.parentId ?? null) === parentId);
  return near.length ? near : all;
}

const hasChildren = (id: string) => project.codes.some((c) => c.parentId === id);

/** `name`, or "name (2)", "name (3)" … if a sibling under `parentId` (other than `self`) already has it. */
export function freeSiblingName(name: string, parentId: string | null, self?: string): string {
  const taken = (n: string) => childCodes(parentId).some((c) => c.id !== self && sameName(c.name, n));
  if (!taken(name)) return name;
  const base = name.replace(/\s*\(\d+\)$/, '');
  let n = 2;
  while (taken(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

/** `name`, or "name (2)" … if a code at level `k` (other than `self`) already has it: for copies of codes. */
function freeLevelName(name: string, k: number, self?: string): string {
  const taken = (n: string) => codesAtLevel(k).some((c) => c.id !== self && sameName(c.name, n));
  if (!taken(name)) return name;
  const base = name.replace(/\s*\(\d+\)$/, '');
  let n = 2;
  while (taken(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

/**
 * Creates a code under `parentId` (also next to a same-named sibling); subcodes take their top
 * code's color, a top-level code `color` if given.
 */
function newCode(name: string, parentId: string | null, color?: string): Code {
  const top = parentId ? codeChain(codeById(parentId)!)[0] : undefined;
  const code: Code = { id: uid('c'), name: name.trim(), color: top?.color ?? color ?? nextColor(), parentId, order: nextOrder(parentId), updatedAt: now() };
  project.codes.push(code);
  return code;
}

/**
 * Creates an identical copy of code `fromId` under `parentId`, named `name`: its color and
 * description, its coded segments (yours and consolidated ones) and its subcodes, all copied with
 * new ids.
 */
export function copyCode(fromId: string, name: string, parentId: string | null): Code | undefined {
  const source = codeById(fromId);
  if (!source) return undefined;
  // The subtree as it is before copying (the copy may go into it).
  const subtree = new Set(subtreeIds(fromId));
  const copyOne = (from: Code, copyName: string, parent: string | null): Code => {
    const code: Code = { ...from, id: uid('c'), name: copyName.trim(), parentId: parent, order: nextOrder(parent), updatedAt: now() };
    project.codes.push(code);
    for (const s of project.segments.filter((x) => x.codeId === from.id)) project.segments.push({ ...s, id: uid('s'), codeId: code.id });
    for (const [docId, list] of Object.entries(project.consolidations)) {
      const copies = list.filter((x) => x.codeId === from.id).map((x) => ({ ...x, id: uid('s'), codeId: code.id }));
      if (copies.length) project.consolidations[docId] = [...list, ...copies];
    }
    for (const child of project.codes.filter((c) => c.parentId === from.id && subtree.has(c.id))) copyOne(child, child.name, code.id);
    return code;
  };
  return copyOne(source, name, parentId);
}

/** A code and all codes below it. */
function subtreeIds(id: string): string[] {
  return [id, ...project.codes.filter((c) => c.parentId === id).flatMap((c) => subtreeIds(c.id))];
}

/** A copy's name: as copied, or "name (2)" … if it is to be numbered (see CellChoice). */
const copyName = (choice: { numbered?: boolean }, name: string, k: number) => (choice.numbered ? freeLevelName(name, k) : name.trim());

/** Applies the description cells of a row to its codes (only cells that changed, or filled ones of a new row). */
function applyDescriptions(ids: string[], edit: RowEdit): boolean {
  let touched = false;
  ids.forEach((id, k) => {
    const c = codeById(id);
    if (!c) return;
    const text = (edit.descriptions[k] ?? '').trim();
    const before = edit.oldDescriptions ? (edit.oldDescriptions[k] ?? '').trim() : undefined;
    const changed = before === undefined ? !!text : text !== before;
    if (!changed || text === (c.description ?? '')) return;
    c.description = text || undefined;
    c.updatedAt = now();
    touched = true;
  });
  return touched;
}

/**
 * The existing code that a new row's last filled level stands for: a code picked or pasted there
 * (as that same code), or else the only code with subcodes of that name at that level (under the
 * parent named before it, if one is). Such a row is that same code, waiting for a subcode in the
 * next level, not a new code.
 */
export function rowParentCode(path: string[], choices?: (CellChoice | undefined)[]): Code | undefined {
  const cells = path.map((p) => p.trim());
  const last = cells.reduce((l, v, i) => (v ? i : l), -1);
  if (last < 0) return undefined;
  const choice = choices?.[last];
  if (choice) {
    return 'id' in choice ? codeById(choice.id) : undefined;
  }
  const parentName = last ? cells[last - 1] : '';
  const found = codesAtLevel(last).filter(
    (c) => sameName(c.name, cells[last]) && hasChildren(c.id) && (!parentName || sameName(codeById(c.parentId ?? '')?.name ?? '', parentName)),
  );
  return found.length === 1 ? found[0] : undefined;
}

/**
 * A new row: the codes its level cells stand for. Parent levels are existing codes where a code
 * there has the name (or one was chosen), else new codes; the last level is a new code, named
 * "name (2)" if a sibling has its name (unless a new code of that very name was chosen).
 */
function addRow(edit: RowEdit, problem: (m: string) => void): boolean {
  const cells = edit.path.map((p) => p.trim());
  const last = cells.reduce((l, v, i) => (v ? i : l), -1);
  if (last < 0) return false;
  // Plan first, so nothing is created when a level is unclear.
  const plan: ({ id: string } | { create: string; color?: string })[] = [];
  let parentId: string | null = null;
  for (let j = 0; j < last; j++) {
    const choice = edit.choices?.[j];
    if (choice && 'id' in choice && codeById(choice.id)) {
      plan.push({ id: choice.id });
      parentId = choice.id;
      continue;
    }
    const matches: Code[] = choice && !('id' in choice) ? [] : childCodes(parentId).filter((c) => sameName(c.name, cells[j]));
    if (matches.length > 1) return (problem(UNCLEAR(cells[j])), false);
    if (matches.length) {
      plan.push({ id: matches[0].id });
      parentId = matches[0].id;
    } else {
      plan.push({ create: cells[j], color: colorOf(choice) });
      parentId = null;
      // Below a new code, everything is new.
      for (let i = j + 1; i < last; i++) plan.push({ create: cells[i] });
      break;
    }
  }
  let id: string | null = null;
  for (const step of plan) id = 'id' in step ? step.id : newCode(step.create, id, step.color).id;
  const leafChoice = edit.choices?.[last];
  const name =
    leafChoice && 'new' in leafChoice ? cells[last] : leafChoice && 'copy' in leafChoice ? copyName(leafChoice, cells[last], last) : freeSiblingName(cells[last], id);
  const copied = leafChoice && 'copy' in leafChoice && leafChoice.from ? copyCode(leafChoice.from, name, id) : undefined;
  const created = copied ?? newCode(name, id, colorOf(leafChoice));
  edit.created = codeChain(created).map((c) => c.id);
  applyDescriptions(edit.created, edit);
  return true;
}

/**
 * Clears level cells of a row (`ids`, the row's codes): a code this row is the last place of (the
 * row's own code, or a parent with no other subcodes) is deleted, its subcode moving up; from a
 * parent with other subcodes, the row's branch just moves up (out of that parent).
 */
function clearCells(ids: string[], levels: number[]) {
  for (const k of [...levels].sort((a, b) => b - a)) {
    const code = codeById(ids[k]);
    if (!code) continue;
    const child = ids.slice(k + 1).find((id) => codeById(id));
    const last = !project.codes.some((c) => c.parentId === code.id && c.id !== child);
    if (last) removeCode(code.id);
    else if (child) reparent(child, code.parentId ?? null, false, true);
  }
}

/**
 * Inserts codes between a row's codes: each new code (or an existing one under the same parent
 * with that name, or chosen) goes above the code at `before`, which moves under it with its
 * subcodes.
 */
function applyInserts(edit: RowEdit): boolean {
  let touched = false;
  for (const insert of edit.inserts ?? []) {
    const child = codeById(edit.ids[insert.before]);
    const name = insert.name.trim();
    if (!child || !name) continue;
    const parentId = child.parentId ?? null;
    const choice = insert.choice;
    const chosen = choice && 'id' in choice ? codeById(choice.id) : undefined;
    const existing =
      chosen && (chosen.parentId ?? null) === parentId
        ? chosen
        : choice && !('id' in choice)
          ? undefined
          : childCodes(parentId).find((c) => c.id !== child.id && sameName(c.name, name));
    const target = existing ?? newCode(name, parentId, colorOf(choice));
    if (!existing && insert.description?.trim()) target.description = insert.description.trim();
    reparent(child.id, target.id, false, true);
    insert.id = target.id;
    touched = true;
  }
  return touched;
}

/**
 * Applies edited rows to the codebook in one undo step. Each level cell of a row stands for the
 * code at that level:
 * - a parent's cell given the name of another code at that level (or that code chosen) puts
 *   the row's branch under that code; a name no code has renames the parent;
 * - the row's own code given a name its siblings have becomes "name (2)" (unless a new code of
 *   that name was chosen), and given the name of a parent code at that level becomes its subcode.
 * Edits that cannot be applied (an emptied name, ">" in a name, an unclear name) are skipped and
 * reported with the index of the edit, so the table can mark that row.
 */
export function applyRowEdits(edits: RowEdit[]): { changed: number; problems: RowProblem[] } {
  const problems: RowProblem[] = [];
  let changed = 0;
  edits.forEach((edit, index) => {
    const problem = (message: string) => problems.push({ edit: index, message });
    const cells = edit.path.map((p) => p.trim());
    if (cells.some((p) => /[>›]/.test(p))) return problem(NAME_RULE);
    if (!edit.ids.length) {
      if (addRow(edit, problem)) changed++;
      return;
    }

    const old = edit.oldPath ?? [];
    const isChanged = (k: number) => !!edit.choices?.[k] || cells[k] !== (old[k] ?? '').trim();
    const cleared = [...edit.ids.keys()].filter((k) => isChanged(k) && !cells[k]);
    if (cleared.length) {
      clearCells(edit.ids, cleared);
      changed++;
      return;
    }
    const below = cells.slice(edit.ids.length);
    const lastBelow = below.reduce((l, v, i) => (v ? i : l), -1);
    // (Only with something typed below: with all levels below empty, there is no gap.)
    if (lastBelow > 0 && below.slice(0, lastBelow).some((v) => !v)) return problem(`Type the subcode in Level ${edit.ids.length + 1} first.`);
    const pasted = below.findIndex((_, i) => {
      const choice = edit.choices?.[edit.ids.length + i];
      // (Not one moved here already: a cut code pasted after the row's code.)
      return !!choice && 'id' in choice && hasChildren(choice.id) && codeById(choice.id)?.parentId !== edit.ids.at(-1);
    });
    if (pasted >= 0)
      return problem(
        `“${below[pasted]}” is a code with subcodes under another parent: it cannot be a subcode here too. Paste it into the Level ${edit.ids.length + pasted + 1} cell of an empty row (or a row under it), or type a new name.`,
      );
    // Check all levels for unclear names before changing anything.
    const targets = edit.ids.map((id, k) => {
      if (!isChanged(k)) return undefined;
      const choice = edit.choices?.[k];
      if (choice) return 'id' in choice ? (codeById(choice.id) ?? null) : null;
      // A copy is a new name, not another code.
      const found = namedAtLevel(cells[k], k, k ? edit.ids[k - 1] : null).filter((c) => c.id !== id);
      return found.length > 1 ? 'unclear' : (found[0] ?? null);
    });
    const unclear = targets.findIndex((t) => t === 'unclear');
    if (unclear >= 0) return problem(UNCLEAR(cells[unclear]));

    let touched = false;
    let moved = false;
    for (const [k, id] of edit.ids.entries()) {
      const target = targets[k];
      if (target === undefined || target === 'unclear') continue;
      const code = codeById(id)!;
      const isRowCode = k === edit.ids.length - 1;
      const choice = edit.choices?.[k];
      const explicitNew = !!choice && 'new' in choice;
      if (isRowCode && choice && 'replace' in choice && choice.replace) {
        // Pasted over the row's code: the pasted code (or its copy, or a new code of its name) takes its place.
        const parentId = code.parentId ?? null;
        if ('id' in choice) {
          if (choice.id === id) continue;
          edit.replacedBy = choice.id;
        } else if ('copy' in choice && choice.from) {
          edit.created = [copyCode(choice.from, cells[k], parentId)?.id ?? ''];
        } else {
          edit.created = [newCode(cells[k], parentId, colorOf(choice)).id];
        }
        removeCode(id);
        touched = moved = true;
        break;
      }
      if (!isRowCode && choice && 'copy' in choice && choice.from) {
        // A copy pasted over a parent's cell: the row's branch goes under the copy.
        const copy = copyCode(choice.from, cells[k], code.parentId ?? null);
        if (copy) reparent(edit.ids[k + 1], copy.id, false, true);
        touched = moved = true;
        break;
      }
      if (choice && 'copy' in choice) {
        // A pasted code without subcodes: the row's code gets its name, made unique ("name (2)").
        if (isRowCode) {
          code.name = choice.numbered ? freeLevelName(cells[k], k, id) : cells[k];
          code.updatedAt = now();
          touched = true;
        }
        continue;
      }
      if (target && target.id !== id) {
        if (!isRowCode) {
          // The row's branch goes under that code.
          reparent(edit.ids[k + 1], target.id, false, true);
          moved = true;
        } else if (hasChildren(target.id)) {
          // The row's code becomes a subcode of that parent code.
          reparent(id, target.id, false, true);
          moved = true;
        } else {
          code.name = freeSiblingName(cells[k], code.parentId ?? null, id);
          code.updatedAt = now();
        }
        touched = true;
        if (moved) break;
        continue;
      }
      if (explicitNew && !isRowCode) {
        // A new code of that name in this row only: the row's branch goes under it.
        reparent(edit.ids[k + 1], newCode(cells[k], k ? edit.ids[k - 1] : null, colorOf(choice)).id, false, true);
        touched = moved = true;
        break;
      }
      if (code.name !== cells[k]) {
        code.name = cells[k];
        code.updatedAt = now();
        touched = true;
      }
    }
    if (!moved) {
      // Names typed into the free levels after the row's code: new subcodes of it.
      let parentId = edit.ids.at(-1)!;
      const ids = [...edit.ids];
      for (const [i, name] of below.slice(0, lastBelow + 1).entries()) {
        const k = edit.ids.length + i;
        const choice = edit.choices?.[k];
        // A code already there (moved there by pasting a cut): that code.
        const there = choice && 'id' in choice ? codeById(choice.id) : undefined;
        if (there && (there.parentId ?? null) === parentId) {
          parentId = there.id;
          ids.push(parentId);
          touched = true;
          continue;
        }
        const copied = choice && 'copy' in choice && choice.from ? copyCode(choice.from, copyName(choice, name, k), parentId) : undefined;
        parentId = (copied ?? newCode(choice && 'copy' in choice ? copyName(choice, name, k) : name, parentId)).id;
        ids.push(parentId);
        touched = true;
      }
      if (applyDescriptions(ids, edit)) touched = true;
    }
    if (applyInserts(edit)) touched = true;
    if (touched) changed++;
  });
  // Also when nothing changed: listeners re-render, so the table shows the codebook as it is.
  commit();
  return { changed, problems };
}

/**
 * Sets the codes' custom order from the order of their rows (e.g. after a row was dragged): each
 * code's position among its siblings follows its row's position. Parents stay as they are (they
 * are given by a row's level cells). Switches the codebook to the custom order, so the new order
 * is what both the codebook and the table show. Returns whether the order changed.
 */
export function reorderAsRows(ids: string[]): boolean {
  const position = new Map(ids.map((id, i) => [id, i]));
  const groups = new Map<string | null, Code[]>();
  for (const c of codesInTreeOrder()) {
    const key = c.parentId ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  let changed = false;
  for (const siblings of groups.values()) {
    const sorted = [...siblings].sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity));
    sorted.forEach((c, i) => {
      if (c.order !== i) {
        c.order = i;
        changed = true;
      }
    });
  }
  const sortChanged = ui.codeSort !== 'custom';
  ui.codeSort = 'custom';
  commit();
  return changed || sortChanged;
}
