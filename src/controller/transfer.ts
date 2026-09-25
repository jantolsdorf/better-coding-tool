// Importing and exporting: projects, REFI-QDA projects, other people's coding, codebooks, CSV.

import { countExistingEntries, importCodebook, type CodebookEntry } from '../model/codebookEntries';
import { addExternalCoding, hasExternalCoder, matchDocs } from '../model/coders';
import { currentDoc, docsInTreeOrder } from '../model/documents';
import { codebookCSV, segmentsCSV, tableCSV } from '../model/formats/csv';
import {
  PROJECT_FILE_TYPES,
  buildCodebookJson,
  buildProjectZip,
  isQdpxFile,
  readCodebookFile,
  readJson,
} from '../model/formats/projectFile';
import { buildQdpx, parseQdpx } from '../model/formats/refi';
import { emptyProject, parseProject } from '../model/parse';
import { commitUI, project, projectFingerprint, replaceProject, ui } from '../model/state';
import { memoColumns, tableColumns } from '../model/table';
import type { Doc, Project } from '../model/types';
import { now, safeFileName } from '../model/util';
import { ask, confirmAction, notify, toast } from '../view/feedback';
import { downloadFile, pickFiles } from '../view/files';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const exportName = () => safeFileName(project.coderName || 'project');

/** Thrown when the user cancels a question during import; not reported as an error. */
class ImportCancelled extends Error {}

const importFailed = (file: File, e: unknown) => {
  if (!(e instanceof ImportCancelled)) notify(`Could not import “${file.name}”: ${(e as Error).message}`);
};

/** Why a REFI-QDA project is being read: to open it, or to compare with one of its coders. */
type QdpxPurpose = 'open' | 'compare';

/** Reads a project: an exported .zip (via its project.json), a plain .json, or a REFI-QDA .qdpx. */
async function readProjectFile(file: File, purpose: QdpxPurpose = 'open'): Promise<Project> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isQdpxFile(bytes)) return readQdpx(bytes, file.name, purpose);
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
    const answer = ask(question, '1');
    if (answer === null) throw new ImportCancelled();
    return users[Number(answer) - 1]?.guid ?? null;
  });
  if (skipped.sources) {
    toast(`Skipped ${skipped.sources} source(s) that are not text documents (e.g. PDFs, images, audio or video).`, 6000);
  }
  if (skipped.selections) toast(`Skipped ${skipped.selections} coding(s) that refer to a code missing from the codebook.`, 6000);
  return p;
}

// ---------- backups ----------

/** Remembers that the project as it is now exists as a file (downloaded or opened from one). */
function markBackedUp() {
  ui.backedUp = { fingerprint: projectFingerprint(), at: now() };
  commitUI();
}

/** Whether the project has changes that are only in this browser, not in a downloaded copy. */
export function hasChangesNotDownloaded(): boolean {
  const empty = !project.docs.length && !project.codes.length && !project.memos.length;
  return !empty && ui.backedUp?.fingerprint !== projectFingerprint();
}

// ---------- projects ----------

/** Replaces the current project with an exported project or a REFI-QDA project. */
export async function importProjectInteractive() {
  const [file] = await pickFiles(PROJECT_FILE_TYPES, false);
  if (!file) return;
  try {
    const p = await readProjectFile(file);
    const current = `${project.docs.length} document(s), ${project.segments.length} segment(s)`;
    if (
      (project.docs.length || project.codes.length) &&
      !confirmAction(`Replace your current project (${current}) with “${file.name}”?\n\nExport your current project first if you want to keep it.`)
    ) {
      return;
    }
    const me = project.coderName;
    if (!p.coderName) p.coderName = me;
    else if (me && p.coderName !== me) {
      const stayMe = confirmAction(
        `This project was coded by “${p.coderName}”. Who will continue coding it?\n\n` +
          `OK: “${me}” (the existing coding is then labelled as yours).\nCancel: “${p.coderName}”.`,
      );
      if (stayMe) p.coderName = me;
    }
    replaceProject(p);
    markBackedUp();
    toast(`Loaded ${p.docs.length} document(s), ${p.codes.length} code(s), ${p.segments.length} segment(s).`);
  } catch (e) {
    importFailed(file, e);
  }
}

export function newProjectInteractive() {
  if (!confirmAction('Start a new, empty project? The current project is removed from this browser.\n\nExport it first if you want to keep it.')) return;
  replaceProject(emptyProject(project.coderName));
}

