// REFI-QDA Project exchange (.qdpx), the open standard used by MAXQDA, NVivo, ATLAS.ti,
// QualCoder and others: a zip with one "project.qde" XML file and a flat "sources" folder.
// Text selections count Unicode code points from 0, with an exclusive end position.

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { codePathParts } from '../codes';
import { docsInTreeOrder, folderChain, normalizeText } from '../documents';
import { emptyProject } from '../parse';
import { project } from '../state';
import type { Code, Doc, ExternalCoding, Folder, Project, Segment } from '../types';
import { PALETTE, uid } from '../util';

const NS = 'urn:QDA-XML:project:1.0';

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Text safe for XML: escaped, and without the control characters XML 1.0 forbids. */
function xml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const attr = (name: string, value: string | number | undefined | null) =>
  value === undefined || value === null || value === '' ? '' : ` ${name}="${xml(String(value))}"`;

/** Code point index for every UTF-16 index of `text` (length + 1 entries). */
function codePointIndex(text: string): Uint32Array {
  const map = new Uint32Array(text.length + 1);
  let cp = 0;
  for (let i = 0; i < text.length; i++, cp++) {
    map[i] = cp;
    const c = text.charCodeAt(i);
    const next = text.charCodeAt(i + 1);
    // A surrogate pair (e.g. an emoji) is two UTF-16 units but one code point.
    if (c >= 0xd800 && c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) map[++i] = cp;
  }
  map[text.length] = cp;
  return map;
}

// ---------- export ----------

interface ExportCode {
  guid: string;
  name: string;
  color: string;
  description?: string;
  children: ExportCode[];
}

/**
 * The project as a .qdpx file. Your coding and the coding of every other coder become the
 * codings of separate users; their codes are merged into one codebook by path.
 */
