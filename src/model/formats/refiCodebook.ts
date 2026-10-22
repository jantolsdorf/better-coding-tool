// REFI-QDA Codebook exchange (.qdc), the open standard for exchanging code systems between
// MAXQDA, NVivo, ATLAS.ti, QualCoder and others: one XML file with a CodeBook of nested Code
// elements (name, color, description). Also the code writing and reading shared with the
// project exchange (.qdpx, see refi.ts).

import { codesInTreeOrder } from '../codes';
import type { Code } from '../types';
import { PALETTE, uid } from '../util';

const NS = 'urn:QDA-XML:codebook:1.0';

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Text safe for XML: escaped, and without the control characters XML 1.0 forbids. */
export function xml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const attr = (name: string, value: string | number | undefined | null) =>
  value === undefined || value === null || value === '' ? '' : ` ${name}="${xml(String(value))}"`;

export const byLocal = (el: Element | Document, name: string) => [...el.getElementsByTagNameNS('*', name)] as Element[];
export const children = (el: Element, name: string) => [...el.children].filter((c) => c.localName === name);

// ---------- writing ----------

/** A code as written: its own GUID, and its subcodes. */
export interface ExportCode {
  guid: string;
  name: string;
  color: string;
  description?: string;
  children: ExportCode[];
}

/** A Code element with its description and subcodes, indented. */
export function codeXml(c: ExportCode, indent: string): string {
  return (
    `${indent}<Code${attr('guid', c.guid)}${attr('name', c.name)} isCodable="true"${attr('color', c.color)}` +
    (c.description || c.children.length
      ? `>\n` +
        (c.description ? `${indent}  <Description>${xml(c.description)}</Description>\n` : '') +
        c.children.map((k) => codeXml(k, indent + '  ')).join('') +
        `${indent}</Code>\n`
      : '/>\n')
  );
}

/** A codebook as a tree of codes to write, in the custom order. */
function codeTree(codes: Code[]): ExportCode[] {
  const nodes = new Map<string, ExportCode>();
  const roots: ExportCode[] = [];
  for (const c of codesInTreeOrder(null, 0, codes)) {
    const node: ExportCode = { guid: uuid(), name: c.name, color: c.color, description: c.description, children: [] };
    nodes.set(c.id, node);
    const parent = c.parentId ? nodes.get(c.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

/** The codebook as a REFI-QDA Codebook (.qdc) file. */
export function buildQdc(codes: Code[], origin = 'Better Coding Tool'): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    `<CodeBook xmlns="${NS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${NS} Codebook.xsd"${attr('origin', origin)}>\n` +
    `  <Codes>\n${codeTree(codes).map((c) => codeXml(c, '    ')).join('')}  </Codes>\n` +
    '</CodeBook>\n'
  );
}

// ---------- reading ----------

export function expandColor(c: string | null): string | null {
  const m = c?.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
  return `#${hex.toLowerCase()}`;
}

/**
 * The codes of a Codes element (nested Code elements), with their order among siblings. Names
 * are made unique among siblings, and ">" is replaced because it separates a code from its
 * subcodes here. `byGuid` finds a code by the GUID in the file.
 */
export function parseCodes(codesEl: Element): { codes: Code[]; byGuid: Map<string, Code> } {
  const codes: Code[] = [];
  const byGuid = new Map<string, Code>();
  const walk = (els: Element[], parentId: string | null, parentColor?: string) => {
    const used = new Set<string>();
    for (const [order, el] of els.entries()) {
      let name = (el.getAttribute('name') || 'Unnamed code').replace(/[>›]/g, '/').trim();
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${name.replace(/ \(\d+\)$/, '')} (${n})`;
      used.add(name.toLowerCase());
      // Without a color of its own, a subcode takes its parent's (as in this tool).
      const color = expandColor(el.getAttribute('color')) ?? parentColor ?? PALETTE[codes.length % PALETTE.length];
      const description = children(el, 'Description')[0]?.textContent?.trim() || undefined;
      const code: Code = { id: uid('c'), name, color, description, parentId, order, updatedAt: new Date().toISOString() };
      codes.push(code);
      byGuid.set(el.getAttribute('guid') ?? '', code);
      walk(children(el, 'Code'), code.id, color);
    }
  };
  walk(children(codesEl, 'Code'), null);
  return { codes, byGuid };
}

/** Whether a file's text is a REFI-QDA Codebook. */
export function isQdc(text: string): boolean {
  return /<(\w+:)?CodeBook[\s>]/.test(text.slice(0, 2000));
}

/** The codes of a REFI-QDA Codebook (.qdc) file. Throws if it is not one. */
export function parseQdc(text: string): Code[] {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The file is not valid XML.');
  const root = doc.documentElement;
  if (root.localName !== 'CodeBook') throw new Error('The file has no CodeBook element (not a REFI-QDA codebook).');
  const codesEl = children(root, 'Codes')[0];
  return codesEl ? parseCodes(codesEl).codes : [];
}
