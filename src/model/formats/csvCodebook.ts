// Reading a codebook from a spreadsheet (CSV). The user chooses which columns hold codes (read
// left to right as parent › child › sub-child), and optionally the description and color.

import { splitCodePath } from '../codes';
import type { CodebookEntry } from '../codebookEntries';

/** Parses CSV text (comma, semicolon or tab separated, quotes with "" escapes) into rows of cells. */
export function parseCSV(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const delimiter = guessDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  // Rows without any content (e.g. trailing empty lines) are left out.
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** The separator used in the first line, outside of quotes. */
function guessDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n ? best : ',';
}

/**
 * What a column holds. A description column describes the code of one level (`description:0` is
 * the parent, `description:1` the child, …), or with plain `description` the last code of the row.
 */
export type CsvColumnRole = 'ignore' | 'code' | 'color' | 'description' | `description:${number}`;

/** The code level a description column describes: a 0-based level, 'last', or null if it is no description. */
export function descriptionTarget(role: CsvColumnRole): number | 'last' | null {
  if (role === 'description') return 'last';
  return role.startsWith('description:') ? Number(role.slice('description:'.length)) : null;
}

export interface CsvCodebookMapping {
  /** Whether the first row holds column names rather than codes. */
  headerRow: boolean;
  /** The role of each column, by index. */
  roles: CsvColumnRole[];
}

const DESCRIPTION_NAME = /^(description|desc|definition|beschreibung|memo|note|notes|comment|kommentar)\b/;

/**
 * A first guess of the column roles from the column names: a "path" column (as in this tool's
 * own codebook CSV) holds the codes; otherwise columns named like code, category, parent,
 * child or level. Description and color are recognized by name, too; a description column
 * whose name contains the name of a code column (e.g. "Description parent") describes that level.
 */
export function guessCsvMapping(rows: string[][]): CsvCodebookMapping {
  const width = Math.max(0, ...rows.map((r) => r.length));
  const head = (rows[0] ?? []).map((c) => c.trim().toLowerCase());
  const known = head.map((c) =>
    /^(path|pfad|code|codes|category|categories|kategorie|parent|child|sub|sub.?child|sub.?code|sub.?category|subkategorie|level ?\d*|ebene ?\d*|theme|subtheme|oberkategorie|unterkategorie|name)$/.test(c),
  );
  const desc = head.map((c) => DESCRIPTION_NAME.test(c));
  const color = head.findIndex((c) => /^(colou?r|farbe)$/.test(c));
  const headerRow = known.some(Boolean) || desc.some(Boolean) || color !== -1;
  const pathCol = head.findIndex((c) => c === 'path' || c === 'pfad');
  const roles: CsvColumnRole[] = Array.from({ length: width }, (_, i) => {
    if (desc[i] || i === color) return 'ignore';
    if (pathCol !== -1) return i === pathCol ? 'code' : 'ignore';
    return headerRow ? (known[i] ? 'code' : 'ignore') : i === 0 ? 'code' : 'ignore';
  });
  // Without any recognizable name, the first free column is taken as the code column.
  if (width && !roles.includes('code')) roles[Math.max(0, roles.indexOf('ignore'))] = 'code';
  const codeCols = roles.flatMap((r, i) => (r === 'code' ? [i] : []));
  head.forEach((name, i) => {
    if (i === color) roles[i] = 'color';
    if (!desc[i]) return;
    const level = codeCols.findIndex((c) => head[c] && name.includes(head[c]));
    roles[i] = level === -1 || pathCol !== -1 ? 'description' : `description:${level}`;
  });
  return { headerRow, roles };
}

/**
 * The codes of the CSV rows. The code columns are read left to right as parent › child ›
 * sub-child; a cell may also hold a whole path ("Parent > Child"). Empty code cells at the start
 * of a row continue the codes of the row above, so outline-style sheets work too. Each
 * description column describes the code of its level (or the last code of the row); texts from
 * several columns for the same code are combined. The color belongs to the last code of the row,
 * and parent codes without a color of their own take the color of their first subcode.
 */
export function csvCodebookEntries(rows: string[][], mapping: CsvCodebookMapping): CodebookEntry[] {
  const codeCols = mapping.roles.flatMap((r, i) => (r === 'code' ? [i] : []));
  const descCols = mapping.roles.flatMap((r, i) => {
    const target = descriptionTarget(r);
    return target === null || (target !== 'last' && target >= codeCols.length) ? [] : [{ col: i, target }];
  });
  const colorCol = mapping.roles.indexOf('color');
  const keyOf = (path: string[]) => path.map((p) => p.toLowerCase()).join('>');
  const byPath = new Map<string, { entry: CodebookEntry; texts: Map<number, string> }>();
  const entryFor = (path: string[]) => {
    const key = keyOf(path);
    if (!byPath.has(key)) byPath.set(key, { entry: { name: path.at(-1)!, path, color: '' }, texts: new Map() });
    return byPath.get(key)!;
  };

  let previous: string[] = [];
  /** Per code column, the index in `previous` of that level's code (undefined if the row had none). */
  let previousEnds: (number | undefined)[] = [];
  for (const row of mapping.headerRow ? rows.slice(1) : rows) {
    const cells = codeCols.map((i) => splitCodePath(row[i] ?? ''));
    const first = cells.findIndex((c) => c.length);
    if (first === -1) continue;
    // Leading empty cells take the codes of the row above, one level per column.
    const inheritedEnd = first === 0 ? -1 : (previousEnds.slice(0, first).filter((e) => e !== undefined).at(-1) ?? previous.length - 1);
    const path = previous.slice(0, inheritedEnd + 1);
    const ends: (number | undefined)[] = previousEnds.slice(0, first);
    for (let k = first; k < cells.length; k++) {
      path.push(...cells[k]);
      ends[k] = cells[k].length ? path.length - 1 : undefined;
    }
    previous = path;
    previousEnds = ends;

    // Every level becomes an entry, so parents appear in the preview and can get descriptions.
    for (let n = 1; n <= path.length; n++) entryFor(path.slice(0, n));
    for (const { col, target } of descCols) {
      const text = (row[col] ?? '').trim();
      const end = target === 'last' ? path.length - 1 : ends[target];
      if (!text || end === undefined) continue;
      const { texts } = entryFor(path.slice(0, end + 1));
      if (!texts.has(col)) texts.set(col, text);
    }
    const color = colorCol === -1 ? '' : (row[colorCol] ?? '').trim();
    const last = entryFor(path).entry;
    if (/^#[0-9a-f]{6}$/i.test(color) && !last.color) last.color = color;
  }

  const items = [...byPath.values()];
  for (const { entry, texts } of items) {
    if (texts.size) entry.description = [...texts.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t).join('\n\n');
    if (!entry.color) {
      const prefix = keyOf(entry.path!) + '>';
      entry.color = items.find((x) => x.entry.color && keyOf(x.entry.path!).startsWith(prefix))?.entry.color ?? '';
    }
  }
  return items.map((x) => x.entry);
}
