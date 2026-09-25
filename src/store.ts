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
    consolidations: {},
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
    consolidations: parseConsolidations(d, validSegment),
  };
}

/** Per-document consolidations; older files had one project-wide list, which is split by document. */
function parseConsolidations(d: Record<string, unknown>, valid: (s: Segment) => boolean): Record<string, Segment[]> {
  const out: Record<string, Segment[]> = {};
  if (d.consolidations && typeof d.consolidations === 'object' && !Array.isArray(d.consolidations)) {
    for (const [docId, list] of Object.entries(d.consolidations as Record<string, unknown>)) {
      if (Array.isArray(list)) out[docId] = (list as Segment[]).filter(valid);
    }
  } else if (Array.isArray(d.consolidated)) {
    for (const s of (d.consolidated as Segment[]).filter(valid)) (out[s.docId] ??= []).push(s);
  }
  return out;
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
    textWidth: null,
    collapsedCodes: [],
    codeSort: 'name',
    codeView: 'tree',
    theme: 'auto',
    panelFlex: null,
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

// Code names are unique among siblings only: "Trust > Coping" and a top-level "Coping" are
// different codes. Codes are therefore looked up by their path from the top level.

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The subcode of `parentId` (null = top level) with this name. */
export function findChildCode(parentId: string | null, name: string, codes: Code[] = project.codes): Code | undefined {
  return codes.find((c) => (c.parentId ?? null) === parentId && sameName(c.name, name));
}

/** The code at a path like ["Trust", "Distrust"], or undefined if any level is missing. */
export function findCodeByPath(parts: string[], codes: Code[] = project.codes): Code | undefined {
  let code: Code | undefined;
  for (const name of parts) {
    code = findChildCode(code?.id ?? null, name, codes);
    if (!code) return undefined;
  }
  return code;
}

/** Codes from the top level down to `code`, looked up in `codes` (e.g. another coder's codebook). */
export function codeChain(code: Code, codes: Code[] = project.codes): Code[] {
  const chain = [code];
  for (let c = code, d = 0; c.parentId && d < 100; d++) {
    const parent = codes.find((x) => x.id === c.parentId);
    if (!parent) break;
    chain.unshift(parent);
    c = parent;
  }
  return chain;
}

export const codePathParts = (code: Code, codes: Code[] = project.codes) => codeChain(code, codes).map((c) => c.name);

/** "Parent > Child" path of a code, in the same form as it is typed. */
export function codePath(code: Code, codes: Code[] = project.codes): string {
  return codePathParts(code, codes).join(' > ');
}

/**
 * Whether a code matches a search like "dist" or "trust > dist": the last part must occur in
 * the code's name and the earlier parts, in order, in the names of its parent codes. A trailing
 * ">" ("trust >") matches all subcodes of matching parents.
 */
export function matchesCodeQuery(code: Code, query: string): boolean {
  const parts = query.toLowerCase().split(/[>›]/).map((s) => s.trim());
  if (parts.length > 1 && parts[0] === '') parts.shift();
  const chain = codeChain(code).map((c) => c.name.toLowerCase());
  const last = parts.pop() ?? '';
  if (!chain[chain.length - 1].includes(last)) return false;
  let j = 0;
  for (const part of parts) {
    while (j < chain.length - 1 && !chain[j].includes(part)) j++;
    if (j >= chain.length - 1) return false;
    j++;
  }
  return true;
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
  for (const id of docIds) delete project.consolidations[id];
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

/** Creates a code; "Parent > Child" creates it as a subcode (see codeForPath). */
export function createCode(name: string, color = nextColor()): Code {
  const code = codeForPath(name, color);
  commit();
  return code;
}

/** Splits "Level 1 > Level 2 > …" into its code names (› works too). */
export function splitCodePath(input: string): string[] {
  return input.split(/[>›]/).map((s) => s.trim()).filter(Boolean);
}

/** Which names of a path do not exist yet at their position (and would be created). */
export function missingInPath(parts: string[]): string[] {
  let code: Code | undefined;
  for (const [i, name] of parts.entries()) {
    code = findChildCode(code?.id ?? null, name);
    // Once a level is missing, everything below it is new as well.
    if (!code) return parts.slice(i);
  }
  return [];
}

/**
 * The code at a typed name or path like "Trust > Distrust", creating missing codes along the
 * way (a single name means a top-level code). New subcodes take the color of the level 1 code.
 */
export function codeForPath(input: string | string[], colorForNew?: string): Code {
  const parts = typeof input === 'string' ? splitCodePath(input) : input;
  let parentId: string | null = null;
  let rootColor = colorForNew ?? nextColor();
  let code: Code | undefined;
  for (const [i, name] of parts.entries()) {
    code = findChildCode(parentId, name);
    if (!code) {
      code = { id: uid('c'), name: name.trim(), color: rootColor, parentId };
      project.codes.push(code);
    }
    if (i === 0) rootColor = code.color;
    code.updatedAt = now();
    parentId = code.id;
  }
  return code!;
}

/** The consolidation in progress for a document, if any. */
export const consolidationOf = (docId: string | null | undefined): Segment[] | undefined =>
  docId ? project.consolidations[docId] : undefined;

/** All consolidated segments, of every document being consolidated. */
export const allConsolidated = (): Segment[] => Object.values(project.consolidations).flat();

/**
 * The coding that new codes go into and that is highlighted in the text: yours, or the open
 * document's consolidated coding while it is being consolidated.
 */
export function activeLayer(): 'mine' | 'consolidated' {
  return consolidationOf(ui.selectedDocId) && ui.codeTarget === 'consolidated' ? 'consolidated' : 'mine';
}

export function layerSegments(layer = activeLayer(), docId = ui.selectedDocId): Segment[] {
  return layer === 'consolidated' ? (consolidationOf(docId) ?? []) : project.segments;
}

/** When each code was last edited or applied (ISO dates; older projects fall back to their newest segment). */
export function lastEditedByCode(): Map<string, string> {
  const m = new Map(project.codes.map((c) => [c.id, c.updatedAt ?? '']));
  for (const s of project.segments) if (s.createdAt > (m.get(s.codeId) ?? '￿')) m.set(s.codeId, s.createdAt);
  return m;
}

export type AddResult = 'added' | 'extended' | 'contained';

/**
 * Adds a coded segment to `list`. If the same code already covers an overlapping passage,
 * no new segment is created: the existing one is extended to cover both (and any other
 * overlapping segments of that code are folded into it).
 */
function addOrMerge(list: Segment[], doc: Doc, start: number, end: number, codeId: string, source?: string): AddResult {
  const overlapping = list
    .filter((s) => s.docId === doc.id && s.codeId === codeId && s.start < end && s.end > start)
    .sort((a, b) => a.start - b.start);
  if (!overlapping.length) {
    list.push({ id: uid('s'), docId: doc.id, codeId, start, end, text: doc.content.slice(start, end), createdAt: now(), source });
    return 'added';
  }
  const [keep, ...absorbed] = overlapping;
  const newStart = Math.min(start, keep.start);
  const newEnd = Math.max(end, ...overlapping.map((s) => s.end));
  if (!absorbed.length && newStart === keep.start && newEnd === keep.end) return 'contained';
  keep.start = newStart;
  keep.end = newEnd;
  keep.text = doc.content.slice(newStart, newEnd);
  for (const s of absorbed) list.splice(list.indexOf(s), 1);
  return 'extended';
}

/** Codes the passage [start, end) of a document with the given code name, creating the code if needed. */
export function applyCode(docId: string, start: number, end: number, codeName: string, colorForNew?: string) {
  const doc = getDoc(docId);
  const name = codeName.trim();
  if (!doc || !name) return null;
  const code = codeForPath(name, colorForNew);
  const result = addOrMerge(layerSegments(activeLayer(), docId), doc, start, end, code.id);
  commit();
  return { code, result };
}

/** Removes a segment from your coding or the consolidated coding (ids are unique across both). */
export function deleteSegment(id: string) {
  project.segments = project.segments.filter((s) => s.id !== id);
  for (const [docId, list] of Object.entries(project.consolidations)) {
    project.consolidations[docId] = list.filter((s) => s.id !== id);
  }
  commit();
}

export function updateCode(id: string, patch: Partial<Omit<Code, 'id'>>) {
  const c = codeById(id);
  if (!c) return;
  Object.assign(c, patch, { updatedAt: now() });
  commit();
}

/** Deletes a code and its segments; its subcodes move up to the deleted code's parent. */
export function deleteCode(id: string) {
  const code = codeById(id);
  for (const c of project.codes) if (c.parentId === id) c.parentId = code?.parentId ?? null;
  project.codes = project.codes.filter((c) => c.id !== id);
  project.segments = project.segments.filter((s) => s.codeId !== id);
  for (const [docId, list] of Object.entries(project.consolidations)) {
    project.consolidations[docId] = list.filter((s) => s.codeId !== id);
  }
  commit();
}

function mergeIn(list: Segment[], fromId: string, intoId: string) {
  for (const s of list.filter((x) => x.codeId === fromId)) {
    list.splice(list.indexOf(s), 1);
    const doc = getDoc(s.docId);
    if (doc) addOrMerge(list, doc, s.start, s.end, intoId, s.source);
  }
}

/** Reassigns all segments and subcodes of `fromId` to `intoId` and removes `fromId`. */
export function mergeCode(fromId: string, intoId: string) {
  const from = codeById(fromId);
  if (!from || fromId === intoId) return;
  mergeIn(project.segments, fromId, intoId);
  for (const list of Object.values(project.consolidations)) mergeIn(list, fromId, intoId);
  for (const c of project.codes) {
    // If a code is merged into its own subcode, that subcode takes the merged code's place.
    if (c.parentId === fromId) c.parentId = c.id === intoId ? (from.parentId ?? null) : intoId;
  }
  project.codes = project.codes.filter((c) => c.id !== fromId);
  const into = codeById(intoId);
  if (into) into.updatedAt = now();
  commit();
}

// ---------- code hierarchy ----------

export const childCodes = (parentId: string | null) =>
  project.codes.filter((c) => (c.parentId ?? null) === parentId && c.id !== parentId);

/** Whether code `id` is `rootId` itself or one of its (nested) subcodes. */
export function isCodeInSubtree(id: string, rootId: string): boolean {
  for (let c = codeById(id), depth = 0; c && depth < 100; c = c.parentId ? codeById(c.parentId) : undefined, depth++) {
    if (c.id === rootId) return true;
  }
  return false;
}

/**
 * Makes `id` a subcode of `parentId` (null = top level). Refuses to create cycles, and to
 * create two codes with the same name under one parent (those should be merged instead).
 */
export function setCodeParent(id: string, parentId: string | null): 'ok' | 'cycle' | 'duplicate' {
  const code = codeById(id);
  if (!code || (parentId && isCodeInSubtree(parentId, id))) return 'cycle';
  const clash = findChildCode(parentId, code.name);
  if (clash && clash.id !== id) return 'duplicate';
  code.parentId = parentId;
  code.updatedAt = now();
  if (parentId) ui.collapsedCodes = ui.collapsedCodes.filter((x) => x !== parentId);
  commit();
  return 'ok';
}

export interface CodebookEntry {
  name: string;
  color: string;
  description?: string;
  /** Names from the top level down to this code (including it). */
  path?: string[];
  /** Name of the parent code (older codebook files, where names were unique). */
  parent?: string | null;
}

/** The codebook in a portable form: codes refer to their position by path. */
export function codebookEntries(codes: Code[] = project.codes): CodebookEntry[] {
  return codes.map((c) => {
    const path = codePathParts(c, codes);
    return { name: c.name, path, color: c.color, description: c.description, parent: path.at(-2) ?? null };
  });
}

/** The path of an entry; older files only name the parent, so follow parent names upwards. */
export function codebookEntryPath(e: CodebookEntry, entries: CodebookEntry[]): string[] {
  if (Array.isArray(e.path) && e.path.length) return e.path.map(String);
  const path = [e.name];
  for (let p = e.parent, d = 0; p && d < 100; d++) {
    path.unshift(p);
    p = entries.find((x) => x.name === p)?.parent;
  }
  return path;
}

/**
 * Adds the codes of another codebook, matched by path. Existing codes keep their color and
 * description unless `updateExisting` is set.
 */
export function importCodebook(entries: CodebookEntry[], updateExisting: boolean) {
  let added = 0;
  let updated = 0;
  const valid = entries.filter((e) => typeof e?.name === 'string' && e.name.trim());
  // Parents first, so their colors and descriptions are used when their subcodes are added.
  const withPaths = valid.map((e) => ({ e, path: codebookEntryPath(e, valid) })).sort((a, b) => a.path.length - b.path.length);
  for (const { e, path } of withPaths) {
    const color = /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : nextColor();
    const existing = findCodeByPath(path);
    if (existing) {
      if (updateExisting) {
        existing.color = color;
        existing.description = e.description || existing.description;
        existing.updatedAt = now();
        updated++;
      }
      continue;
    }
    const parent = path.length > 1 ? codeForPath(path.slice(0, -1), color) : null;
    project.codes.push({
      id: uid('c'),
      name: path.at(-1)!.trim(),
      color,
      description: e.description || undefined,
      parentId: parent?.id ?? null,
      updatedAt: now(),
    });
    added++;
  }
  commit();
  return { added, updated };
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

/**
 * The coder columns shown next to the text, in the user's chosen order. The Consolidated column
 * is included when one of `docIds` (by default the open document) is being consolidated.
 */
export function tableColumns(docIds: (string | null)[] = [ui.selectedDocId]): TableColumn[] {
  const cols: TableColumn[] = [
    { key: MINE_KEY, kind: 'mine', name: project.coderName || 'You', codes: project.codes, segments: project.segments },
  ];
  if (docIds.some((id) => consolidationOf(id))) {
    cols.push({ key: CONSOLIDATED_KEY, kind: 'consolidated', name: 'Consolidated', codes: project.codes, segments: allConsolidated() });
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

/** Sets a coder column's width in px (null = default width). */
export function setColumnWidth(key: ColumnKey, width: number | null) {
  if (width) ui.columnWidths[key] = Math.round(width);
  else delete ui.columnWidths[key];
  commitUI();
}

// ---------- consolidation ----------

// Consolidation happens per document: each document has its own consolidated coding, and
// finishing or discarding it leaves all other documents untouched.

export function startConsolidation(docId: string) {
  project.consolidations[docId] = [];
  ui.codeTarget = 'consolidated';
  ui.columnOrder = ui.columnOrder.filter((k) => k !== CONSOLIDATED_KEY);
  commit();
}

export function discardConsolidation(docId: string) {
  delete project.consolidations[docId];
  commit();
}

/**
 * Makes a document's consolidated coding your coding of that document. Your previous coding of
 * it is kept under "other coders" (one entry collects all documents) so nothing is lost.
 */
export function finishConsolidation(docId: string): string {
  const consolidated = consolidationOf(docId);
  if (!consolidated) return '';
  const keptAs = `${project.coderName || 'You'} (before consolidation)`;
  let before = project.externalCodings.find((x) => x.coderName === keptAs);
  if (!before) {
    before = { id: uid('x'), coderName: keptAs, codes: [], segments: [], importedAt: now() };
    project.externalCodings.push(before);
    ui.hiddenExternal.push(before.id);
  }
  // Keep every code the kept segments may refer to, including ones created since last time.
  const known = new Set(before.codes.map((c) => c.id));
  before.codes.push(...project.codes.filter((c) => !known.has(c.id)).map((c) => ({ ...c })));
  before.segments = [...before.segments.filter((s) => s.docId !== docId), ...project.segments.filter((s) => s.docId === docId)];
  before.importedAt = now();
  project.segments = [...project.segments.filter((s) => s.docId !== docId), ...consolidated];
  delete project.consolidations[docId];
  commit();
  return keptAs;
}

/** Whether the document's consolidated coding already covers this passage with the code at this path. */
export function isConsolidated(seg: Segment, path: string[]): boolean {
  const code = findCodeByPath(path);
  return !!code && !!consolidationOf(seg.docId)?.some(
    (s) => s.codeId === code.id && s.start <= seg.start && s.end >= seg.end,
  );
}

export interface AcceptItem {
  seg: Segment;
  /** The code's path in the coder's own codebook, matched against yours. */
  path: string[];
  color: string;
  source: string;
}

/** Copies segments of a coder into the consolidated coding, matching codes by path. Returns how many changed it. */
export function acceptIntoConsolidated(items: AcceptItem[]) {
  let changed = 0;
  for (const { seg, path, color, source } of items) {
    const doc = getDoc(seg.docId);
    const list = consolidationOf(seg.docId);
    if (!doc || !list) continue;
    if (addOrMerge(list, doc, seg.start, seg.end, codeForPath(path, color).id, source) !== 'contained') changed++;
  }
  commit();
  return changed;
}
