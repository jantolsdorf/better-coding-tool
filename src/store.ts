import type { Code, ColumnKey, Doc, ExternalCoding, Folder, Project, Segment, TableColumn, UIState } from './types';
import { byName, PALETTE } from './util';

const PROJECT_KEY = 'bct:project:v1';
const UI_KEY = 'bct:ui:v1';

export function uid(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const now = () => new Date().toISOString();

export function emptyProject(coderName = ''): Project {
  return {
    format: 'bct-project',
    version: 1,
    coderName,
    folders: [],
    docs: [],
    codes: [],
    segments: [],
    externalCodings: [],
    consolidated: null,
  };
}

/** Validates a parsed JSON value and returns it as a Project. Throws on invalid input. */
export function parseProject(data: unknown): Project {
  if (!data || typeof data !== 'object') throw new Error('The file does not contain a project.');
  const d = data as Record<string, unknown>;
  if (d.format !== 'bct-project') throw new Error('This file is not a Better Coding Tool export.');
  const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  const validSegment = (s: Segment) =>
    s && typeof s.docId === 'string' && Number.isInteger(s.start) && Number.isInteger(s.end) && s.start >= 0 && s.end > s.start;
  const externalCodings = arr<ExternalCoding>(d.externalCodings).map((x) => ({
    ...x,
    codes: arr<Code>(x.codes),
    segments: arr<Segment>(x.segments).filter(validSegment),
  }));
  return {
    format: 'bct-project',
    version: 1,
    coderName: typeof d.coderName === 'string' ? d.coderName : '',
    folders: arr<Folder>(d.folders),
    docs: arr<Doc>(d.docs).filter((doc) => typeof doc?.content === 'string'),
    codes: arr<Code>(d.codes),
    segments: arr<Segment>(d.segments).filter(validSegment),
    externalCodings,
    consolidated: Array.isArray(d.consolidated) ? arr<Segment>(d.consolidated).filter(validSegment) : null,
  };
}

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
    codeTarget: 'mine',
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export let project: Project = loadProject();
export const ui: UIState = loadUI();
export let savedBytes = 0;

const listeners: (() => void)[] = [];
export function subscribe(fn: () => void) {
  listeners.push(fn);
}
const emit = () => listeners.forEach((fn) => fn());

let quotaWarned = false;
function saveProject() {
  try {
    const json = JSON.stringify(project);
    localStorage.setItem(PROJECT_KEY, json);
    savedBytes = json.length * 2;
    quotaWarned = false;
  } catch (e) {
    console.error(e);
    if (!quotaWarned) {
      quotaWarned = true;
      alert(
        'Saving to local storage failed (the browser storage is probably full). ' +
          'Export your project now so you do not lose work.',
      );
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

/** Persist the project and re-render. */
export function commit() {
  saveProject();
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
  ui.selectedDocId = null;
  ui.selectedFolderId = null;
  ui.collapsed = [];
  ui.hiddenExternal = [];
  commit();
}

// ---------- queries ----------

export const getDoc = (id: string | null) => (id ? project.docs.find((d) => d.id === id) : undefined);
export const currentDoc = () => getDoc(ui.selectedDocId) ?? null;
export const codeById = (id: string) => project.codes.find((c) => c.id === id);

export function findCodeByName(name: string): Code | undefined {
  const n = name.trim().toLowerCase();
  return project.codes.find((c) => c.name.toLowerCase() === n);
}

/** Folder names from the top level down to `folderId`. */
export function folderChain(folderId: string | null): string[] {
  const parts: string[] = [];
  let f = project.folders.find((x) => x.id === folderId);
  while (f && parts.length < 100) {
    parts.unshift(f.name);
    const parent = f.parentId;
    f = project.folders.find((x) => x.id === parent);
  }
  return parts;
}

export function folderPath(folderId: string | null): string {
  return folderChain(folderId).join(' / ');
}

/** All documents in the order the document tree shows them (folders first, then by name). */
export function docsInTreeOrder(parentId: string | null = null): Doc[] {
  return [
    ...project.folders
      .filter((f) => f.parentId === parentId)
      .sort(byName)
      .flatMap((f) => docsInTreeOrder(f.id)),
    ...project.docs.filter((d) => d.folderId === parentId).sort(byName),
  ];
}

function descendantFolderIds(id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of project.folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Segments per code in the active coding (yours, or the consolidated one while consolidating into it). */
export function segmentCounts(): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of layerSegments()) m.set(s.codeId, (m.get(s.codeId) ?? 0) + 1);
  return m;
}

export function nextColor(): string {
  const used = new Set(project.codes.map((c) => c.color.toLowerCase()));
  return PALETTE.find((c) => !used.has(c)) ?? PALETTE[project.codes.length % PALETTE.length];
}

// ---------- documents & folders ----------

export function normalizeText(t: string): string {
  return t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

export function addDocs(files: { name: string; content: string }[], folderId: string | null): Doc[] {
  const docs = files.map((f) => ({
    id: uid('d'),
    name: f.name,
    folderId,
    content: normalizeText(f.content),
    addedAt: now(),
  }));
  project.docs.push(...docs);
  if (folderId) ui.collapsed = ui.collapsed.filter((id) => id !== folderId);
  if (!ui.selectedDocId && docs.length) ui.selectedDocId = docs[0].id;
  commit();
  return docs;
}

export function addFolder(name: string, parentId: string | null): Folder {
  const folder = { id: uid('f'), name: name.trim(), parentId };
  project.folders.push(folder);
  if (parentId) ui.collapsed = ui.collapsed.filter((id) => id !== parentId);
  commit();
  return folder;
}

export function renameFolder(id: string, name: string) {
  const f = project.folders.find((x) => x.id === id);
  if (f && name.trim()) f.name = name.trim();
  commit();
}

function removeDocsData(docIds: Set<string>) {
  project.docs = project.docs.filter((d) => !docIds.has(d.id));
  project.segments = project.segments.filter((s) => !docIds.has(s.docId));
  if (project.consolidated) project.consolidated = project.consolidated.filter((s) => !docIds.has(s.docId));
  for (const x of project.externalCodings) x.segments = x.segments.filter((s) => !docIds.has(s.docId));
  if (ui.selectedDocId && docIds.has(ui.selectedDocId)) ui.selectedDocId = null;
}

export function folderContents(id: string): { folders: number; docs: Doc[] } {
  const ids = descendantFolderIds(id);
  return { folders: ids.size - 1, docs: project.docs.filter((d) => d.folderId && ids.has(d.folderId)) };
}

export function deleteFolder(id: string) {
  const ids = descendantFolderIds(id);
  removeDocsData(new Set(project.docs.filter((d) => d.folderId && ids.has(d.folderId)).map((d) => d.id)));
  project.folders = project.folders.filter((f) => !ids.has(f.id));
  if (ui.selectedFolderId && ids.has(ui.selectedFolderId)) ui.selectedFolderId = null;
  commit();
}

export function renameDoc(id: string, name: string) {
  const d = getDoc(id);
  if (d && name.trim()) d.name = name.trim();
  commit();
}

export function deleteDoc(id: string) {
  removeDocsData(new Set([id]));
  commit();
}

export function moveDoc(id: string, folderId: string | null) {
  const d = getDoc(id);
  if (!d) return;
  d.folderId = folderId;
  commit();
}

/** Returns false if the move would put a folder inside itself. */
export function moveFolder(id: string, parentId: string | null): boolean {
  if (parentId && descendantFolderIds(id).has(parentId)) return false;
  const f = project.folders.find((x) => x.id === id);
  if (!f) return false;
  f.parentId = parentId;
  commit();
  return true;
}

// ---------- codes & segments ----------

export function createCode(name: string, color = nextColor()): Code {
  const existing = findCodeByName(name);
  if (existing) return existing;
  const code = { id: uid('c'), name: name.trim(), color };
  project.codes.push(code);
  commit();
  return code;
}

/** The coding that new codes go into and that is highlighted in the text: yours or the consolidated one. */
export function activeLayer(): 'mine' | 'consolidated' {
  return project.consolidated && ui.codeTarget === 'consolidated' ? 'consolidated' : 'mine';
}

export function layerSegments(layer = activeLayer()): Segment[] {
  return layer === 'consolidated' ? (project.consolidated ?? []) : project.segments;
}

function codeFor(name: string, colorForNew?: string): Code {
  let code = findCodeByName(name);
  if (!code) {
    code = { id: uid('c'), name: name.trim(), color: colorForNew ?? nextColor() };
    project.codes.push(code);
  }
  return code;
}

/** Adds a segment unless the same code is already applied to exactly this range. */
function pushSegment(list: Segment[], doc: Doc, start: number, end: number, codeId: string, source?: string) {
  if (list.some((s) => s.docId === doc.id && s.codeId === codeId && s.start === start && s.end === end)) return;
  list.push({ id: uid('s'), docId: doc.id, codeId, start, end, text: doc.content.slice(start, end), createdAt: now(), source });
}

/** Codes the passage [start, end) of a document with the given code name, creating the code if needed. */
export function applyCode(docId: string, start: number, end: number, codeName: string, colorForNew?: string) {
  const doc = getDoc(docId);
  const name = codeName.trim();
  if (!doc || !name) return null;
  const code = codeFor(name, colorForNew);
  pushSegment(layerSegments(), doc, start, end, code.id);
  commit();
  return code;
}

/** Removes a segment from your coding or the consolidated coding (ids are unique across both). */
export function deleteSegment(id: string) {
  project.segments = project.segments.filter((s) => s.id !== id);
  if (project.consolidated) project.consolidated = project.consolidated.filter((s) => s.id !== id);
  commit();
}

export function updateCode(id: string, patch: Partial<Omit<Code, 'id'>>) {
  const c = codeById(id);
  if (!c) return;
  Object.assign(c, patch);
  commit();
}

export function deleteCode(id: string) {
  project.codes = project.codes.filter((c) => c.id !== id);
  project.segments = project.segments.filter((s) => s.codeId !== id);
  if (project.consolidated) project.consolidated = project.consolidated.filter((s) => s.codeId !== id);
  commit();
}

function mergeIn(list: Segment[], fromId: string, intoId: string): Segment[] {
  const seen = new Set(list.filter((s) => s.codeId === intoId).map((s) => `${s.docId}:${s.start}:${s.end}`));
  return list.filter((s) => {
    if (s.codeId !== fromId) return true;
    const key = `${s.docId}:${s.start}:${s.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    s.codeId = intoId;
    return true;
  });
}

/** Reassigns all segments of `fromId` to `intoId` and removes `fromId`. */
export function mergeCode(fromId: string, intoId: string) {
  project.segments = mergeIn(project.segments, fromId, intoId);
  if (project.consolidated) project.consolidated = mergeIn(project.consolidated, fromId, intoId);
  project.codes = project.codes.filter((c) => c.id !== fromId);
  commit();
}

// ---------- other coders ----------

/** Maps the documents of another project onto local documents with identical text. */
export function matchDocs(theirs: Doc[]): { map: Map<string, string>; missing: Doc[] } {
  const map = new Map<string, string>();
  const missing: Doc[] = [];
  for (const t of theirs) {
    const candidates = project.docs.filter((d) => d.content === t.content);
    const match = candidates.find((d) => d.name === t.name) ?? candidates[0];
    if (match) map.set(t.id, match.id);
    else missing.push(t);
  }
  return { map, missing };
}

export function addExternalCoding(src: Project, coderName: string, addMissingTo: string | null) {
  const { map, missing } = matchDocs(src.docs);
  if (addMissingTo && missing.length) {
    const folder = { id: uid('f'), name: addMissingTo, parentId: null };
    project.folders.push(folder);
    for (const t of missing) {
      const id = uid('d');
      project.docs.push({ id, name: t.name, folderId: folder.id, content: t.content, addedAt: now() });
      map.set(t.id, id);
    }
  }
  const segments = src.segments
    .filter((s) => map.has(s.docId))
    .map((s) => ({ ...s, docId: map.get(s.docId)! }));
  project.externalCodings = project.externalCodings.filter((x) => x.coderName !== coderName);
  project.externalCodings.push({
    id: uid('x'),
    coderName,
    codes: src.codes.map((c) => ({ ...c })),
    segments,
    importedAt: now(),
  });
  commit();
  return { imported: segments.length, skipped: src.segments.length - segments.length };
}

export function renameExternal(id: string, name: string) {
  const x = project.externalCodings.find((e) => e.id === id);
  if (x && name.trim()) x.coderName = name.trim();
  commit();
}

export function removeExternal(id: string) {
  project.externalCodings = project.externalCodings.filter((x) => x.id !== id);
  ui.hiddenExternal = ui.hiddenExternal.filter((x) => x !== id);
  ui.columnOrder = ui.columnOrder.filter((x) => x !== id);
  commit();
}

export function setExternalVisible(id: string, visible: boolean) {
  ui.hiddenExternal = ui.hiddenExternal.filter((x) => x !== id);
  if (!visible) ui.hiddenExternal.push(id);
  commitUI();
}

// ---------- comparison table ----------

export const CONSOLIDATED_KEY = 'consolidated';
export const MINE_KEY = 'me';

/** The coder columns shown next to the text, in the user's chosen order. */
export function tableColumns(): TableColumn[] {
  const cols: TableColumn[] = [
    { key: MINE_KEY, kind: 'mine', name: project.coderName || 'You', codes: project.codes, segments: project.segments },
  ];
  if (project.consolidated) {
    cols.push({ key: CONSOLIDATED_KEY, kind: 'consolidated', name: 'Consolidated', codes: project.codes, segments: project.consolidated });
  }
  for (const x of project.externalCodings) {
    if (!ui.hiddenExternal.includes(x.id)) {
      cols.push({ key: x.id, kind: 'external', name: x.coderName, codes: x.codes, segments: x.segments });
    }
  }
  // Columns not yet in the saved order go to the end, except a new consolidation, which starts next to the text.
  const rank = (k: ColumnKey) => {
    const i = ui.columnOrder.indexOf(k);
    return i !== -1 ? i : k === CONSOLIDATED_KEY ? -1 : Infinity;
  };
  return cols
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c.key) - rank(b.c.key) || a.i - b.i)
    .map((x) => x.c);
}

/** Moves column `key` directly before (or after) column `target`. */
export function moveColumn(key: ColumnKey, target: ColumnKey, after: boolean) {
  if (key === target) return;
  const order = tableColumns().map((c) => c.key).filter((k) => k !== key);
  const i = order.indexOf(target);
  if (i === -1) return;
  order.splice(after ? i + 1 : i, 0, key);
  // Keep the positions of hidden coders so they come back where they were.
  ui.columnOrder = [...order, ...ui.columnOrder.filter((k) => !order.includes(k) && k !== key)];
  commitUI();
}

export function setColumnWidth(key: ColumnKey, width: number) {
  ui.columnWidths[key] = Math.round(width);
  commitUI();
}

// ---------- consolidation ----------

export function startConsolidation() {
  project.consolidated = [];
  ui.codeTarget = 'consolidated';
  ui.columnOrder = ui.columnOrder.filter((k) => k !== CONSOLIDATED_KEY);
  commit();
}

export function discardConsolidation() {
  project.consolidated = null;
  ui.codeTarget = 'mine';
  commit();
}

/**
 * Makes the consolidated coding your coding. Your previous coding is kept as an
 * "other coder" so nothing is lost and it can still be compared.
 */
export function finishConsolidation(): string {
  if (!project.consolidated) return '';
  const keptAs = `${project.coderName || 'You'} (before consolidation)`;
  project.externalCodings = project.externalCodings.filter((x) => x.coderName !== keptAs);
  const before = { id: uid('x'), coderName: keptAs, codes: project.codes.map((c) => ({ ...c })), segments: project.segments, importedAt: now() };
  project.externalCodings.push(before);
  ui.hiddenExternal.push(before.id);
  project.segments = project.consolidated;
  project.consolidated = null;
  ui.codeTarget = 'mine';
  commit();
  return keptAs;
}

/** Whether the consolidated coding already has a code with this name on exactly this range. */
export function isConsolidated(seg: Segment, codeName: string): boolean {
  const code = findCodeByName(codeName);
  return !!code && !!project.consolidated?.some(
    (s) => s.docId === seg.docId && s.codeId === code.id && s.start === seg.start && s.end === seg.end,
  );
}

/** Copies segments of a coder into the consolidated coding, matching codes by name. */
export function acceptIntoConsolidated(items: { seg: Segment; code: Code; source: string }[]) {
  if (!project.consolidated) return 0;
  const before = project.consolidated.length;
  for (const { seg, code, source } of items) {
    const doc = getDoc(seg.docId);
    if (!doc) continue;
    pushSegment(project.consolidated, doc, seg.start, seg.end, codeFor(code.name, code.color).id, source);
  }
  commit();
  return project.consolidated.length - before;
}
