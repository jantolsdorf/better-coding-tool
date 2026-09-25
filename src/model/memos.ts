// Memos: notes attached to passages of text (shown as sticky notes).

import { getDoc } from './documents';
import { commit, project } from './state';
import type { Memo } from './types';
import { now, uid } from './util';

/** The memos of a document, in text order. */
export function memosOf(docId: string | null): Memo[] {
  return project.memos.filter((m) => m.docId === docId).sort((a, b) => a.start - b.start || a.end - b.end);
}

export function addMemo(docId: string, start: number, end: number, note: string): Memo | null {
  const doc = getDoc(docId);
  const text = note.trim();
  if (!doc || !text || end <= start) return null;
  const memo: Memo = { id: uid('m'), docId, start, end, text: doc.content.slice(start, end), note: text, createdAt: now() };
  project.memos.push(memo);
  commit();
  return memo;
}

export function updateMemo(id: string, note: string) {
  const memo = project.memos.find((m) => m.id === id);
  if (!memo) return;
  memo.note = note.trim();
  memo.updatedAt = now();
  commit();
}

export function deleteMemo(id: string) {
  project.memos = project.memos.filter((m) => m.id !== id);
  commit();
}