/** Downloads the whole project as a zip (a complete copy that can be opened again). */
export function exportProject() {
  downloadFile(`coding-${exportName()}-${today()}.zip`, buildProjectZip(), 'application/zip');
  markBackedUp();
}

/** The project in the REFI-QDA exchange format, for MAXQDA, NVivo, ATLAS.ti and others. */
export function exportQdpx() {
  downloadFile(`coding-${exportName()}-${today()}.qdpx`, buildQdpx(), 'application/zip');
}

// ---------- other coders ----------

/** Imports the coding of other people (their exported project files) for comparison. */
export async function importCoderInteractive() {
  const files = await pickFiles(PROJECT_FILE_TYPES, true);
  for (const file of files) {
    let src: Project;
    try {
      src = await readProjectFile(file, 'compare');
    } catch (e) {
      importFailed(file, e);
      continue;
    }
    const suggested = src.coderName || file.name.replace(/\.(json|zip)$/i, '');
    const input = ask(`Whose coding is “${file.name}”?`, suggested);
    if (input === null) continue;
    const name = input.trim() || suggested;
    if (hasExternalCoder(name) && !confirmAction(`A coding by “${name}” is already imported. Replace it?`)) continue;

    const { missing } = matchDocs(src.docs);
    const missingCoded = missing.filter((d) => src.segments.some((s) => s.docId === d.id));
    let addTo: string | null = null;
    if (missingCoded.length) {
      const list = missingCoded.slice(0, 10).map((d) => `• ${d.name}`).join('\n');
      const more = missingCoded.length > 10 ? `\n…and ${missingCoded.length - 10} more` : '';
      if (
        confirmAction(
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
    const memos = res.memos ? ` and ${res.memos} memo(s)` : '';
    toast(`Imported ${res.imported} segment(s)${memos} by ${name}${res.skipped ? `, skipped ${res.skipped}` : ''}.`);
  }
}

// ---------- codebook ----------

/** Just the code system (names, colors, descriptions, hierarchy), without documents or coding. */
export function exportCodebook(kind: 'json' | 'csv') {
  if (kind === 'csv') return downloadFile(`codebook-${exportName()}-${today()}.csv`, codebookCSV(), 'text/csv');
  downloadFile(`codebook-${exportName()}-${today()}.json`, buildCodebookJson(), 'application/json');
}

/** Adds codes from an exported codebook, or from the codebook of an exported project. */
export async function importCodebookInteractive() {
  const [file] = await pickFiles(PROJECT_FILE_TYPES, false);
  if (!file) return;
  let entries: CodebookEntry[];
  try {
    entries = readCodebookFile(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    return importFailed(file, e);
  }
  if (!entries.length) return toast('The codebook is empty.');
  const existing = countExistingEntries(entries);
  const fresh = entries.length - existing;
  let update = false;
  if (existing) {
    update = confirmAction(
      `“${file.name}” has ${entries.length} code(s): ${fresh} new, ${existing} already in your codebook (same name at the same place).\n\n` +
        'OK: also update color and description of those existing codes.\nCancel: only add the new codes.',
    );
  }
  const res = importCodebook(entries, update);
  toast(`Added ${res.added} code(s)${res.updated ? `, updated ${res.updated}` : ''}.`);
}

// ---------- CSV ----------

/**
 * One row per line of text, with one column per coder as currently shown in the comparison
 * view (same order). Each cell lists the codes on that line, separated by semicolons.
 */
export function exportTableCSV(scope: 'current' | 'all') {
  const docs = scope === 'current' ? [currentDoc()].filter((d): d is Doc => !!d) : docsInTreeOrder();
  if (!docs.length) return toast(scope === 'current' ? 'Open a document first.' : 'There are no documents.');
  const ids = docs.map((d) => d.id);
  const csv = tableCSV(docs, tableColumns(ids), memoColumns(ids));
  const what = scope === 'current' ? safeFileName(docs[0].name.replace(/\.txt$/i, '')) : 'all-documents';
  downloadFile(`table-${what}-${today()}.csv`, csv, 'text/csv');
}

/** One row per coded segment, for all coders, for analysis in a spreadsheet. */
export function exportSegmentsCSV() {
  downloadFile(`segments-${exportName()}-${today()}.csv`, segmentsCSV(), 'text/csv');
}
