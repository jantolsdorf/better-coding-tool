// Challenge mode: reviewing another coder's codes and challenging the ones you do not agree with.

import { findChallenge, removeChallenge, setChallenge } from '../model/challenges';
import { codePath } from '../model/codes';
import { getDoc } from '../model/documents';
import { challengesCSV } from '../model/formats/csv';
import { lineLabel } from '../model/lines';
import { commitUI, project, ui } from '../model/state';
import type { Code, Segment } from '../model/types';
import { now, safeFileName } from '../model/util';
import { askComment } from '../view/commentDialog';
import { toast } from '../view/feedback';
import { downloadFile } from '../view/files';

/** Turns challenge mode (⚑ on other coders' codes in the document columns) on or off. */
export function setChallengeMode(on: boolean) {
  ui.challengeMode = on;
  commitUI();
}

/**
 * Challenges a coder's segment (or edits/withdraws an existing challenge) after asking for the
 * reason. `codes` is that coder's codebook.
 */
export async function challengeInteractive(coderName: string, seg: Segment, code: Code, codes: Code[]) {
  const doc = getDoc(seg.docId);
  if (!doc) return;
  const existing = findChallenge(coderName, seg, code, codes);
  const res = await askComment({
    title: existing ? `Challenge of “${code.name}”` : `Challenge “${code.name}” by ${coderName}`,
    context: `${codePath(code, codes)} · ${doc.name} ${lineLabel(doc, seg.start, seg.end)}`,
    quote: doc.content.slice(seg.start, seg.end),
    initial: existing?.comment,
    saveLabel: existing ? 'Save' : '⚑ Challenge',
    removeLabel: 'Withdraw challenge',
  });
  if (res?.action === 'save') setChallenge(coderName, seg, code, codes, res.text);
  else if (res?.action === 'remove' && existing) removeChallenge(existing.id);
}

/** Withdraws a challenge without asking (Undo brings it back). */
export function withdrawChallenge(id: string) {
  removeChallenge(id);
  toast('Challenge withdrawn. Undo with ⌘Z / Ctrl+Z.');
}

/** All your challenges as CSV, e.g. to send to the coders. */
export function exportChallengesCSV() {
  if (!project.challenges.length) return toast('There are no challenges yet.');
  downloadFile(`challenges-${safeFileName(project.coderName || 'project')}-${now().slice(0, 10)}.csv`, challengesCSV(), 'text/csv');
}
