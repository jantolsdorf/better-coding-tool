// This app's own files: the project .zip (with project.json), plain .json projects, and codebook
// files. Also recognizes REFI-QDA .qdpx files so callers can hand them to refi.ts.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { codebookEntries, type CodebookEntry } from '../codebookEntries';
import { codesInTreeOrder } from '../codes';
import { docsInTreeOrder, folderChain } from '../documents';
import { parseProject } from '../parse';
import { project } from '../state';
import { codebookCSV } from './csv';
import { isQdpx, parseQdpx } from './refi';

const PROJECT_JSON = 'project.json';
const CODEBOOK_FORMAT = 'bct-codebook';

/** File types accepted wherever a project can be imported. */
export const PROJECT_FILE_TYPES = '.zip,.json,.qdpx,application/zip,application/json';

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

/** Whether the bytes are a REFI-QDA project (a zip containing a .qde file). */
export function isQdpxFile(bytes: Uint8Array): boolean {
  return isZip(bytes) && isQdpx(zipNames(bytes));
}

/** Parses a .json file, or the project.json inside an exported .zip. */
export function readJson(bytes: Uint8Array): unknown {
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

/** A file or folder name that is safe on all common file systems. */
function pathSegment(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '_').trim() || '_';
}

/**
 * The whole project as a zip: project.json (everything, re-importable), every text file in its
 * folder structure under documents/, and the codebook as CSV.
 */
export function buildProjectZip() {
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
  return zipSync(files, { level: 6 });
}

/** Just the code system (names, colors, descriptions, hierarchy) as JSON. */
export function buildCodebookJson(): string {
  const data = { format: CODEBOOK_FORMAT, version: 1, exportedAt: new Date().toISOString(), codes: codebookEntries(codesInTreeOrder()) };
  return JSON.stringify(data, null, 1);
}

/** The codebook in a codebook file, an exported project (.zip/.json), or a REFI-QDA project. */
export function readCodebookFile(bytes: Uint8Array): CodebookEntry[] {
  // Only the codebook of a REFI-QDA project is needed, so no coder has to be chosen.
  if (isQdpxFile(bytes)) return codebookEntries(parseQdpx(bytes, () => null).project.codes);
  const data = readJson(bytes);
  const d = data as { format?: string; codes?: unknown };
  return d?.format === CODEBOOK_FORMAT && Array.isArray(d.codes)
    ? (d.codes as CodebookEntry[])
    : codebookEntries(parseProject(data).codes);
}
