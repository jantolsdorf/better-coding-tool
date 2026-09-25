// User actions while coding text.

import { applyCode, deleteSegment } from '../model/coding';
import { commitUI, ui } from '../model/state';
import type { UIState } from '../model/types';
import { toast } from '../view/feedback';

/** Codes a passage with a typed name or path, and explains when an existing segment was extended instead. */
export function codePassage(docId: string, start: number, end: number, codeNameOrPath: string, colorForNew: string) {
  const res = applyCode(docId, start, end, codeNameOrPath, colorForNew);
  if (res?.result === 'extended') toast(`Extended the existing “${res.code.name}” segment to include this passage.`);
  if (res?.result === 'contained') toast(`This passage is already part of a “${res.code.name}” segment.`);
  return res;
}

export function removeSegment(id: string) {
  deleteSegment(id);
}

/** While consolidating: whether new codes go into your coding or the consolidated one. */
export function setCodeTarget(target: UIState['codeTarget']) {
  ui.codeTarget = target;
  commitUI();
}
