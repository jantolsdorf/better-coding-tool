// User actions on the codebook: creating, editing, nesting, merging and deleting codes.

import {
  codeById,
  codePathParts,
  createCode,
  deleteAllCodes,
  deleteCode,
  deleteCodes,
  findChildCode,
  findCodeByPath,
  mergeCode,
  mergeCodes,
  moveCodes,
  placeCodes,
  recolorCodes,
  setCodeParent,
  setSubtreeColor,
  splitCodePath,
  subtreeOf,
  updateCode,
} from '../model/codes';
import { dropSegments } from '../model/coding';
import { allConsolidated } from '../model/layers';
import { commitUI, project, ui } from '../model/state';
import type { Code, UIState } from '../model/types';
import { pinSegment } from '../view/document/pins';
import { focusSegment } from '../view/document/textView';
import { askText, confirmAction, notify, toast } from '../view/feedback';

/**
 * Creates a code from the "New code" dialog ("Parent > Child" creates a subcode). Returns false
 * (after saying why) if the name is empty or the code exists, so the dialog stays open.
 */
export function createCodeFromDialog(name: string, color: string, description: string): boolean {
  const parts = splitCodePath(name);
  if (!parts.length) return (notify('Enter a name for the code.', 'Name missing'), false);
  if (findCodeByPath(parts)) return (notify(`“${parts.join(' > ')}” already exists.`, 'Code exists'), false);
  // Subcodes take their level 1 code's color, like when typing them in the code box.
  const parent = parts.length > 1 ? findCodeByPath(parts.slice(0, 1)) : undefined;
  const parentId = parent ? findCodeByPath(parts.slice(0, -1))?.id : undefined;
  if (parentId) ui.collapsedCodes = ui.collapsedCodes.filter((x) => x !== parentId);
  createCode(parts.join(' > '), parent?.color ?? color, description.trim() || undefined);
  return true;
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

/** Asks for a name and creates a subcode of `parentId` (it takes the parent's color). */
export async function addSubcodeInteractive(parentId: string) {
  const parent = codeById(parentId);
  if (!parent) return;
  const name = await askText({ title: `New subcode of “${parent.name}”`, label: 'Name', placeholder: 'e.g. Distrust', okLabel: 'Create subcode' });
  if (!name) return;
  if (/[>›]/.test(name)) return notify('A code name cannot contain “>”; it separates a code from its subcodes.', 'Invalid name');
  if (findChildCode(parentId, name)) return notify(`“${parent.name}” already has a subcode named “${name}”.`, 'Subcode exists');
  ui.collapsedCodes = ui.collapsedCodes.filter((x) => x !== parentId);
  createCode([...codePathParts(parent), name].join(' > '));
}

/** Deletes a code right away (no question; Undo brings it back). */
export function deleteCodeNow(code: Code) {
  deleteCode(code.id);
  toast(`Deleted “${code.name}”. Undo with ⌘Z / Ctrl+Z.`);
}

/** Merges a dragged code into another after confirmation. */
export async function mergeDroppedCode(fromId: string, intoId: string) {
  const from = codeById(fromId);
  const into = codeById(intoId);
  if (!from || !into) return;
  const n = project.segments.filter((s) => s.codeId === from.id).length;
  const question = `Its ${n} segment(s) and any subcodes move to “${into.name}”, and “${from.name}” is removed.`;
  if (await confirmAction(question, { title: `Merge “${from.name}” into “${into.name}”?`, confirm: 'Merge' })) {
    mergeCode(from.id, into.id);
  }
}

/** Merges a code into another from the code details dialog; returns whether it was merged. */
export async function mergeCodeInteractive(code: Code, targetId: string): Promise<boolean> {
  const target = codeById(targetId);
  if (!target) return false;
  const question = `All segments and subcodes move to “${target.name}”, and “${code.name}” is removed.`;
  if (!(await confirmAction(question, { title: `Merge “${code.name}” into “${target.name}”?`, confirm: 'Merge' }))) {
    return false;
  }
  mergeCode(code.id, target.id);
  return true;
}

/** Deletes a code after confirmation; returns whether it was deleted. */
export async function deleteCodeInteractive(code: Code, segments: number): Promise<boolean> {
  const question = segments ? `It is removed from ${segments} coded segment(s). You can undo this.` : 'You can undo this.';
  if (!(await confirmAction(question, { title: `Delete code “${code.name}”?`, confirm: 'Delete code', danger: true }))) return false;
  deleteCode(code.id);
  return true;
}

/** Deletes the whole codebook, and with it your coded segments, after confirmation. */
export async function deleteCodebookInteractive() {
  const codes = project.codes.length;
  if (!codes) return toast('The codebook is already empty.');
  const segments = project.segments.length;
  const consolidated = allConsolidated().length;
  const removes = [
    segments ? `${segments} coded segment${segments === 1 ? '' : 's'}` : '',
    consolidated ? `${consolidated} consolidated segment${consolidated === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const question =
    (removes.length ? `This also removes your ${removes.join(' and ')}.\n` : '') +
    'Documents, memos and other coders’ coding are kept. You can undo this (⌘Z / Ctrl+Z).';
  const title = `Delete the whole codebook (${codes} code${codes === 1 ? '' : 's'})?`;
  if (!(await confirmAction(question, { title, confirm: 'Delete codebook', danger: true }))) return;
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

/** Places dragged codes before or after another code (custom order); switches to that order. */
export function placeCodesAt(ids: string[], targetId: string, after: boolean) {
  const res = placeCodes(ids, targetId, after);
  const problems = [
    res.cycle ? `${plural(res.cycle, 'code')} cannot go inside ${res.cycle === 1 ? 'its' : 'their'} own subcodes` : '',
    res.duplicate ? `${plural(res.duplicate, 'code')} already exist${res.duplicate === 1 ? 's' : ''} there with the same name (merge instead)` : '',
  ].filter(Boolean);
  if (problems.length) toast(`Moved ${res.moved}; ${problems.join('; ')}.`, 5000);
}

/** Merges several codes into another after confirmation; returns whether they were merged. */
export async function mergeCodesInteractive(ids: string[], intoId: string): Promise<boolean> {
  const into = codeById(intoId);
  const from = ids.filter((id) => id !== intoId);
  if (!into || !from.length) return false;
  const n = project.segments.filter((s) => from.includes(s.codeId)).length;
  const question = `Their ${plural(n, 'segment')} and any subcodes move to “${into.name}”, and the merged codes are removed.`;
  if (!(await confirmAction(question, { title: `Merge ${plural(from.length, 'code')} into “${into.name}”?`, confirm: 'Merge' }))) {
    return false;
  }
  mergeCodes(from, intoId);
  return true;
}

/** Deletes several codes after confirmation; returns whether they were deleted. */
export async function deleteCodesInteractive(ids: string[]): Promise<boolean> {
  const n = project.segments.filter((s) => ids.includes(s.codeId)).length;
  const question =
    (n ? `They are removed from ${plural(n, 'coded segment')}. ` : '') +
    'Subcodes that are not selected move up one level. You can undo this (⌘Z / Ctrl+Z).';
  if (!(await confirmAction(question, { title: `Delete ${plural(ids.length, 'code')}?`, confirm: 'Delete', danger: true }))) return false;
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
  /** Segments removed in the dialog; they are only deleted now, together with the other changes. */
  removedSegmentIds: string[] = [],
): boolean {
  const name = fields.name.trim();
  if (!name) {
    notify('The code name cannot be empty.', 'Name missing');
    return false;
  }
  if (/[>›]/.test(name)) {
    notify('A code name cannot contain “>”; it separates a code from its subcodes.', 'Invalid name');
    return false;
  }
  // Names only need to be unique among the codes with the same parent.
  const clash = findChildCode(fields.parentId, name);
  if (clash && clash.id !== codeId) {
    const where = fields.parentId ? `under “${codeById(fields.parentId)?.name}”` : 'at the top level';
    notify(`A code named “${name}” already exists ${where}. Use “Merge into…” to combine them.`, 'Name already used');
    return false;
  }
  // One undo step for everything saved in the dialog.
  dropSegments(removedSegmentIds);
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
/**
 * Opens a document and scrolls to a passage. With the id of a segment of the active coding, that
 * segment also becomes active (highlighted with its code, and pins to adjust it), as if clicked.
 */
export function goToSegment(docId: string, start: number, end: number, segmentId?: string) {
  ui.selectedDocId = docId;
  commitUI();
  // After rendering (which is synchronous); not tied to a frame of the main window, which may be in the background.
  setTimeout(() => {
    focusSegment(start, end);
    if (segmentId) pinSegment(segmentId);
  }, 0);
}
