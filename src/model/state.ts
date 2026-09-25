// The application state: the project (documents, codes, coding) and the view state (UIState),
// their persistence in local storage, change notification, and undo/redo.

import { emptyProject, parseProject } from './parse';
import type { Project, UIState } from './types';

const PROJECT_KEY = 'bct:project:v1';
const UI_KEY = 'bct:ui:v1';

function loadProject(): Project {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) return parseProject(JSON.parse(raw));
  } catch (e) {
    console.error('Could not load saved project', e);
  }
  return emptyProject();
}

function loadUI(): UIState {
  const defaults: UIState = {
    selectedDocId: null,
    selectedFolderId: null,
    collapsed: [],
    hiddenExternal: [],
    segmentsHidden: false,
    columnOrder: [],
    columnWidths: {},
    textWidth: null,
    collapsedCodes: [],
    codeSort: 'name',
    codeView: 'tree',
    theme: 'auto',
    panelFlex: null,
    mainOrder: ['sidebar', 'viewer', 'segments'],
    sidebarWidth: null,
    segmentsWidth: null,
    codeTarget: 'mine',
    codeBoxHelp: false,
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export let project: Project = loadProject();
export const ui: UIState = loadUI();
export let savedBytes = JSON.stringify(project).length * 2;

const listeners: (() => void)[] = [];
export function subscribe(fn: () => void) {
  listeners.push(fn);
}
const emit = () => listeners.forEach((fn) => fn());

// Undo/redo keeps serialized snapshots of the project, taken whenever a change is committed.
const UNDO_LIMIT = 50;
let lastJson = JSON.stringify(project);
const undoStack: string[] = [];
const redoStack: string[] = [];
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

function restore(json: string) {
  project = JSON.parse(json) as Project;
  lastJson = json;
  saveProject(json);
  saveUI();
  emit();
}

export function undo(): boolean {
  const prev = undoStack.pop();
  if (prev === undefined) return false;
  redoStack.push(lastJson);
  restore(prev);
  return true;
}

export function redo(): boolean {
  const next = redoStack.pop();
  if (next === undefined) return false;
  undoStack.push(lastJson);
  restore(next);
  return true;
}

let saveErrorHandler: (() => void) | null = null;

/** Called (once until saving works again) when the project cannot be saved, e.g. storage is full. */
export function onSaveError(fn: () => void) {
  saveErrorHandler = fn;
}

let quotaWarned = false;
function saveProject(json: string) {
  try {
    localStorage.setItem(PROJECT_KEY, json);
    savedBytes = json.length * 2;
    quotaWarned = false;
  } catch (e) {
    console.error(e);
    if (!quotaWarned) {
      quotaWarned = true;
      saveErrorHandler?.();
    }
  }
}

function saveUI() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch {
    /* UI state is not important enough to warn about */
  }
}

/** Persist the project (recording an undo step if it changed) and re-render. */
export function commit() {
  const json = JSON.stringify(project);
  if (json !== lastJson) {
    undoStack.push(lastJson);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    lastJson = json;
  }
  saveProject(json);
  saveUI();
  emit();
}

/** Persist UI state only and re-render. */
export function commitUI() {
  saveUI();
  emit();
}

export function replaceProject(p: Project) {
  project = p;
  // The old ids are gone, so selections and per-item view state no longer apply.
  ui.selectedDocId = null;
  ui.selectedFolderId = null;
  ui.collapsed = [];
  ui.hiddenExternal = [];
  commit();
}
