import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  addExternalCoding,
  allConsolidated,
  childCodes,
  codebookEntries,
  codeById,
  codePath,
  currentDoc,
  codebookEntryPath,
  findCodeByPath,
  importCodebook,
  type CodebookEntry,
  docsInTreeOrder,
  emptyProject,
  folderChain,
  folderPath,
  getDoc,
  matchDocs,
  parseProject,
  project,
  replaceProject,
  tableColumns,
} from './store';
import { buildQdpx, isQdpx, parseQdpx } from './refi';
import type { Code, Doc, Project, Segment } from './types';
import { byName, downloadFile, lineSpan, pickFiles, safeFileName, toast } from './util';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const PROJECT_FILES = '.zip,.json,.qdpx,application/zip,application/json';
const PROJECT_JSON = 'project.json';

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b;

/** File names inside a zip, without unpacking it. */
function zipNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    throw new Error('The zip file could not be read.');
  }
  return names;
}

/** Thrown when the user cancels a question during import; not reported as an error. */
class ImportCancelled extends Error {}

const importFailed = (file: File, e: unknown) => {
  if (!(e instanceof ImportCancelled)) alert(`Could not import “${file.name}”: ${(e as Error).message}`);
};

/** Why a REFI-QDA project is being read: to open it, or to compare with one of its coders. */
type QdpxPurpose = 'open' | 'compare';

/** Reads a project: an exported .zip (via its project.json), a plain .json, or a REFI-QDA .qdpx. */
async function readProjectFile(file: File, purpose: QdpxPurpose = 'open'): Promise<Project> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isZip(bytes) && isQdpx(zipNames(bytes))) return readQdpx(bytes, file.name, purpose);
  return parseProject(readJson(bytes));
}

/** Converts a REFI-QDA project, asking whose coding to use when several people coded it. */
function readQdpx(bytes: Uint8Array, fileName: string, purpose: QdpxPurpose): Project {
  const { project: p, skipped } = parseQdpx(bytes, (users) => {
    const list = users.map((u, i) => `${i + 1}) ${u.name} — ${u.codings} coding${u.codings === 1 ? '' : 's'}`).join('\n');
    const question =
      purpose === 'open'
        ? `“${fileName}” contains coding by ${users.length} people. Which one are you?\n` +
          'Everyone else is added under “Other coders” for comparison.\n\n' +
          `${list}\n\nEnter a number (or 0 if you are none of them):`
        : `“${fileName}” contains coding by ${users.length} people. Whose coding do you want to compare with yours?\n\n` +
          `${list}\n\nEnter a number:`;
    const answer = prompt(question, '1');
    if (answer === null) throw new ImportCancelled();
    return users[Number(answer) - 1]?.guid ?? null;
  });
  if (skipped.sources) {
    toast(`Skipped ${skipped.sources} source(s) that are not text documents (e.g. PDFs, images, audio or video).`, 6000);
  }
  if (skipped.selections) toast(`Skipped ${skipped.selections} coding(s) that refer to a code missing from the codebook.`, 6000);
  return p;
}

