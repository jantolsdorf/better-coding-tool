// User actions on the codebook: creating, editing, nesting, merging and deleting codes.

import {
  codeById,
  createCode,
  deleteAllCodes,
  deleteCode,
  deleteCodes,
  findChildCode,
  findCodeByPath,
  mergeCode,
  mergeCodes,
  moveCodes,
  recolorCodes,
  setCodeParent,
  setSubtreeColor,
  splitCodePath,
  subtreeOf,
  updateCode,
} from '../model/codes';
import { allConsolidated } from '../model/layers';
import { commitUI, project, ui } from '../model/state';
import type { Code, UIState } from '../model/types';
import { focusSegment } from '../view/document/textView';
import { confirmAction, ask, notify, toast } from '../view/feedback';

export function addCodeFromPrompt() {
  const name = ask('New code name (use “Parent > Child” to create a subcode):');
  const parts = splitCodePath(name ?? '');
  if (!parts.length) return;
  if (findCodeByPath(parts)) return notify(`“${parts.join(' > ')}” already exists.`);
  createCode(name!);
}

/**
 * Moves a dragged code under another code (null = top level) and explains why when that is not
 * possible. As a subcode it takes its new parent's color, like subcodes created by typing.
 */
export function moveCode(id: string, parentId: string | null) {
  // Show the new subcode by expanding its parent.
  if (parentId) ui.collapsedCodes = ui.collapsedCodes.filter((x) => x !== parentId);
  const code = codeById(id);
  const parent = parentId ? codeById(parentId) : undefined;
  const recolors = !!code && !!parent && subtreeOf(id).some((c) => c.color.toLowerCase() !== parent.color.toLowerCase());
  const res = setCodeParent(id, parentId, { adoptParentColor: true });
  if (res === 'ok' && recolors) toast(`“${code!.name}” now has the color of “${parent!.name}”. Undo keeps its own color.`, 4500);
  if (res === 'cycle') toast('A code cannot become a subcode of its own subcode.');
  if (res === 'duplicate') {
    const where = parentId ? `“${codeById(parentId)?.name}” already has a subcode` : 'There is already a top-level code';
    toast(`${where} named “${codeById(id)?.name}”. Drop on “Merge” to combine them instead.`, 5000);
  }
}

/** Merges a dragged code into another after confirmation. */
export function mergeDroppedCode(fromId: string, intoId: string) {
  const from = codeById(fromId);
  const into = codeById(intoId);
  if (!from || !into) return;
  const n = project.segments.filter((s) => s.codeId === from.id).length;
  if (confirmAction(`Merge “${from.name}” into “${into.name}”?\n\nIts ${n} segment(s) and any subcodes move to “${into.name}”, and “${from.name}” is removed.`)) {
    mergeCode(from.id, into.id);
  }
}

/** Merges a code into another from the code details dialog; returns whether it was merged. */
export function mergeCodeInteractive(code: Code, targetId: string): boolean {
  const target = codeById(targetId);
  if (!target) return false;
  if (!confirmAction(`Merge “${code.name}” into “${target.name}”? All segments and subcodes move to “${target.name}” and “${code.name}” is removed.`)) {
    return false;
  }
  mergeCode(code.id, target.id);
  return true;
}

/** Deletes a code after confirmation; returns whether it was deleted. */
export function deleteCodeInteractive(code: Code, segments: number): boolean {
  if (!confirmAction(`Delete code “${code.name}” and remove it from ${segments} segment(s)?`)) return false;
  deleteCode(code.id);
  return true;
}

