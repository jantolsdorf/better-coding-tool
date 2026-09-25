// User actions on memos (sticky notes on passages).

import { addMemo, deleteMemo, updateMemo } from '../model/memos';

export function addMemoToPassage(docId: string, start: number, end: number, note: string) {
  return addMemo(docId, start, end, note);
}

/** Saves an edited memo; an emptied memo is removed (undo brings it back). */
export function editMemo(id: string, note: string) {
  if (note.trim()) updateMemo(id, note);
  else deleteMemo(id);
}

export function removeMemo(id: string) {
  deleteMemo(id);
}