/** Parses a .json file, or the project.json inside an exported .zip. */
function readJson(bytes: Uint8Array): unknown {
  let text: string;
  if (isZip(bytes)) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes, { filter: (f) => f.name.split('/').pop() === PROJECT_JSON });
    } catch {
      throw new Error('The zip file could not be read.');
    }
    // Prefer the least nested project.json, in case the zip was repacked inside a folder.
    const key = Object.keys(entries).sort((a, b) => a.split('/').length - b.split('/').length)[0];
    if (!key) throw new Error(`The zip file does not contain a ${PROJECT_JSON}.`);
    text = strFromU8(entries[key]);
  } else {
    text = strFromU8(bytes);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(rows: (string | number)[][]): string {
  // The BOM makes Excel read the file as UTF-8.
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** A file or folder name that is safe on all common file systems. */
function pathSegment(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim() || '_';
}

/** Path of a document inside the export, e.g. "Wave 1/Students/interview.txt". */
function docPath(doc: Doc): string {
  return [...folderChain(doc.folderId), doc.name].join('/');
}

function codebookCSV(): string {
  const mine = new Map<string, number>();
  const consolidated = new Map<string, number>();
  for (const s of project.segments) mine.set(s.codeId, (mine.get(s.codeId) ?? 0) + 1);
  for (const s of allConsolidated()) consolidated.set(s.codeId, (consolidated.get(s.codeId) ?? 0) + 1);
  const rows: (string | number)[][] = [['code', 'path', 'parent', 'color', 'description', 'segments', 'consolidated_segments']];
  const parentName = (c: Code) => (c.parentId && codeById(c.parentId)?.name) || '';
  for (const c of codesInTreeOrder()) {
    rows.push([c.name, codePath(c), parentName(c), c.color, c.description ?? '', mine.get(c.id) ?? 0, consolidated.get(c.id) ?? 0]);
  }
  return toCSV(rows);
}

/** Codes depth-first in the order the codebook shows them. */
function codesInTreeOrder(parentId: string | null = null, depth = 0): Code[] {
  if (depth > 100) return [];
  return childCodes(parentId)
    .sort(byName)
    .flatMap((c) => [c, ...codesInTreeOrder(c.id, depth + 1)]);
}

const CODEBOOK_FORMAT = 'bct-codebook';

/** Just the code system (names, colors, descriptions, hierarchy), without documents or coding. */
export function exportCodebook(kind: 'json' | 'csv') {
  const who = safeFileName(project.coderName || 'project');
  if (kind === 'csv') return downloadFile(`codebook-${who}-${today()}.csv`, codebookCSV(), 'text/csv');
  const data = { format: CODEBOOK_FORMAT, version: 1, exportedAt: new Date().toISOString(), codes: codebookEntries(codesInTreeOrder()) };
  downloadFile(`codebook-${who}-${today()}.json`, JSON.stringify(data, null, 1), 'application/json');
}

/** Adds codes from an exported codebook, or from the codebook of an exported project. */
export async function importCodebookUI() {
  const [file] = await pickFiles(PROJECT_FILES, false);
  if (!file) return;
  let entries: CodebookEntry[];
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (isZip(bytes) && isQdpx(zipNames(bytes))) {
      // Only the codebook of a REFI-QDA project is needed, so no coder has to be chosen.
      entries = codebookEntries(parseQdpx(bytes, () => null).project.codes);
    } else {
      const data = readJson(bytes);
      const d = data as { format?: string; codes?: unknown };
      entries =
        d?.format === CODEBOOK_FORMAT && Array.isArray(d.codes)
          ? (d.codes as CodebookEntry[])
          : codebookEntries(parseProject(data).codes);
    }
  } catch (e) {
    return importFailed(file, e);
  }
  if (!entries.length) return toast('The codebook is empty.');
  const valid = entries.filter((e) => typeof e?.name === 'string');
  const existing = valid.filter((e) => findCodeByPath(codebookEntryPath(e, valid))).length;
  const fresh = entries.length - existing;
  let update = false;
  if (existing) {
    update = confirm(
      `“${file.name}” has ${entries.length} code(s): ${fresh} new, ${existing} already in your codebook (same name at the same place).\n\n` +
        'OK: also update color and description of those existing codes.\nCancel: only add the new codes.',
    );
  }
  const res = importCodebook(entries, update);
  toast(`Added ${res.added} code(s)${res.updated ? `, updated ${res.updated}` : ''}.`);
}

/**
 * The whole project as a zip: project.json (everything, re-importable), every text file in its
 * folder structure under documents/, and the codebook as CSV.
 */
/** The project in the REFI-QDA exchange format, for MAXQDA, NVivo, ATLAS.ti and others. */
export function exportQdpx() {
  const who = safeFileName(project.coderName || 'project');
  downloadFile(`coding-${who}-${today()}.qdpx`, buildQdpx(), 'application/zip');
}

export function exportProject() {
  const files: Record<string, Uint8Array> = {
    [PROJECT_JSON]: strToU8(JSON.stringify(project, null, 1)),
    'codebook.csv': strToU8(codebookCSV()),
    'README.txt': strToU8(
      'Exported from Better Coding Tool on ' + new Date().toLocaleString() + '.\n\n' +
        `${PROJECT_JSON}  - the complete project (documents, folders, codebook, coding of all coders).\n` +
        '                Import this zip (or the json) with "Import project" or "Other coders > Import".\n' +
        'documents/    - the text files in their folder structure.\n' +
        'codebook.csv  - the codes with colors and descriptions.\n',
    ),
  };
  const used = new Set<string>();
  for (const doc of docsInTreeOrder()) {
    const dir = ['documents', ...folderChain(doc.folderId).map(pathSegment)].join('/');
    const name = pathSegment(doc.name);
    const dot = name.lastIndexOf('.');
    const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '.txt'];
    let path = `${dir}/${base}${ext}`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = `${dir}/${base} (${n})${ext}`;
    used.add(path.toLowerCase());
    files[path] = strToU8(doc.content);
  }
  // Keep empty folders, too.
  for (const f of project.folders) {
    if (!project.docs.some((d) => d.folderId === f.id) && !project.folders.some((c) => c.parentId === f.id)) {
      files[['documents', ...folderChain(f.id).map(pathSegment)].join('/') + '/'] = new Uint8Array(0);
    }
  }
  const zip = zipSync(files, { level: 6 });
  const who = safeFileName(project.coderName || 'project');
  downloadFile(`coding-${who}-${today()}.zip`, zip, 'application/zip');
}

