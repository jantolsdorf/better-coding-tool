// Challenges: your objections to codes of other coders, each with a comment. A challenge refers
// to a coded segment by coder name, passage and code path (not by ids), so it still applies
// after the coder's project is imported again.

import { codePathParts } from './codes';
import { commit, project } from './state';
import type { Challenge, Code, Segment } from './types';
import { now, uid } from './util';

const samePath = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x.toLowerCase() === b[i].toLowerCase());

/** The challenge of a coder's segment (coded with `code` from that coder's codebook `codes`), if any. */
export function findChallenge(coderName: string, seg: Segment, code: Code, codes: Code[]): Challenge | undefined {
  const path = codePathParts(code, codes);
  return project.challenges.find(
    (c) => c.coderName === coderName && c.docId === seg.docId && c.start === seg.start && c.end === seg.end && samePath(c.codePath, path),
  );
}

/** Challenges a coder's segment with a comment, or updates the comment of an existing challenge. */
export function setChallenge(coderName: string, seg: Segment, code: Code, codes: Code[], comment: string): Challenge {
  let c = findChallenge(coderName, seg, code, codes);
  if (c) c.comment = comment;
  else {
    c = { id: uid('ch'), coderName, docId: seg.docId, start: seg.start, end: seg.end, codePath: codePathParts(code, codes), comment, createdAt: now() };
    project.challenges.push(c);
  }
  commit();
  return c;
}

export function removeChallenge(id: string) {
  project.challenges = project.challenges.filter((c) => c.id !== id);
  commit();
}

/** Challenges of one coder (all coders if omitted). */
export const challengesOf = (coderName?: string) => project.challenges.filter((c) => !coderName || c.coderName === coderName);
