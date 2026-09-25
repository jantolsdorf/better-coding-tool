// User preferences: who is coding, theme, and the layout of the main areas and panels.

import { commit, commitUI, project, ui } from '../model/state';
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