export function buildQdpx() {
  const now = new Date().toISOString();
  const users = [{ guid: uuid(), name: project.coderName || 'Coder', codes: project.codes, segments: project.segments }];
  for (const x of project.externalCodings) users.push({ guid: uuid(), name: x.coderName, codes: x.codes, segments: x.segments });

  // One codebook for everyone, keyed by lower-cased path.
  const roots: ExportCode[] = [];
  const byPath = new Map<string, ExportCode>();
  const nodeFor = (path: string[], source?: Code): ExportCode => {
    let siblings = roots;
    let node: ExportCode | undefined;
    for (let i = 0; i < path.length; i++) {
      const key = path.slice(0, i + 1).join('\u0000').toLowerCase();
      node = byPath.get(key);
      if (!node) {
        node = { guid: uuid(), name: path[i], color: source?.color ?? '#9ca3af', children: [] };
        byPath.set(key, node);
        siblings.push(node);
      }
      siblings = node.children;
    }
    if (source && !node!.description && source.description) node!.description = source.description;
    return node!;
  };
  const codeGuid = new Map<Code, string>();
  for (const u of users) for (const c of u.codes) codeGuid.set(c, nodeFor(codePathParts(c, u.codes), c).guid);

  const codeXml = (c: ExportCode, indent: string): string =>
    `${indent}<Code${attr('guid', c.guid)}${attr('name', c.name)} isCodable="true"${attr('color', c.color)}` +
    (c.description || c.children.length
      ? `>\n` +
        (c.description ? `${indent}  <Description>${xml(c.description)}</Description>\n` : '') +
        c.children.map((k) => codeXml(k, indent + '  ')).join('') +
        `${indent}</Code>\n`
      : '/>\n');

  const files: Record<string, Uint8Array> = {};
  const docGuid = new Map<string, string>();
  const sources = docsInTreeOrder().map((doc) => {
    const guid = uuid();
    docGuid.set(doc.id, guid);
    files[`sources/${guid}.txt`] = strToU8(doc.content);
    const cp = codePointIndex(doc.content);
    const selections = users.flatMap((u) => {
      const codes = new Map(u.codes.map((c) => [c.id, c]));
      return u.segments
        .filter((s) => s.docId === doc.id && s.end <= doc.content.length && codes.has(s.codeId))
        .sort((a, b) => a.start - b.start)
        .map((s) => {
          const when = attr('creationDateTime', s.createdAt);
          const excerpt = s.text.replace(/\s+/g, ' ').trim().slice(0, 100);
          return (
            `      <PlainTextSelection${attr('guid', uuid())}${attr('name', excerpt)}` +
            `${attr('startPosition', cp[s.start])}${attr('endPosition', cp[s.end])}${attr('creatingUser', u.guid)}${when}>\n` +
            `        <Coding${attr('guid', uuid())}${attr('creatingUser', u.guid)}${when}>` +
            `<CodeRef${attr('targetGUID', codeGuid.get(codes.get(s.codeId)!))}/></Coding>\n` +
            `      </PlainTextSelection>\n`
          );
        });
    });
    return (
      `    <TextSource${attr('guid', guid)}${attr('name', doc.name)}${attr('plainTextPath', `internal://${guid}.txt`)}` +
      `${attr('creatingUser', users[0].guid)}${attr('creationDateTime', doc.addedAt)}` +
      (selections.length ? `>\n${selections.join('')}    </TextSource>\n` : '/>\n')
    );
  });

  // Folders become sets (named by their path), since REFI-QDA has no folders.
  const sets = project.folders
    .map((f) => ({ f, docs: project.docs.filter((d) => d.folderId === f.id) }))
    .filter((x) => x.docs.length)
    .map(
      ({ f, docs }) =>
        `    <Set${attr('guid', uuid())}${attr('name', folderChain(f.id).join(' / '))}>\n` +
        docs.map((d) => `      <MemberSource${attr('targetGUID', docGuid.get(d.id))}/>\n`).join('') +
        `    </Set>\n`,
    );

  const qde =
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<Project xmlns="${NS}"${attr('name', project.coderName ? `${project.coderName}'s project` : 'Project')}` +
    ` origin="Better Coding Tool"${attr('creatingUserGUID', users[0].guid)}${attr('creationDateTime', now)}` +
    `${attr('modifyingUserGUID', users[0].guid)}${attr('modifiedDateTime', now)}>\n` +
    `  <Users>\n${users.map((u) => `    <User${attr('guid', u.guid)}${attr('name', u.name)}/>\n`).join('')}  </Users>\n` +
    (roots.length ? `  <CodeBook>\n    <Codes>\n${roots.map((c) => codeXml(c, '      ')).join('')}    </Codes>\n  </CodeBook>\n` : '') +
    (sources.length ? `  <Sources>\n${sources.join('')}  </Sources>\n` : '') +
    (sets.length ? `  <Sets>\n${sets.join('')}  </Sets>\n` : '') +
    `</Project>\n`;
  files['project.qde'] = strToU8(qde);
  return zipSync(files, { level: 6 });
}

// ---------- import ----------

export interface QdpxUser {
  guid: string;
  name: string;
  codings: number;
}

export interface QdpxResult {
  project: Project;
  skipped: { sources: number; selections: number };
}

/** Whether a zip is a REFI-QDA project (contains a .qde file). */
export function isQdpx(entries: string[]): boolean {
  return entries.some((n) => /\.qde$/i.test(n));
}

const byLocal = (el: Element | Document, name: string) =>
  [...el.getElementsByTagNameNS('*', name)] as Element[];
const children = (el: Element, name: string) => [...el.children].filter((c) => c.localName === name);

/**
 * Converts a .qdpx file into a project. `chooseUser` decides whose coding becomes "yours" when
 * the file contains coding by several people; everyone else becomes an other coder.
 */
export function parseQdpx(bytes: Uint8Array, chooseUser: (users: QdpxUser[]) => string | null): QdpxResult {
  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  const qdeName = names.filter((n) => /\.qde$/i.test(n)).sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!qdeName) throw new Error('The file does not contain a project.qde.');
  const doc = new DOMParser().parseFromString(strFromU8(entries[qdeName]), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('project.qde is not valid XML.');
  const root = doc.documentElement;
  if (root.localName !== 'Project') throw new Error('project.qde has no Project element.');

  // Source files by lower-cased file name, wherever they sit in the zip.
  const fileByName = new Map(names.map((n) => [n.split('/').pop()!.toLowerCase(), n]));
  const readSourceText = (path: string | null): string | null => {
    if (!path) return null;
    const file = decodeURIComponent(path.replace(/^internal:\/\//i, '').replace(/\\/g, '/').split('/').pop() ?? '');
    const entry = fileByName.get(file.toLowerCase());
    return entry ? strFromU8(entries[entry]) : null;
  };

  const userNames = new Map(byLocal(root, 'User').map((u) => [u.getAttribute('guid') ?? '', u.getAttribute('name') || 'Unnamed coder']));

  // Codebook: nested Code elements. Names are made unique among siblings, and ">" is replaced
  // because it separates a code from its subcodes here.
  const codes: Code[] = [];
  const codeByGuid = new Map<string, Code>();
  const walkCodes = (els: Element[], parentId: string | null) => {
    const used = new Set<string>();
    for (const el of els) {
      let name = (el.getAttribute('name') || 'Unnamed code').replace(/[>›]/g, '/').trim();
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.replace(/ \(\d+\)$/, '')} (${n})`;
      used.add(name.toLowerCase());
      const color = expandColor(el.getAttribute('color')) ?? PALETTE[codes.length % PALETTE.length];
      const description = children(el, 'Description')[0]?.textContent?.trim() || undefined;
      const code: Code = { id: uid('c'), name, color, description, parentId, updatedAt: new Date().toISOString() };
      codes.push(code);
      codeByGuid.set(el.getAttribute('guid') ?? '', code);
      walkCodes(children(el, 'Code'), code.id);
    }
  };
  const codebook = byLocal(root, 'CodeBook')[0];
  const codesEl = codebook && children(codebook, 'Codes')[0];
  if (codesEl) walkCodes(children(codesEl, 'Code'), null);

  // Text sources and their coded selections, collected per user.
  const docs: Doc[] = [];
  const docByGuid = new Map<string, Doc>();
  const segmentsByUser = new Map<string, Segment[]>();
  const skipped = { sources: 0, selections: 0 };
  const sourcesEl = byLocal(root, 'Sources')[0];
  const sourceEls = sourcesEl ? [...sourcesEl.children] : [];
  for (const src of sourceEls) {
    if (src.localName !== 'TextSource') {
      skipped.sources++;
      continue;
    }
    const raw =
      children(src, 'PlainTextContent')[0]?.textContent ??
      readSourceText(src.getAttribute('plainTextPath'));
    if (raw === null || raw === undefined) {
      skipped.sources++;
      continue;
    }
    const content = normalizeText(raw);
    const toOffset = offsetMapper(raw.replace(/^﻿/, ''));
    const name = src.getAttribute('name') || 'Untitled';
    const d: Doc = { id: uid('d'), name: /\.\w+$/.test(name) ? name : `${name}.txt`, folderId: null, content, addedAt: src.getAttribute('creationDateTime') || new Date().toISOString() };
    docs.push(d);
    docByGuid.set(src.getAttribute('guid') ?? '', d);

    const addCoding = (coding: Element, start: number, end: number, fallbackUser: string, fallbackDate: string) => {
      const code = codeByGuid.get(children(coding, 'CodeRef')[0]?.getAttribute('targetGUID') ?? '');
      if (!code || end <= start) return void skipped.selections++;
      const user = coding.getAttribute('creatingUser') || fallbackUser;
      const list = segmentsByUser.get(user) ?? [];
      segmentsByUser.set(user, list);
      // Same code on the same passage by the same person only once.
      if (list.some((s) => s.docId === d.id && s.codeId === code.id && s.start === start && s.end === end)) return;
      list.push({ id: uid('s'), docId: d.id, codeId: code.id, start, end, text: content.slice(start, end), createdAt: coding.getAttribute('creationDateTime') || fallbackDate });
    };
    const srcUser = src.getAttribute('creatingUser') ?? '';
    for (const sel of children(src, 'PlainTextSelection')) {
      const start = toOffset(Number(sel.getAttribute('startPosition')));
      const end = toOffset(Number(sel.getAttribute('endPosition')));
      const selUser = sel.getAttribute('creatingUser') || srcUser;
      for (const coding of children(sel, 'Coding')) addCoding(coding, start, end, selUser, sel.getAttribute('creationDateTime') ?? '');
    }
    // Codings of a whole source cover the whole text.
    for (const coding of children(src, 'Coding')) addCoding(coding, 0, content.length, srcUser, '');
  }
  if (!docs.length && sourceEls.length) throw new Error('The project contains no text documents that could be read.');

  // Sets become folders ("A / B" names become nested folders); a document goes into its first set.
  const folders: Folder[] = [];
  const folderFor = (path: string[]): string | null => {
    let parentId: string | null = null;
    for (const part of path) {
      let f = folders.find((x) => x.parentId === parentId && x.name === part);
      if (!f) folders.push((f = { id: uid('f'), name: part, parentId }));
      parentId = f.id;
    }
    return parentId;
  };
  for (const set of byLocal(root, 'Set')) {
    const members = children(set, 'MemberSource').map((m) => docByGuid.get(m.getAttribute('targetGUID') ?? '')).filter((d): d is Doc => !!d && !d.folderId);
    if (!members.length) continue;
    const folderId = folderFor((set.getAttribute('name') || 'Set').split(' / ').map((s) => s.trim()).filter(Boolean));
    for (const m of members) m.folderId = folderId;
  }

  // Decide whose coding is "yours".
  const users: QdpxUser[] = [...segmentsByUser].map(([guid, list]) => ({ guid, name: userNames.get(guid) || 'Unknown coder', codings: list.length }));
  let mine = users.length === 1 ? users[0].guid : null;
  if (users.length > 1) mine = chooseUser(users);

  const p = emptyProject(mine ? (users.find((u) => u.guid === mine)?.name ?? '') : '');
  p.folders = folders;
  p.docs = docs;
  p.codes = codes;
  p.segments = mine ? (segmentsByUser.get(mine) ?? []) : [];
  p.externalCodings = users
    .filter((u) => u.guid !== mine)
    .map((u): ExternalCoding => ({ id: uid('x'), coderName: u.name, codes: codes.map((c) => ({ ...c })), segments: segmentsByUser.get(u.guid)!, importedAt: new Date().toISOString() }));
  return { project: p, skipped };
}

function expandColor(c: string | null): string | null {
  const m = c?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return `#${hex.toLowerCase()}`;
}

/**
 * Maps a code point position in the original text to the UTF-16 position in the normalized
 * text (where \r\n and \r became \n).
 */
function offsetMapper(raw: string): (cp: number) => number {
  const map: number[] = [];
  let out = 0;
  let i = 0;
  while (i < raw.length) {
    map.push(out);
    const c = raw.codePointAt(i)!;
    const width = c > 0xffff ? 2 : 1;
    // "\r\n" becomes one "\n": the "\r" takes no room of its own.
    out += c === 0x0d && raw.charCodeAt(i + 1) === 0x0a ? 0 : width;
    i += width;
  }
  map.push(out);
  return (cp: number) => (Number.isFinite(cp) ? map[Math.max(0, Math.min(map.length - 1, Math.trunc(cp)))] : 0);
}
