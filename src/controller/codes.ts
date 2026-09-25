// User actions on the codebook: creating, editing, nesting, merging and deleting codes.

import {
  codeById,
  createCode,
  deleteCode,
  findChildCode,
  findCodeByPath,
  mergeCode,
  setCodeParent,
  setSubtreeColor,
  splitCodePath,
  subtreeOf,
  updateCode,
} from '../model/codes';
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

export function setCodeSort(sort: UIState['codeSort']) {
  ui.codeSort = sort;
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