export async function importProjectUI() {
  const [file] = await pickFiles(PROJECT_FILES, false);
  if (!file) return;
  try {
    const p = await readProjectFile(file);
    const current = `${project.docs.length} document(s), ${project.segments.length} segment(s)`;
    if (
      (project.docs.length || project.codes.length) &&
      !confirm(`Replace your current project (${current}) with “${file.name}”?\n\nExport your current project first if you want to keep it.`)
    ) {
      return;
    }
    const me = project.coderName;
    if (!p.coderName) p.coderName = me;
    else if (me && p.coderName !== me) {
      const stayMe = confirm(
        `This project was coded by “${p.coderName}”. Who will continue coding it?\n\n` +
          `OK: “${me}” (the existing coding is then labelled as yours).\nCancel: “${p.coderName}”.`,
      );
      if (stayMe) p.coderName = me;
    }
    replaceProject(p);
    toast(`Loaded ${p.docs.length} document(s), ${p.codes.length} code(s), ${p.segments.length} segment(s).`);
  } catch (e) {
    importFailed(file, e);
  }
}

export function newProjectUI() {
  if (!confirm('Start a new, empty project? The current project is removed from this browser.\n\nExport it first if you want to keep it.')) return;
  replaceProject(emptyProject(project.coderName));
}

