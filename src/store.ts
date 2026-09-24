import type { Code, Doc, ExternalCoding, Folder, Project, Segment, UIState } from './types';
import { PALETTE } from './util';

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

export function folderPath(folderId: string | null): string {
  const parts: string[] = [];
  let f = project.folders.find((x) => x.id === folderId);
  while (f) {
    parts.unshift(f.name);
    const parent = f.parentId;
    f = project.folders.find((x) => x.id === parent);
  }
  return parts.join(' / ');
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

export function segmentCounts(): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of project.segments) m.set(s.codeId, (m.get(s.codeId) ?? 0) + 1);
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

/** Codes the passage [start, end) of a document with the given code name, creating the code if needed. */
export function applyCode(docId: string, start: number, end: number, codeName: string, colorForNew?: string) {
  const doc = getDoc(docId);
  const name = codeName.trim();
  if (!doc || !name) return null;
  let code = findCodeByName(name);
  if (!code) {
    code = { id: uid('c'), name, color: colorForNew ?? nextColor() };
    project.codes.push(code);
  }
  const codeId = code.id;
  const duplicate = project.segments.some(
    (s) => s.docId === docId && s.codeId === codeId && s.start === start && s.end === end,
  );
  if (!duplicate) {
    project.segments.push({
      id: uid('s'),
      docId,
      codeId,
      start,
      end,
      text: doc.content.slice(start, end),
      createdAt: now(),
    });
  }
  commit();
  return code;
}

export function deleteSegment(id: string) {
  project.segments = project.segments.filter((s) => s.id !== id);
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
  commit();
}

/** Reassigns all segments of `fromId` to `intoId` and removes `fromId`. */
export function mergeCode(fromId: string, intoId: string) {
  const seen = new Set(
    project.segments.filter((s) => s.codeId === intoId).map((s) => `${s.docId}:${s.start}:${s.end}`),
  );
  project.segments = project.segments.filter((s) => {
    if (s.codeId !== fromId) return true;
    const key = `${s.docId}:${s.start}:${s.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    s.codeId = intoId;
    return true;
  });
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
  commit();
}

export function setExternalVisible(id: string, visible: boolean) {
  ui.hiddenExternal = ui.hiddenExternal.filter((x) => x !== id);
  if (!visible) ui.hiddenExternal.push(id);
  commitUI();
}
