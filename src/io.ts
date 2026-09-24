import {
  addExternalCoding,
  emptyProject,
  folderPath,
  getDoc,
  matchDocs,
  parseProject,
  project,
  replaceProject,
} from './store';
import type { Code, Project, Segment } from './types';
import { downloadFile, lineSpan, pickFiles, safeFileName, toast } from './util';

const today = () => new Date().toISOString().slice(0, 10);

async function readProjectFile(file: File): Promise<Project> {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  return parseProject(data);
}

/** Documents, folders, codebook and coding in one JSON file. */
export function exportProject() {
  const who = safeFileName(project.coderName || 'project');
  downloadFile(`coding-${who}-${today()}.json`, JSON.stringify(project, null, 1), 'application/json');
}

export async function importProjectUI() {
  const [file] = await pickFiles('.json,application/json', false);
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
    replaceProject(p);
    toast(`Loaded ${p.docs.length} document(s), ${p.codes.length} code(s), ${p.segments.length} segment(s).`);
  } catch (e) {
    alert(`Could not import “${file.name}”: ${(e as Error).message}`);
  }
}

export function newProjectUI() {
  if (!confirm('Start a new, empty project? The current project is removed from this browser.\n\nExport it first if you want to keep it.')) return;
  replaceProject(emptyProject(project.coderName));
}

/** Imports the coding of other people (their exported project files) for comparison. */
export async function importCoderUI() {
  const files = await pickFiles('.json,application/json', true);
  for (const file of files) {
    let src: Project;
    try {
      src = await readProjectFile(file);
    } catch (e) {
      alert(`Could not import “${file.name}”: ${(e as Error).message}`);
      continue;
    }
    const suggested = src.coderName || file.name.replace(/\.json$/i, '');
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

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per coded segment, for all coders, for analysis in a spreadsheet. */
export function exportCSV() {
  const rows: (string | number)[][] = [
    ['coder', 'folder', 'document', 'code', 'start_line', 'end_line', 'start_offset', 'end_offset', 'text'],
  ];
  const add = (coder: string, codes: Code[], segments: Segment[]) => {
    const byId = new Map(codes.map((c) => [c.id, c.name]));
    for (const s of segments) {
      const doc = getDoc(s.docId);
      if (!doc) continue;
      const [a, b] = lineSpan(doc, s.start, s.end);
      rows.push([coder, folderPath(doc.folderId), doc.name, byId.get(s.codeId) ?? '', a, b, s.start, s.end, s.text]);
    }
  };
  add(project.coderName || 'me', project.codes, project.segments);
  for (const x of project.externalCodings) add(x.coderName, x.codes, x.segments);
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  downloadFile(`segments-${safeFileName(project.coderName || 'project')}-${today()}.csv`, csv, 'text/csv');
}