/** Imports the coding of other people (their exported project files) for comparison. */
export async function importCoderUI() {
  const files = await pickFiles(PROJECT_FILES, true);
  for (const file of files) {
    let src: Project;
    try {
      src = await readProjectFile(file, 'compare');
    } catch (e) {
      importFailed(file, e);
      continue;
    }
    const suggested = src.coderName || file.name.replace(/\.(json|zip)$/i, '');
    const input = prompt(`Whose coding is “${file.name}”?`, suggested);
    if (input === null) continue;
    const name = input.trim() || suggested;
    if (
      project.externalCodings.some((x) => x.coderName === name) &&
      !confirm(`A coding by “${name}” is already imported. Replace it?`)
    ) {
      continue;
    }

    const { missing } = matchDocs(src.docs);
    const missingCoded = missing.filter((d) => src.segments.some((s) => s.docId === d.id));
    let addTo: string | null = null;
    if (missingCoded.length) {
      const list = missingCoded.slice(0, 10).map((d) => `• ${d.name}`).join('\n');
      const more = missingCoded.length > 10 ? `\n…and ${missingCoded.length - 10} more` : '';
      if (
        confirm(
          `${missingCoded.length} document(s) coded by ${name} are not in your project (or their text differs):\n\n${list}${more}\n\n` +
            `OK: add them to your project in a folder “From ${name}”.\nCancel: skip the coding of these documents.`,
        )
      ) {
        addTo = `From ${name}`;
      }
    }
    // Only documents that match, or missing coded ones the user agreed to add, are passed on.
    const docs = src.docs.filter((d) => !missing.includes(d) || (addTo && missingCoded.includes(d)));
    const res = addExternalCoding({ ...src, docs }, name, addTo);
    toast(`Imported ${res.imported} segment(s) coded by ${name}${res.skipped ? `, skipped ${res.skipped}` : ''}.`);
  }
}

/**
 * One row per line of text, with one column per coder as currently shown in the comparison
 * view (same order). Each cell lists the codes on that line, separated by semicolons.
 */
export function exportTableCSV(scope: 'current' | 'all') {
  const docs = scope === 'current' ? [currentDoc()].filter((d): d is Doc => !!d) : docsInTreeOrder();
  if (!docs.length) return toast(scope === 'current' ? 'Open a document first.' : 'There are no documents.');
  const cols = tableColumns(docs.map((d) => d.id));
  const rows: (string | number)[][] = [['file', 'line', 'text', ...cols.map((c) => c.name)]];
  for (const doc of docs) {
    const lines = doc.content.split('\n');
    const cells = cols.map((col) => {
      // Full paths, since the same name can occur under different parent codes.
      const names = new Map(col.codes.map((c) => [c.id, codePath(c, col.codes)]));
      const perLine = lines.map(() => new Set<string>());
      const segs = col.segments.filter((s) => s.docId === doc.id).sort((a, b) => a.start - b.start);
      for (const s of segs) {
        const [a, b] = lineSpan(doc, s.start, s.end);
        const name = names.get(s.codeId) ?? '(unknown code)';
        for (let i = a; i <= b; i++) perLine[i - 1]?.add(name);
      }
      return perLine;
    });
    const file = docPath(doc);
    lines.forEach((text, i) => rows.push([file, i + 1, text, ...cells.map((c) => [...c[i]].join('; '))]));
  }
  const what = scope === 'current' ? safeFileName(docs[0].name.replace(/\.txt$/i, '')) : 'all-documents';
  downloadFile(`table-${what}-${today()}.csv`, toCSV(rows), 'text/csv');
}

/** One row per coded segment, for all coders, for analysis in a spreadsheet. */
export function exportSegmentsCSV() {
  const rows: (string | number)[][] = [
    ['coder', 'folder', 'document', 'code', 'start_line', 'end_line', 'start_offset', 'end_offset', 'text'],
  ];
  const add = (coder: string, codes: Code[], segments: Segment[]) => {
    const byId = new Map(codes.map((c) => [c.id, codePath(c, codes)]));
    for (const s of segments) {
      const doc = getDoc(s.docId);
      if (!doc) continue;
      const [a, b] = lineSpan(doc, s.start, s.end);
      rows.push([coder, folderPath(doc.folderId), doc.name, byId.get(s.codeId) ?? '', a, b, s.start, s.end, s.text]);
    }
  };
  add(project.coderName || 'me', project.codes, project.segments);
  add('Consolidated', project.codes, allConsolidated());
  for (const x of project.externalCodings) add(x.coderName, x.codes, x.segments);
  downloadFile(`segments-${safeFileName(project.coderName || 'project')}-${today()}.csv`, toCSV(rows), 'text/csv');
}
