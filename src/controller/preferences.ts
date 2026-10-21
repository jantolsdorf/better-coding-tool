// User preferences: who is coding, theme, and the layout of the main areas and panels.

import { forgetCoder, projectCoders, renameCoder, switchCoder } from '../model/projectCoders';
import { commit, commitUI, project, ui } from '../model/state';
import { askText, confirmAction, toast } from '../view/feedback';
import type { MainArea, UIState } from '../model/types';

const THEMES: UIState['theme'][] = ['auto', 'light', 'dark'];

/** Sets the coder's name; returns false for an empty name (a coder always needs a name). */
export function setCoderName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  project.coderName = trimmed;
  commit();
  return true;
}

/** Switches between automatic (system), light and dark. */
export function cycleTheme() {
  ui.theme = THEMES[(THEMES.indexOf(ui.theme) + 1) % THEMES.length];
  commitUI();
}

/** Moves a main area (documents & codebook, text, coded segments) before or after another. */
export function moveArea(area: MainArea, target: MainArea, after: boolean, current: MainArea[]) {
  if (area === target) return;
  const next = current.filter((a) => a !== area);
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, area);
  ui.mainOrder = next;
  commitUI();
}

/** Width in px of a side area (null = default). */
export function setAreaWidth(area: 'sidebar' | 'segments', width: number | null) {
  if (area === 'sidebar') ui.sidebarWidth = width;
  else ui.segmentsWidth = width;
  commitUI();
}

/** Relative heights of the sidebar panels (null = default). */
export function setPanelSizes(sizes: number[] | null) {
  ui.panelFlex = sizes;
  commitUI();
}

// ---------- who is coding ----------

/** Switches to another coder of this project: new codes and memos get their name as author. */
export function switchCoderTo(name: string) {
  if (name === project.coderName) return;
  switchCoder(name);
  toast(`Now coding as “${name}”. The previous coding is under “Other coders”.`);
}

/** Asks for the name of a new coder and switches to them. */
export async function addCoderInteractive() {
  const name = await askText({
    title: 'New coder',
    message: 'Every coder has their own coding. Yours moves to “Other coders”, and you start the new coder’s coding.',
    label: 'Name',
    placeholder: 'e.g. Anna',
    okLabel: 'Add and code as this coder',
  });
  // An existing name simply switches to that coder.
  if (name) switchCoderTo(name);
}

/** Renames a coder (by default the current one) everywhere; renaming to an existing name merges them after asking. */
export async function renameCoderInteractive(from = project.coderName) {
  const to = await askText({
    title: `Rename “${from}”`,
    message: 'The new name is also used as author of their codes and memos.',
    label: 'New name',
    initial: from,
    okLabel: 'Rename',
  });
  if (!to || to === from) return;
  const other = projectCoders().find((c) => c.name === to);
  if (other && !confirmAction(`“${to}” already exists. Merge the coding of “${from}” into “${to}”? Codes are matched by name and position; overlapping identical codes are combined. You can undo this.`)) return;
  renameCoder(from, to);
}

/** Removes a coder without any codes or memos from the list. */
export function forgetCoderNow(name: string) {
  forgetCoder(name);
}