/** Deletes the whole codebook, and with it your coded segments, after confirmation. */
export function deleteCodebookInteractive() {
  const codes = project.codes.length;
  if (!codes) return toast('The codebook is already empty.');
  const segments = project.segments.length;
  const consolidated = allConsolidated().length;
  const removes = [
    segments ? `${segments} coded segment${segments === 1 ? '' : 's'}` : '',
    consolidated ? `${consolidated} consolidated segment${consolidated === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const question =
    `Delete the whole codebook (${codes} code${codes === 1 ? '' : 's'})?` +
    (removes.length ? `\n\nThis also removes your ${removes.join(' and ')}.` : '') +
    '\nDocuments, memos and other coders’ coding are kept. You can undo this (⌘Z / Ctrl+Z).';
  if (!confirmAction(question)) return;
  deleteAllCodes();
  ui.collapsedCodes = [];
  commitUI();
  toast(`Deleted ${codes} code${codes === 1 ? '' : 's'}.`);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Moves several codes under another code (null = top level), like dragging each of them. */
export function moveCodesTo(ids: string[], parentId: string | null) {
  if (parentId) ui.collapsedCodes = ui.collapsedCodes.filter((x) => x !== parentId);
  const res = moveCodes(ids, parentId);
  const problems = [
    res.cycle ? `${plural(res.cycle, 'code')} cannot become a subcode of ${res.cycle === 1 ? 'its' : 'their'} own subcode` : '',
    res.duplicate ? `${plural(res.duplicate, 'code')} already exist${res.duplicate === 1 ? 's' : ''} there with the same name (merge instead)` : '',
  ].filter(Boolean);
  if (problems.length) toast(`Moved ${res.moved}; ${problems.join('; ')}.`, 5000);
}

/** Merges several codes into another after confirmation; returns whether they were merged. */
export function mergeCodesInteractive(ids: string[], intoId: string): boolean {
  const into = codeById(intoId);
  const from = ids.filter((id) => id !== intoId);
  if (!into || !from.length) return false;
  const n = project.segments.filter((s) => from.includes(s.codeId)).length;
  if (!confirmAction(`Merge ${plural(from.length, 'code')} into “${into.name}”?\n\nTheir ${plural(n, 'segment')} and any subcodes move to “${into.name}”, and the merged codes are removed.`)) {
    return false;
  }
  mergeCodes(from, intoId);
  return true;
}

/** Deletes several codes after confirmation; returns whether they were deleted. */
export function deleteCodesInteractive(ids: string[]): boolean {
  const n = project.segments.filter((s) => ids.includes(s.codeId)).length;
  const question =
    `Delete ${plural(ids.length, 'code')}${n ? ` and remove ${n === 1 ? 'it' : 'them'} from ${plural(n, 'segment')}` : ''}?` +
    '\nSubcodes that are not selected move up one level. You can undo this (⌘Z / Ctrl+Z).';
  if (!confirmAction(question)) return false;
  deleteCodes(ids);
  return true;
}

export function recolorCodesTo(ids: string[], color: string) {
  recolorCodes(ids, color);
}

export function recolorCode(id: string, color: string) {
  updateCode(id, { color });
}

/** Gives a code and all its subcodes the same color. */
export function colorSubcodesLike(id: string, color: string) {
  const n = subtreeOf(id).length - 1;
  setSubtreeColor(id, color);
  toast(`Gave ${n} subcode${n === 1 ? '' : 's'} the same color.`);
}

/**
 * Saves the code details dialog. Returns false (after telling the user why) when the input is
 * not valid, so the dialog stays open.
 */
export function saveCodeDetails(
  codeId: string,
  fields: { name: string; color: string; description: string; parentId: string | null },
): boolean {
  const name = fields.name.trim();
  if (!name) {
    notify('The code name cannot be empty.');
    return false;
  }
  if (/[>›]/.test(name)) {
    notify('A code name cannot contain “>”; it separates a code from its subcodes.');
    return false;
  }
  // Names only need to be unique among the codes with the same parent.
  const clash = findChildCode(fields.parentId, name);
  if (clash && clash.id !== codeId) {
    const where = fields.parentId ? `under “${codeById(fields.parentId)?.name}”` : 'at the top level';
    notify(`A code named “${name}” already exists ${where}. Use “Merge into…” to combine them.`);
    return false;
  }
  updateCode(codeId, { name, color: fields.color, description: fields.description.trim() || undefined, parentId: fields.parentId });
  return true;
}

export function setCodeCollapsed(id: string, collapsed: boolean) {
  ui.collapsedCodes = ui.collapsedCodes.filter((x) => x !== id);
  if (collapsed) ui.collapsedCodes.push(id);
  commitUI();
}

/** Codes that have subcodes, i.e. that can be opened and closed. */
const parentCodeIds = () => project.codes.filter((c) => project.codes.some((x) => x.parentId === c.id)).map((c) => c.id);

/** Whether any code with subcodes is open (so "close all" applies). */
export const anyCodeExpanded = () => parentCodeIds().some((id) => !ui.collapsedCodes.includes(id));

/** Closes all codes with subcodes if any is open, otherwise opens them all. */
export function toggleAllCodesCollapsed() {
  ui.collapsedCodes = anyCodeExpanded() ? parentCodeIds() : [];
  commitUI();
}

export function setCodeSort(sort: UIState['codeSort']) {
  ui.codeSort = sort;
  commitUI();
}

/** Sets a codebook filter rule: include subcodes of matches, or search descriptions. */
export function setCodeFilterOption(option: 'codeFilterSubcodes' | 'codeFilterDescriptions', on: boolean) {
  ui[option] = on;
  commitUI();
}

export function setCodeView(view: UIState['codeView']) {
  ui.codeView = view;
  commitUI();
}

/** Opens a document and scrolls to a coded passage in it. */
export function goToSegment(docId: string, start: number, end: number) {
  ui.selectedDocId = docId;
  commitUI();
  requestAnimationFrame(() => focusSegment(start, end));
}
